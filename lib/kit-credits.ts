import type { Locale } from "@/lib/i18n";
import { ACTION_CREDITS } from "@/lib/payment/types";

/**
 * Shared out-of-Credits contract for creation-studio actions. API routes
 * answer 402 with { error, code: "insufficient_credits" }; clients key off the
 * code (or the status) and offer the billing page instead of a raw message.
 * Dependency-free so both server routes and client components can import it.
 */
export const INSUFFICIENT_CREDITS_CODE = "insufficient_credits";
export const BILLING_PATH = "/billing";

/** Fired after an action spends Credits so the workbench re-reads the balance. */
export const CREDITS_CHANGED_EVENT = "finfold-credits-changed";

/** Credits charged by each per-output action (mirrors the server routes). */
export const OUTPUT_ACTION_CREDITS = {
  regenerate: ACTION_CREDITS.singlePlatformCopy,
  improve: ACTION_CREDITS.singlePlatformCopy,
  polish: ACTION_CREDITS.aiScoreOptimize,
  refine: ACTION_CREDITS.rewriteTitle,
  image: ACTION_CREDITS.standardImage
} as const;

export function outOfCreditsMessage(locale: Locale = "zh"): string {
  return locale === "en"
    ? "You're out of Credits for this cycle. Buy a top-up pack or upgrade your plan to keep generating."
    : "本月创作点数已用完，购买补充包或升级套餐后可以继续生成。";
}

export function outOfCreditsActionLabel(locale: Locale = "zh"): string {
  return locale === "en" ? "Top up or upgrade" : "购买补充包 / 升级套餐";
}

export function outOfCreditsBody(locale: Locale = "zh"): { error: string; code: typeof INSUFFICIENT_CREDITS_CODE } {
  return { error: outOfCreditsMessage(locale), code: INSUFFICIENT_CREDITS_CODE };
}

export function isOutOfCredits(status?: number | null, code?: string | null): boolean {
  return status === 402 || code === INSUFFICIENT_CREDITS_CODE;
}

/** Short cost hint for action buttons, e.g. "3 点" / "3 Credits". */
export function creditCostLabel(cost: number, locale: Locale = "zh"): string {
  return locale === "en" ? `${cost} Credit${cost === 1 ? "" : "s"}` : `${cost} 点`;
}

export function notifyCreditsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
}
