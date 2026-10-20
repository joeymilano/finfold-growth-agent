
import { NextResponse } from "next/server";
import { z } from "zod";
import { customGuardrailsSchema } from "@/lib/guardrails";
import { industryPackIdSchema } from "@/lib/industry-rules/types";
import { createSupabaseAdminClient, getCurrentUserId } from "@/lib/supabase";
import { isLocalMockMode, persistenceUnavailableMessage } from "@/lib/runtime-mode";
import { sameRowVersion } from "@/lib/brand-brain-persistence";
import { apiError } from "@/lib/i18n";

const enabledPacksSchema = z.array(industryPackIdSchema);

// Accept both the current { rules, enabledPacks } shape and the legacy
// bare-array PUT body (pre-migration-027 clients / cached bundles), so a
// rolling deploy never 400s a client that hasn't refreshed yet.
// expectedUpdatedAt (optional) is the custom_guardrails.updated_at the page
// loaded; when present the save only applies on top of that exact row, so a
// stale page cannot drop rules the Agent added in the meantime.
const putBodySchema = z.union([
  z.object({
    rules: customGuardrailsSchema.default([]),
    enabledPacks: enabledPacksSchema.default([]),
    expectedUpdatedAt: z.string().max(64).nullable().optional()
  }),
  customGuardrailsSchema.transform((rules) => ({ rules, enabledPacks: [] as const, expectedUpdatedAt: undefined }))
]);

const GUARDRAIL_COLUMNS = "rules, enabled_packs, updated_at";

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      if (isLocalMockMode()) return NextResponse.json({ rules: [], enabledPacks: [], persisted: false });
      return NextResponse.json({ error: persistenceUnavailableMessage("Brand guardrails") }, { status: 503 });
    }

    const { data, error } = await supabase
      .from("custom_guardrails")
      .select(GUARDRAIL_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      rules: customGuardrailsSchema.parse(data?.rules ?? []),
      enabledPacks: enabledPacksSchema.parse(data?.enabled_packs ?? []),
      persisted: Boolean(data),
      updatedAt: data?.updated_at ?? null
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Please log in to load guardrails." }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load guardrails." },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const { rules, enabledPacks, expectedUpdatedAt } = putBodySchema.parse(await request.json());
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      if (isLocalMockMode()) return NextResponse.json({ rules, enabledPacks, persisted: false, updatedAt: null });
      return NextResponse.json({ error: persistenceUnavailableMessage("Brand guardrails") }, { status: 503 });
    }

    const values = { user_id: userId, rules, enabled_packs: enabledPacks, updated_at: new Date().toISOString() };
    let result;
    if (expectedUpdatedAt === undefined) {
      result = await supabase
        .from("custom_guardrails")
        .upsert(values, { onConflict: "user_id" })
        .select(GUARDRAIL_COLUMNS)
        .maybeSingle();
    } else {
      const { data: existing, error: existingError } = await supabase
        .from("custom_guardrails")
        .select("updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!sameRowVersion(existing?.updated_at ?? null, expectedUpdatedAt)) return conflictResponse(request);
      result = existing
        ? await supabase
          .from("custom_guardrails")
          .update(values)
          .eq("user_id", userId)
          .eq("updated_at", existing.updated_at)
          .select(GUARDRAIL_COLUMNS)
          .maybeSingle()
        : await supabase.from("custom_guardrails").insert(values).select(GUARDRAIL_COLUMNS).maybeSingle();
      if (result.error?.code === "23505" || (!result.error && !result.data)) return conflictResponse(request);
    }
    const { data, error } = result;
    if (error) throw error;

    return NextResponse.json({
      rules: customGuardrailsSchema.parse(data?.rules ?? rules),
      enabledPacks: enabledPacksSchema.parse(data?.enabled_packs ?? enabledPacks),
      persisted: true,
      updatedAt: data?.updated_at ?? null
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Please log in to save guardrails." }, { status: 401 });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save guardrails." },
      { status: 400 }
    );
  }
}

function conflictResponse(request: Request) {
  return NextResponse.json(
    {
      error: apiError(request.headers, "规则已在别处更新，已为你载入最新内容，请重新操作", "Rules were updated elsewhere — the latest version has been loaded, please try again."),
      code: "conflict"
    },
    { status: 409 }
  );
}
