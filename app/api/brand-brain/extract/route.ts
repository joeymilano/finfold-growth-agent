
import { NextResponse } from "next/server";
import { z } from "zod";
import { brandBrainSchema } from "@/lib/brand-brain";
import { buildBrandExtractionPrompt } from "@/lib/external-content-prompts";
import { stripHtmlToText } from "@/lib/html-strip";
import {
  HTML_CONTENT_TYPES,
  normalizeExternalHttpUrl,
  readTextWithLimit,
  safeExternalFetch,
  validateExternalHttpUrl
} from "@/lib/safe-url";
import { sendUntrustedContentPrompt } from "@/lib/llm";
import { getActiveSubscription, getPlanFeatures, resolveEffectivePlan } from "@/lib/payment/entitlements";
import { ACTION_CREDITS, ensurePlanCredits } from "@/lib/payment";
import { createAiUsageBilling } from "@/lib/payment/ai-usage-billing";
import { hashGenerationRequest, resolveGenerationRequestId } from "@/lib/generation-runs";
import { createSupabaseAdminClient, getCurrentUserId } from "@/lib/supabase";
import { apiError } from "@/lib/i18n";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { BrandExtractionOutputError, parseExtractedBrandFields } from "@/lib/brand-extraction";

const requestSchema = z.object({
  url: z.string().trim().min(1),
  sourceType: z.enum(["website", "social"]).default("website"),
  identityType: z.enum(["personal", "brand", "hybrid"]).default("personal")
});

/**
 * Populates Brand Memory from a product URL instead of manual entry
 * (plan §4 "Bootstrap 回路" — Pro+ only). Fetches the page, strips it to
 * plain text, runs one haiku-tier extraction call, and returns the parsed
 * fields WITHOUT persisting them — the client shows a preview and the user
 * confirms via the existing PUT /api/brand-brain save flow, so a bad
 * extraction never silently overwrites a hand-tuned Brand Memory.
 */
