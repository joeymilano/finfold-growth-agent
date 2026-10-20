"use client";

import React, { useEffect, useRef } from "react";
import { useAuthUser } from "@/components/auth/AuthUserProvider";
import { addToast } from "@/components/ui/Toast";
import { useLocale } from "@/hooks/useLocale";
import { entitlementPlanName, isPaidPublicPlanKey, PRICING_PLANS } from "@/lib/pricing";

const RETURN_PARAMS = ["upgraded", "plan", "market", "purchased", "cancelled"];
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 2000;

async function readEffectivePlan(): Promise<string | null> {
  try {
    const response = await fetch("/api/entitlements/check", { method: "POST", cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json() as { plan?: string };
    return data.plan ?? null;
  } catch {
    return null;
  }
}

/**
 * Confirms a card checkout when the buyer lands back from the payment page.
 * The plan unlocks via an asynchronous webhook, so without this the user sees
 * an unchanged free account and no sign their payment went through.
 */
export function PaymentReturnNotice() {
  const locale = useLocale();
  const { refresh } = useAuthUser();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    const url = new URL(window.location.href);
    const upgraded = url.searchParams.get("upgraded") === "true";
    const purchased = url.searchParams.get("purchased");
    const cancelled = url.searchParams.get("cancelled") === "true";
    const requestedPlan = url.searchParams.get("plan");
    if (!upgraded && !purchased && !cancelled) return;
    handledRef.current = true;

    for (const key of RETURN_PARAMS) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

    const en = locale === "en";
    if (cancelled) {
      addToast("info", en ? "Checkout cancelled — you were not charged." : "已取消支付，没有扣款");
      return;
    }
    if (purchased) {
      addToast("success", en ? "Payment received. Credits land in your balance within a few seconds." : "支付成功，创作点数几秒内到账");
      return;
    }

    const publicPlan = isPaidPublicPlanKey(requestedPlan) ? requestedPlan : null;
    const planName = publicPlan
      ? entitlementPlanName(PRICING_PLANS[publicPlan].internalPlan, locale)
      : (en ? "Your plan" : "套餐");
    addToast("info", en ? `Payment received — activating ${planName}…` : `支付成功，正在开通${planName}…`, POLL_ATTEMPTS * POLL_INTERVAL_MS);

    void (async () => {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
        const plan = await readEffectivePlan();
        if (plan && plan !== "free") {
          await refreshRef.current();
          addToast("success", en ? `${planName} is active. Your new allowance is ready.` : `${planName}已开通，新额度可以用了`, 6000);
          return;
        }
      }
      addToast("info", en ? "Payment received. Activation can take a minute — refresh to see your new plan." : "付款已收到，开通可能需要 1 分钟，稍后刷新页面即可看到新套餐", 8000);
    })();
  }, [locale]);

  return null;
}
