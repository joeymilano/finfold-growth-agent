import { NextResponse } from "next/server";
import { apiError } from "@/lib/i18n";
import { isLocalMockMode, persistenceUnavailableMessage } from "@/lib/runtime-mode";
import { createSupabaseAdminClient, getCurrentUserId } from "@/lib/supabase";
import { loadOpportunityRadar } from "@/lib/trends/service";
import { trendWindowSchema } from "@/lib/trends/types";

export async function GET(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const admin = createSupabaseAdminClient();
    const url = new URL(request.url);
    const window = trendWindowSchema.catch("24h").parse(url.searchParams.get("window") ?? "24h");
    const locale = url.searchParams.get("locale") === "en" ? "en" : "zh";
    const requestedLimit = Number(url.searchParams.get("limit") ?? "5");
    const limit = Math.min(20, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 5));
    if (!admin) {
      if (isLocalMockMode()) {
        return NextResponse.json({
          opportunities: [],
          window,
          generatedAt: new Date().toISOString(),
          collectionStatus: "not_started",
          latestCollectionAt: null,
          collectionError: null,
          latestSignalAt: null,
          sourceCount: 0,
          profileReady: false,
          persisted: false,
          localizationStatus: locale === "zh" ? "ready" : "not_requested"
        });
      }
      return NextResponse.json({ error: persistenceUnavailableMessage("Opportunity Radar") }, { status: 503 });
    }
    return NextResponse.json(await loadOpportunityRadar(admin, userId, window, limit, { locale }));
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: apiError(request.headers, "登录后才能查看机会雷达。", "Please log in to view Opportunity Radar.") }, { status: 401 });
    }
    if (isMissingRadarSchema(error)) {
      console.error("[topic-opportunities] radar schema missing:", error);
      return NextResponse.json({ error: apiError(request.headers, "机会雷达暂时不可用，请稍后再试。", "Opportunity Radar is temporarily unavailable. Please try again later.") }, { status: 503 });
    }
    console.error("[topic-opportunities] load failed:", error);
    return NextResponse.json(
      { error: apiError(request.headers, "暂时无法加载机会雷达，请稍后再试。", "Unable to load Opportunity Radar. Please try again later.") },
      { status: 400 }
    );
  }
}

function isMissingRadarSchema(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && ["42P01", "PGRST202", "PGRST205"].includes(String((error as { code: unknown }).code));
}
