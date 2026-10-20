import React from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentReturnNotice } from "@/components/billing/PaymentReturnNotice";

vi.mock("@/hooks/useLocale", () => ({ useLocale: () => "zh" }));

function collectToasts() {
  const toasts: Array<{ type: string; message: string }> = [];
  const listener = (event: Event) => toasts.push((event as CustomEvent).detail);
  window.addEventListener("finfold-toast", listener);
  return { toasts, stop: () => window.removeEventListener("finfold-toast", listener) };
}

describe("payment return notice", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("confirms the plan once the webhook lands and strips the return params", async () => {
    window.history.replaceState(null, "", "/dashboard?upgraded=true&plan=growth&market=cn");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: "free" }) })
      .mockResolvedValue({ ok: true, json: async () => ({ plan: "growth_v2" }) }));
    const { toasts, stop } = collectToasts();

    render(<PaymentReturnNotice />);
    expect(window.location.search).toBe("");
    expect(toasts[0]).toMatchObject({ type: "info", message: "支付成功，正在开通增长引擎…" });

    await vi.advanceTimersByTimeAsync(4_100);
    expect(toasts.at(-1)).toMatchObject({ type: "success", message: "增长引擎已开通，新额度可以用了" });
    stop();
  });

  it("tells a cancelled buyer they were not charged", () => {
    window.history.replaceState(null, "", "/billing?cancelled=true");
    const { toasts, stop } = collectToasts();
    render(<PaymentReturnNotice />);
    expect(toasts).toEqual([expect.objectContaining({ type: "info", message: "已取消支付，没有扣款" })]);
    stop();
  });
});
