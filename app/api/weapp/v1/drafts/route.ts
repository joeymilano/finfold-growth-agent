import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { authenticateWeappRequest } from "@/lib/weapp/auth";
import { runWeappDraftGeneration, settleStaleWeappDraft, type WeappDraftRow } from "@/lib/weapp/drafts";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";

const bodySchema = z.object({
  requestId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  source: z.enum(["opportunity", "free"]),
  opportunityId: z.string().uuid().optional(),
  platform: z.enum(["wechat", "xiaohongshu", "moments"]),
  topic: z.object({
    title: z.string().trim().min(2).max(120),
    fact: z.string().trim().max(600).optional(),
    angle: z.string().trim().max(300).optional(),
    keywords: z.array(z.string().trim().min(1).max(24)).max(8).optional()
  })
});

export async function POST(request: Request) {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "storage unavailable" }, { status: 503 });
  const session = await authenticateWeappRequest(request, admin);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limited = enforceApiRateLimit(request, { scope: "weapp-draft-create", subject: session.userId, limit: 8, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const body = bodySchema.parse(await request.json());

    if (body.source === "opportunity" && !body.opportunityId) return NextResponse.json({ error: "请选择有效选题" }, { status: 400 });
    if (body.source === "opportunity" && body.opportunityId) {
      const { data: owned } = await admin
        .from("topic_opportunities")
        .select("id")
        .eq("id", body.opportunityId)
        .eq("user_id", session.userId)
        .maybeSingle();
      if (!owned) return NextResponse.json({ error: "opportunity not found" }, { status: 404 });
    }

    const { data: result, error } = await admin.rpc("create_weapp_draft", {
      p_user_id: session.userId,
      p_request_id: body.requestId,
      p_source: body.source,
      p_opportunity_id: body.source === "opportunity" ? body.opportunityId : null,
      p_topic: body.topic,
      p_platform: body.platform
    });
    if (error) {
      if (error.message.includes("insufficient_credits")) return NextResponse.json({ error: "额度不足，请稍后再试。", code: "insufficient_credits" }, { status: 402 });
      if (error.message.includes("request_id_conflict")) return NextResponse.json({ error: "请求内容已改变，请重新生成。" }, { status: 409 });
      throw error;
    }
    if (!result?.draft) throw new Error("draft creation failed");
    const row = result.draft;
    if (result.created) after(() => runWeappDraftGeneration(row.id));
    return NextResponse.json({
      id: row.id,
      status: row.status,
      cost: row.credits_charged,
      available: result.available,
      createdAt: row.created_at
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "draft creation failed" },
      { status: error instanceof z.ZodError ? 400 : 503 }
    );
  }
}

export async function GET(request: Request) {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "storage unavailable" }, { status: 503 });
  const session = await authenticateWeappRequest(request, admin);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await admin
    .from("weapp_drafts")
    .select("id,source,platform,topic,status,content,error,credits_charged,created_at,finished_at,user_id")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const drafts = (data ?? []) as unknown as WeappDraftRow[];
  // History is the reader of last resort: if the after() generation task was
  // lost (deploy/restart), no poll will ever settle the draft — settle here so
  // the user sees failure and the credits come back.
  let settled: WeappDraftRow[];
  try { settled = await Promise.all(
    drafts.map((item) => (item.status === "pending" ? settleStaleWeappDraft(admin, item) : item))
  ); } catch {
    return NextResponse.json({ error: "草稿结算暂不可用，请稍后重试。" }, { status: 503 });
  }
  return NextResponse.json({
    drafts: settled.map((item) => ({
      id: item.id,
      title: item.topic?.title ?? "",
      platform: item.platform,
      status: item.status,
      content: item.status === "ready" ? item.content : null,
      createdAt: item.created_at
    }))
  });
}
