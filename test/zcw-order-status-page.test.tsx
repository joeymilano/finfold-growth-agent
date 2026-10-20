import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useLocale", () => ({ useLocale: () => "zh" }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,") } }));

import { PayOrderClient } from "@/components/billing/ZcwOrderStatusClient";

function zcwOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    orderCode: "FF-ABCDEF12",
    credits: 2000,
    amountCents: 19900,
    amountYuan: "199.00",
    status: "pending",
    channel: "alipay",
    plan: "creator_v2",
    payType: null,
    payInfo: null,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("scan-to-pay order status page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a paid scan order instead of a 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { order: zcwOrder({ status: "paid" }) })));
    render(<PayOrderClient orderId="order-1" />);
    expect(await screen.findByText("支付成功")).toBeInTheDocument();
    expect(screen.getByText(/创作者已开通/)).toBeInTheDocument();
  });

  it("warns against paying twice on a closed order and restarts the same plan", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/checkout-zcwpay") {
        return json(200, { order: { ...zcwOrder({ id: "order-2", status: "pending", payInfo: "https://pay.example/qr" }), expiresAt: new Date(Date.now() + 600_000).toISOString() } });
      }
      return json(200, { order: zcwOrder({ status: "failed" }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PayOrderClient orderId="order-1" />);

    expect(await screen.findByText("订单已超过付款时间")).toBeInTheDocument();
    expect(screen.getByText(/如已付款请勿重复支付/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /微信支付/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/checkout-zcwpay", expect.objectContaining({ method: "POST" }))
    );
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/checkout-zcwpay") as unknown as [string, { body: string }];
    expect(JSON.parse(call[1].body)).toMatchObject({ kind: "plan", planId: "creator_v2", channel: "wxpay" });
    expect(await screen.findByRole("dialog", { name: "扫码支付" })).toBeInTheDocument();
  });

  it("falls back to the legacy transfer-QR view for non-scan orders", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("/api/zcwpay-order/") ? json(404, { error: "订单不存在。" }) : json(404, { error: "订单不存在。" })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<PayOrderClient orderId="legacy-1" />);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/credits/qrcode-order/legacy-1", { cache: "no-store" })
    );
  });
});
