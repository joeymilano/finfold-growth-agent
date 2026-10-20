import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return NextResponse.json({ error: "分享链接无效" }, { status: 400 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "服务暂不可用" }, { status: 503 });
  const { data, error } = await admin.from("weapp_opportunity_shares").select("snapshot").eq("token", token).maybeSingle();
  if (error) return NextResponse.json({ error: "分享暂不可用" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "分享已失效" }, { status: 404 });
  return NextResponse.json(data.snapshot, { headers: { "Cache-Control": "private, no-store" } });
}