export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId();

    const admin = createSupabaseAdminClient();
    if (!admin) {
      return NextResponse.json({ error: apiError(request.headers, "从网址导入暂时不可用，请稍后再试", "URL bootstrap is not available in this environment.") }, { status: 503 });
    }
    const [{ data: profile }, { data: subscriptions }] = await Promise.all([
      admin.from("profiles").select("plan").eq("id", userId).maybeSingle(),
      admin
        .from("subscriptions")
        .select("status, current_period_end, payment_provider")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
    ]);

    const activeSubscription = getActiveSubscription(
      (subscriptions ?? []).map((subscription) => ({
        status: String(subscription.status ?? ""),
        currentPeriodEnd: subscription.current_period_end, provider: subscription.payment_provider
      }))
    );
    const effectivePlan = resolveEffectivePlan(profile?.plan, activeSubscription);

    if (!getPlanFeatures(effectivePlan).urlBootstrap) {
      return NextResponse.json(
        { error: apiError(request.headers, "从网址导入需要 Pro 及以上套餐。", "URL bootstrap requires the Pro plan or above.") },
        { status: 403 }
      );
    }

    const invalidUrl = () => NextResponse.json(
      { error: apiError(request.headers, "请输入有效的网址，例如 https://finfold.app", "Enter a valid website URL, e.g. https://finfold.app.") },
      { status: 400 }
    );
    const parsedRequest = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsedRequest.success) return invalidUrl();
    const url = normalizeExternalHttpUrl(parsedRequest.data.url);
    try {
      validateExternalHttpUrl(url);
    } catch {
      return invalidUrl();
    }
    const { sourceType, identityType } = parsedRequest.data;

    // Throttle and reserve Credits BEFORE any outbound request, so a user
    // without Credits (or a script) cannot use this route as a free fetcher.
    const limited = enforceApiRateLimit(request, { scope: "brand-bootstrap", subject: userId, limit: 10, windowMs: 60_000 });
    if (limited) return limited;

    await ensurePlanCredits(userId, effectivePlan);
    const requestId = resolveGenerationRequestId(request.headers.get("Idempotency-Key"));
    const billing = createAiUsageBilling({
      operationKey: `brand-bootstrap:${userId}:${requestId}`,
      userId,
      action: "brandVoiceAnalysis",
      cost: ACTION_CREDITS.brandVoiceAnalysis,
      source: "brand_bootstrap",
      detail: {
        requestId,
        sourceType,
        identityType,
        inputFingerprint: await hashGenerationRequest({ url, sourceType, identityType })
      }
    });
    const reservation = await billing.reserveAndStart();
    if (reservation.outcome === "insufficient_credits") {
      return NextResponse.json(
        { error: apiError(request.headers, "本月创作点数已用完，升级或购买补充包后再试", "This Finfold workspace is out of AI Credits for this cycle.") },
        { status: 402 }
      );
    }
    if (reservation.outcome === "existing") {
      return NextResponse.json(
        { error: apiError(request.headers, "这个网址正在读取或已经读取过，请稍后再试", "This URL bootstrap request is already being processed or completed. Retry later with the same Idempotency-Key.") },
        { status: 409 }
      );
    }

    let resultReady = false;
    try {
      let pageHtml: string;
      try {
        const pageResponse = await safeExternalFetch(url, {
          headers: {
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
            "User-Agent": "Mozilla/5.0 (compatible; FinfoldBot/1.0)"
          }
        }, {
          allowedContentTypes: HTML_CONTENT_TYPES,
          timeoutMs: 10_000,
          auditPurpose: "brand_memory_bootstrap"
        });
        if (!pageResponse.ok) {
          throw new Error(`Fetch failed: ${pageResponse.status}`);
        }
        pageHtml = await readTextWithLimit(pageResponse, 2 * 1024 * 1024);
      } catch (fetchError) {
        console.error("[brand-brain/extract] page fetch failed:", fetchError);
        return NextResponse.json(
          { error: apiError(request.headers, "无法访问该网址，请检查链接是否正确。", "Could not fetch that URL — check it's correct and publicly accessible.") },
          { status: 422 }
        );
      }

      const pageText = stripHtmlToText(pageHtml);
      if (pageText.length < 50) {
        return NextResponse.json(
          { error: apiError(request.headers, "该网页内容太少，无法提取品牌信息。", "That page doesn't have enough text content to extract from.") },
          { status: 422 }
        );
      }

      const raw = await sendUntrustedContentPrompt(
        buildBrandExtractionPrompt(pageText, url, sourceType, identityType)
      );
      const parsed = parseExtractedBrandFields(raw);
      const brain = brandBrainSchema.parse({
        ...parsed,
        identityType,
        sourceUrl: sourceType === "website" ? url : "",
        autoExtracted: true,
        enrichedAt: new Date().toISOString()
      });
      resultReady = true;
      await billing.settle();
      return NextResponse.json({ brain });
    } catch (error) {
      if (error instanceof BrandExtractionOutputError || error instanceof z.ZodError) {
        console.error("[brand-brain/extract] unusable model output:", error.message);
        return NextResponse.json(
          { error: apiError(request.headers, "没能从这个网址提取到品牌信息，请重试或手动填写", "Couldn't extract brand details from that URL — try again or fill them in manually.") },
          { status: 422 }
        );
      }
      throw error;
    } finally {
      if (!resultReady) await billing.refund("brand_bootstrap_failed").catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: apiError(request.headers, "请登录后再导入网址", "Please log in to use URL bootstrap.") }, { status: 401 });
    }

    console.error("[brand-brain/extract] failed:", error);
    return NextResponse.json(
      { error: apiError(request.headers, "没能从这个网址提取到品牌信息，请重试或手动填写", "Couldn't extract brand details from that URL — try again or fill them in manually.") },
      { status: 500 }
    );
  }
}
