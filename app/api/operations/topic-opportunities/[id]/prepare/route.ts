import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/i18n";
import { createSupabaseAdminClient, getCurrentUserId } from "@/lib/supabase";
import {
  buildTopicOpportunityGenerationRequest,
  loadTopicOpportunity
} from "@/lib/trends/service";

const idSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(8).max(120);

/**
 * A confirmation whose generation never produced a draft (the page was
 * closed mid-run, the request died) would otherwise lock the opportunity
 * forever. After this long without a draft, a new request may take it over.
 */
const STALE_PREPARATION_MS = 30 * 60 * 1000;

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

async function claimPreparation(admin: AdminClient, id: string, userId: string, idempotencyKey: string) {
  const { data: claims, error } = await admin.rpc("claim_topic_opportunity_preparation", {
    p_opportunity_id: id,
    p_user_id: userId,
    p_idempotency_key: idempotencyKey
  });
  if (error) throw error;
  return (Array.isArray(claims) ? claims[0] : claims) as { outcome?: string; existing_content_kit_id?: string | null } | null;
}

/** Marks an abandoned confirmation as failed so the claim RPC lets a new key in. */
async function releaseStalePreparation(admin: AdminClient, id: string, userId: string, now = Date.now()): Promise<boolean> {
  const { data: row, error } = await admin
    .from("topic_opportunities")
    .select("preparation_status, preparation_idempotency_key, prepared_at, content_kit_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.content_kit_id || row.preparation_status !== "confirmed" || !row.preparation_idempotency_key) return false;
  const preparedAt = row.prepared_at ? Date.parse(String(row.prepared_at)) : Number.NaN;
  if (Number.isFinite(preparedAt) && now - preparedAt < STALE_PREPARATION_MS) return false;
  const { error: releaseError } = await admin
    .from("topic_opportunities")
    .update({ preparation_status: "failed", updated_at: new Date(now).toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("preparation_status", "confirmed")
    .eq("preparation_idempotency_key", row.preparation_idempotency_key)
    .is("content_kit_id", null);
  if (releaseError) throw releaseError;
  return true;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = (zh: string, en: string) => apiError(request.headers, zh, en);
  try {
    const userId = await getCurrentUserId();
    const { id: rawId } = await params;
    const id = idSchema.parse(rawId);
    const idempotencyKey = idempotencyKeySchema.parse(request.headers.get("Idempotency-Key") ?? "");
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ error: t("暂时无法准备这个机会，请稍后再试。", "Opportunity preparation is temporarily unavailable.") }, { status: 503 });
    const body = await request.json().catch(() => ({})) as { outcome?: unknown };
    if (body.outcome === "failed") {
      const { error } = await admin
        .from("topic_opportunities")
        .update({ preparation_status: "failed", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        .eq("preparation_idempotency_key", idempotencyKey)
        .neq("preparation_status", "ready");
      if (error) throw error;
      return NextResponse.json({ status: "failed" });
    }

    const opportunity = await loadTopicOpportunity(admin, userId, id, { personalize: true });
    if (!opportunity) return NextResponse.json({ error: t("找不到这个机会。", "Opportunity not found.") }, { status: 404 });

    let claim = await claimPreparation(admin, id, userId, idempotencyKey);
    if (String(claim?.outcome) === "conflict" && await releaseStalePreparation(admin, id, userId)) {
      claim = await claimPreparation(admin, id, userId, idempotencyKey);
    }
    const outcome = String(claim?.outcome ?? "not_found");
    if (outcome === "not_found") return NextResponse.json({ error: t("找不到这个机会。", "Opportunity not found.") }, { status: 404 });
    if (outcome === "inactive") return NextResponse.json({ error: t("这个机会已经失效，请看看雷达里的其他机会。", "This opportunity is no longer active.") }, { status: 409 });
    if (outcome === "conflict") {
      return NextResponse.json({
        error: t(
          "这个机会正在生成草稿，完成后会出现在内容库。如果一直没有出现，请半小时后再试。",
          "A draft for this opportunity is already being created and will appear in Content Library. If it never shows up, try again in 30 minutes."
        )
      }, { status: 409 });
    }
    if (outcome === "invalid_key") return NextResponse.json({ error: t("请求无效，请刷新页面后重试。", "Invalid request. Refresh the page and try again.") }, { status: 400 });
    if (claim?.existing_content_kit_id) {
      return NextResponse.json({
        status: "ready",
        contentKitId: String(claim.existing_content_kit_id),
        replayed: true
      });
    }

    const generationRequest = await buildTopicOpportunityGenerationRequest(admin, userId, opportunity);
    return NextResponse.json({
      status: "confirmed",
      replayed: outcome === "replayed",
      idempotencyKey,
      generationRequest
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: t("登录后才能让 Finfold智能体准备内容。", "Please log in to let the Finfold Agent prepare content.") }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: t("请求无效，请刷新页面后重试。", "Invalid request. Refresh the page and try again.") }, { status: 400 });
    }
    console.error("[topic-opportunities/prepare] failed:", error);
    return NextResponse.json({ error: t("暂时无法准备这个机会，请稍后再试。", "Unable to prepare this opportunity. Please try again later.") }, { status: 400 });
  }
}
