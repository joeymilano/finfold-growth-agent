import type { Locale } from "@/lib/i18n";
import { MAX_IDEA_TEXT_LENGTH } from "@/lib/content-schema";
import { computeKitCost } from "@/lib/payment/types";

/** Reason shown when the source text exceeds what one generation accepts. */
export function sourceTooLongReason(length: number, locale: Locale): string | null {
  if (length <= MAX_IDEA_TEXT_LENGTH) return null;
  const limit = MAX_IDEA_TEXT_LENGTH.toLocaleString("en-US");
  const over = (length - MAX_IDEA_TEXT_LENGTH).toLocaleString("en-US");
  return locale === "en"
    ? `Source text can be up to ${limit} characters — remove ${over} to generate.`
    : `源素材最多 ${limit} 字，还需删减 ${over} 字才能生成。`;
}

/** Matches the server's text reservation; optional images are billed separately. */
export function insufficientGenerationCredits(available: number | null | undefined, platformCount: number, locale: Locale): string | null {
  const required = computeKitCost(platformCount);
  if (available == null || !Number.isFinite(available) || platformCount < 1 || available >= required) return null;
  return locale === "en"
    ? `Draft generation needs ${required} Credits; you have ${Math.max(0, available)} available. Choose fewer platforms or check your balance in Billing.`
    : `生成文案需要 ${required} 点，当前可用 ${Math.max(0, available)} 点。可以减少平台，或到套餐与账单查看余额。`;
}

type GenerateGateInput = {
  ideaText: string;
  sourceAttachmentCount?: number;
  selectedPlatformCount: number;
  isLoading: boolean;
  authenticated: boolean;
  trialUsed: boolean;
  locale: Locale;
  /** Max platforms the current plan allows per kit. Omit to skip this check
   * (e.g. before the entitlements response has loaded). */
  platformLimit?: number;
  /** Operational cap shared by every plan to keep one generation bounded. */
  maxPlatformsPerGeneration?: number;
};

export function getGenerateDisabledReason({
  ideaText,
  sourceAttachmentCount = 0,
  selectedPlatformCount,
  isLoading,
  authenticated,
  trialUsed,
  locale,
  platformLimit,
  maxPlatformsPerGeneration
}: GenerateGateInput): string | null {
  const ideaLength = ideaText.trim().length;

  if (isLoading) {
    return locale === "en" ? "Generating your growth kit..." : "正在生成增长资产包...";
  }

  if (ideaLength < 20 && sourceAttachmentCount < 1) {
    return locale === "en"
      ? `Add at least 20 characters of product context or attach a source file. You currently have ${ideaLength}.`
      : `请至少输入 20 个字的产品资产说明，或上传一份源文件；当前 ${ideaLength} 个字。`;
  }

  const tooLong = sourceTooLongReason(ideaText.length, locale);
  if (tooLong) return tooLong;

  if (selectedPlatformCount < 1) {
    return locale === "en" ? "Select at least 1 platform to generate for." : "请至少选择 1 个要生成的平台。";
  }

  if (
    typeof maxPlatformsPerGeneration === "number" &&
    selectedPlatformCount > maxPlatformsPerGeneration
  ) {
    return locale === "en"
      ? `Choose up to ${maxPlatformsPerGeneration} platforms per generation to keep it fast and reliable.`
      : `为保证生成速度和稳定性，单次最多选择 ${maxPlatformsPerGeneration} 个平台。`;
  }

  if (typeof platformLimit === "number" && selectedPlatformCount > platformLimit) {
    return locale === "en"
      ? `Your plan supports up to ${platformLimit} platforms per kit. Deselect some, or upgrade.`
      : `当前套餐每份内容包最多支持 ${platformLimit} 个平台，请取消选择或升级套餐。`;
  }

  if (!authenticated && trialUsed) {
    return locale === "en" ? "Your free trial has been used. Sign in to continue." : "试玩次数已用完，请先登录后继续生成。";
  }

  return null;
}
