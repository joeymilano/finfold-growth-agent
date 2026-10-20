import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { authenticateWeappRequest } from "@/lib/weapp/auth";
import { getAvailableCredits } from "@/lib/payment/credits";

/**
 * WeApp profile: a deliberately thin view over the same brand_brains +
 * operating_programs rows the web radar reads, so the scoring pipeline is
 * shared end-to-end. Onboarding answers land here and immediately steer the
 * opportunity match scores.
 */

const weappPlatformSchema = z.enum(["wechat", "xiaohongshu", "moments"]);

const patchSchema = z.object({
  nickname: z.string().trim().max(32).optional(),
  business: z.string().trim().min(4).max(160).optional(),
  audience: z.string().trim().max(160).optional(),
  focusKeywords: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  platform: weappPlatformSchema.optional()
});

function toProgramPlatform(platform: "wechat" | "xiaohongshu" | "moments"): "wechat" | "xiaohongshu" {
  return platform === "xiaohongshu" ? "xiaohongshu" : "wechat";
}

export async function GET(request: Request) {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "storage unavailable" }, { status: 503 });
  const session = await authenticateWeappRequest(request, admin);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [identityResult, brainResult, programResult] = await Promise.all([
    admin.from("weapp_identities").select("nickname,preferred_platform").eq("id", session.identityId).maybeSingle(),
    admin.from("brand_brains").select("product_description,target_audience").eq("user_id", session.userId).maybeSingle(),
    admin.from("operating_programs").select("platform,watchlist,offer").eq("user_id", session.userId).order("updated_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (identityResult.error || brainResult.error || programResult.error) return NextResponse.json({ error: "画像暂不可用，请重试。" }, { status: 503 });
  const credits = await getAvailableCredits(session.userId);
  const business = brainResult.data?.product_description ?? "";
  return NextResponse.json({
    nickname: identityResult.data?.nickname ?? null,
    onboarded: business.trim().length >= 4,
    business,
    audience: brainResult.data?.target_audience ?? "",
    focusKeywords: Array.isArray(programResult.data?.watchlist?.keywords)
      ? programResult.data.watchlist.keywords
      : [],
    platform: identityResult.data?.preferred_platform ?? programResult.data?.platform ?? "wechat",
    credits
  });
}

export async function PATCH(request: Request) {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "storage unavailable" }, { status: 503 });
  const session = await authenticateWeappRequest(request, admin);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const patch = patchSchema.parse(await request.json());
    const now = new Date().toISOString();
    // A silent write failure must not report success — the mini program toasts
    // "画像已更新" on ok:true, so every write is checked here.
    const writeFailed = (step: string, dbError: unknown) =>
      NextResponse.json(
        {
          error: `${step} failed: ${
            typeof dbError === "object" && dbError !== null && "message" in dbError
              ? String((dbError as { message: unknown }).message)
              : "unknown"
          }`
        },
        { status: 500 }
      );

    if (patch.nickname !== undefined) {
      const { error } = await admin.from("weapp_identities").update({ nickname: patch.nickname }).eq("id", session.identityId);
      if (error) return writeFailed("nickname update", error);
    }

    if (patch.business !== undefined || patch.audience !== undefined) {
      const { data: brain, error: readError } = await admin
        .from("brand_brains")
        .select("product_description,target_audience")
        .eq("user_id", session.userId)
        .maybeSingle();
      if (readError) return writeFailed("brand brain read", readError);
      const { error } = await admin.from("brand_brains").upsert({
        user_id: session.userId,
        product_description: patch.business ?? brain?.product_description ?? "",
        target_audience: patch.audience ?? brain?.target_audience ?? "",
        updated_at: now
      });
      if (error) return writeFailed("brand brain upsert", error);
    }

    if (patch.focusKeywords !== undefined || patch.platform !== undefined || patch.business !== undefined) {
      // Platform preference: an explicit patch wins; otherwise inherit the
      // latest program's platform so a keywords-only patch never forks a
      // second program on a different platform.
      const { data: latest, error: latestError } = await admin
        .from("operating_programs")
        .select("id,platform,watchlist,offer,status")
        .eq("user_id", session.userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) return writeFailed("program read", latestError);
      const platform = toProgramPlatform(patch.platform ?? latest?.platform ?? "wechat");
      let current = latest && toProgramPlatform(latest.platform) === platform ? latest : null;
      if (!current) {
        const { data: onPlatform, error: onPlatformError } = await admin
          .from("operating_programs")
          .select("id,platform,watchlist,offer,status")
          .eq("user_id", session.userId)
          .eq("platform", platform)
          .maybeSingle();
        if (onPlatformError) return writeFailed("program read", onPlatformError);
        current = onPlatform ?? null;
      }
      // Only one active program may exist per user; a fresh weapp account has
      // none, but guard anyway and fall back to draft (the radar accepts it).
      const { count: activeCount, error: countError } = await admin
        .from("operating_programs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", session.userId)
        .eq("status", "active");
      if (countError) return writeFailed("program status check", countError);
      const anotherProgramIsActive = (activeCount ?? 0) > 0 && current?.status !== "active";
      const watchlist = {
        keywords: patch.focusKeywords ?? current?.watchlist?.keywords ?? [],
        competitors: current?.watchlist?.competitors ?? []
      };
      // Merge into the existing offer instead of replacing the column: an
      // unconditional { name: "" } used to wipe the web-configured offer.
      const offer = current?.offer
        ? { ...current.offer, ...(patch.business !== undefined ? { summary: patch.business } : {}) }
        : { name: "", ...(patch.business !== undefined ? { summary: patch.business } : {}) };
      if (current) {
        const { error } = await admin.from("operating_programs").update({
          watchlist,
          offer,
          platform,
          status: anotherProgramIsActive ? current.status : "active",
          updated_at: now
        }).eq("id", current.id);
        if (error) return writeFailed("program update", error);
      } else {
        const { error } = await admin.from("operating_programs").insert({
          user_id: session.userId,
          platform,
          status: anotherProgramIsActive ? "draft" : "active",
          watchlist,
          offer
        });
        if (error) return writeFailed("program insert", error);
      }
    }

    if (patch.platform !== undefined) {
      const { error } = await admin.from("weapp_identities").update({ preferred_platform: patch.platform }).eq("id", session.identityId);
      if (error) return writeFailed("platform preference", error);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "profile update failed" },
      { status: 400 }
    );
  }
}
