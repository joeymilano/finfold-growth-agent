import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { authenticateWeappRequest } from "@/lib/weapp/auth";
import { loadTopicOpportunity } from "@/lib/trends/service";
import { publicOpportunitySnapshot } from "@/lib/weapp/sharing";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  const session = await authenticateWeappRequest(request, admin);
  if (!session) return NextResponse.json({ error: "请重新登录" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "无效选题" }, { status: 400 });
  try {
    const found = await loadTopicOpportunity(admin, session.userId, id, { locale: "zh" });
    if (!found) return NextResponse.json({ error: "未找到选题" }, { status: 404 });
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
    // The allowlist intentionally excludes personal angles, whyYou, match terms,
    // business profile, source opportunity ID and all scores.
    const { error } = await admin.from("weapp_opportunity_shares").upsert({
      token, user_id: session.userId, opportunity_id: id, snapshot: publicOpportunitySnapshot(found)
    }, { onConflict: "user_id,opportunity_id", ignoreDuplicates: true });
    if (error) throw error;
    const { data, error: readError } = await admin.from("weapp_opportunity_shares").select("token")
      .eq("user_id", session.userId).eq("opportunity_id", id).single();
    if (readError || !data) throw readError ?? new Error("share unavailable");
    return NextResponse.json({ token: data.token });
  } catch {
    return NextResponse.json({ error: "分享准备失败，请重试" }, { status: 503 });
  }
}
