
import { NextResponse } from "next/server";
import { z } from "zod";
import { brandBrainSchema, visualIdentitySchema } from "@/lib/brand-brain";
import { BRAND_BRAIN_COLUMNS, mapBrandBrainFromRow, mapBrandBrainToRow, sameRowVersion } from "@/lib/brand-brain-persistence";
import { createSupabaseAdminClient, getCurrentUserId } from "@/lib/supabase";
import { isLocalMockMode, persistenceUnavailableMessage } from "@/lib/runtime-mode";
import { logMemoryEvent } from "@/lib/memory-events";
import { apiError } from "@/lib/i18n";

/** Optional optimistic-concurrency token: the brand_brains.updated_at the
 * client loaded. Omitted by legacy clients, which keep last-write-wins. */
const saveVersionSchema = z.object({ expectedUpdatedAt: z.string().max(64).nullable().optional() });

function conflictResponse(request: Request) {
  return NextResponse.json(
    {
      error: apiError(request.headers, "内容已在别处更新，请刷新后再保存", "Brand Memory was updated elsewhere — refresh before saving."),
      code: "conflict"
    },
    { status: 409 }
  );
}

/** Fields a manual Brand Memory save can grow — logged as context_field
 * memory events (diff of new vs. existing entries) so the ledger reflects
 * hand-entered context alongside the system-learned rules. */
const DIFFABLE_LIST_FIELDS = ["toneKeywords", "bannedPhrases", "approvedExamples", "competitors"] as const;

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      if (isLocalMockMode()) return NextResponse.json({ brain: brandBrainSchema.parse({}), persisted: false });
      return NextResponse.json({ error: persistenceUnavailableMessage("Brand Memory") }, { status: 503 });
    }

    const { data, error } = await supabase
      .from("brand_brains")
      .select(BRAND_BRAIN_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      brain: mapBrandBrainFromRow(data),
      persisted: Boolean(data),
      updatedAt: (data as { updated_at?: string | null } | null)?.updated_at ?? null
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Please log in to load Brand Memory." }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Brand Memory." },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const body = await request.json();
    const input = brandBrainSchema.parse(body);
    const { expectedUpdatedAt } = saveVersionSchema.parse(body ?? {});
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      if (isLocalMockMode()) return NextResponse.json({ brain: input, persisted: false });
      return NextResponse.json({ error: persistenceUnavailableMessage("Brand Memory") }, { status: 503 });
    }

    // learnedStyle/learnedNegative are system-managed (distilled from
    // output_edits / underperforming posts — see lib/style-learning.ts and
    // lib/negative-learning.ts); performanceRules is written only via the
    // explicit "adopt" action (app/api/iterate/adopt/route.ts). None of the
    // three are edited by the user's own Brand Memory form. Preserve
    // whatever is already in the DB rather than letting a manual save from
    // a stale client payload silently wipe them out.
    const { data: existing, error: existingError } = await supabase
      .from("brand_brains")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) throw existingError;

    // approved_examples and platform_memory are also grown by the system
    // (publishing, feedback, Agent). A page that loaded an older row must not
    // erase those additions, so a versioned save only applies on top of the
    // exact row it was edited from.
    const checkVersion = expectedUpdatedAt !== undefined;
    const currentUpdatedAt = (existing as { updated_at?: string | null } | null)?.updated_at ?? null;
    if (checkVersion && !sameRowVersion(currentUpdatedAt, expectedUpdatedAt ?? null)) {
      return conflictResponse(request);
    }

    const row = mapBrandBrainToRow(input);
    row.learned_style = existing?.learned_style ?? input.learnedStyle;
    row.learned_negative = existing?.learned_negative ?? input.learnedNegative;
    row.performance_rules = existing?.performance_rules ?? input.performanceRules;
    const existingVisualIdentity = visualIdentitySchema.parse(existing?.visual_identity ?? {});
    row.visual_identity = {
      ...input.visualIdentity,
      learnedPreferences: existingVisualIdentity.learnedPreferences
    };

    const writeRow = async (payload: Record<string, unknown>) => {
      const values = { user_id: userId, ...payload, updated_at: new Date().toISOString() };
      if (checkVersion && existing && currentUpdatedAt) {
        // Guarded update closes the read→write race: zero rows means another
        // writer changed the row after the version check above.
        return supabase
          .from("brand_brains")
          .update(values)
          .eq("user_id", userId)
          .eq("updated_at", currentUpdatedAt)
          .select(BRAND_BRAIN_COLUMNS)
          .maybeSingle();
      }
      if (checkVersion && !existing) {
        return supabase.from("brand_brains").insert(values).select(BRAND_BRAIN_COLUMNS).maybeSingle();
      }
      return supabase
        .from("brand_brains")
        .upsert(values, { onConflict: "user_id" })
        .select(BRAND_BRAIN_COLUMNS)
        .maybeSingle();
    };

    let { data, error } = await writeRow(row);
    if (isMissingVisualIdentityColumn(error)) {
      const legacyRow: Record<string, unknown> = { ...row };
      delete legacyRow.visual_identity;
      const legacyResult = await writeRow(legacyRow);
      data = legacyResult.data;
      error = legacyResult.error;
    }
    if (checkVersion && (error?.code === "23505" || (!error && !data))) {
      return conflictResponse(request);
    }
    if (error) throw error;

    await logNewContextFieldEntries(userId, existing, input);

    return NextResponse.json({
      brain: mapBrandBrainFromRow(data),
      persisted: true,
      updatedAt: (data as { updated_at?: string | null } | null)?.updated_at ?? null
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Please log in to save Brand Memory." }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save Brand Memory." },
      { status: 400 }
    );
  }
}

/**
 * Diffs the manually-editable list fields (tone keywords, banned phrases,
 * approved examples, competitors) against what was already saved, and logs
 * a context_field memory event for each newly-added entry. Best-effort —
 * failures are swallowed inside logMemoryEvent itself.
 */
async function logNewContextFieldEntries(
  userId: string,
  existing: Record<string, unknown> | null | undefined,
  input: ReturnType<typeof brandBrainSchema.parse>
): Promise<void> {
  const rowKeyByField: Record<(typeof DIFFABLE_LIST_FIELDS)[number], string> = {
    toneKeywords: "tone_keywords",
    bannedPhrases: "banned_phrases",
    approvedExamples: "approved_examples",
    competitors: "competitors"
  };

  const events: Array<Promise<void>> = [];
  for (const field of DIFFABLE_LIST_FIELDS) {
    const previous = new Set(
      Array.isArray(existing?.[rowKeyByField[field]])
        ? (existing[rowKeyByField[field]] as unknown[]).filter((v): v is string => typeof v === "string")
        : []
    );
    for (const value of input[field]) {
      if (!previous.has(value)) {
        events.push(logMemoryEvent(userId, "context_field", value));
      }
    }
  }
  await Promise.all(events);
}

function isMissingVisualIdentityColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? "";
  return error.code === "42703" || error.code === "PGRST204" || (message.includes("visual_identity") && message.includes("column"));
}
