import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZcwPayModal, type ZcwCheckoutOrder } from "@/components/billing/ZcwPayModal";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn() } }));

const order: ZcwCheckoutOrder = {
  id: "test-order", orderCode: "TEST", amountYuan: "79", credits: 600,
  channel: "alipay", payType: null, payInfo: null, expiresAt: null, plan: null, status: "waiting"
};

describe("payment dialog keyboard access", () => {
  it("asks before closing an unpaid order with Escape, without marking it paid", () => {
    const onClose = vi.fn();
    const onPaid = vi.fn();
    const { unmount } = render(<ZcwPayModal order={order} onClose={onClose} onPaid={onPaid} />);
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("确定关闭付款窗口")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "仍要关闭" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPaid).not.toHaveBeenCalled();
    unmount();
  });

  it("lets the buyer keep waiting from the close confirmation", () => {
    const onClose = vi.fn();
    const { unmount } = render(<ZcwPayModal order={order} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "继续等待" }));
    expect(screen.queryByText("确定关闭付款窗口")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("closes a paid order immediately", () => {
    const onClose = vi.fn();
    const { unmount } = render(<ZcwPayModal order={{ ...order, status: "paid" }} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
  });

  it("keeps Tab within the dialog and restores the previous focus on close", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(<ZcwPayModal order={{ ...order, status: "paid" }} onClose={vi.fn()} />);
    const close = screen.getByRole("button", { name: "关闭" });
    const done = screen.getByRole("button", { name: "完成" });
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(done).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});

describe("payment window timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("checks the order once more at timeout and warns against paying twice", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: { status: "pending" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(
      <ZcwPayModal order={{ ...order, expiresAt: new Date(Date.now() + 1500).toISOString() }} onClose={vi.fn()} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/zcwpay-order/test-order", { cache: "no-store" });
    expect(screen.getByText("付款时间已到")).toBeInTheDocument();
    expect(screen.getByText(/如已付款请勿重复支付/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看订单状态" })).toHaveAttribute("href", "/billing/pay/test-order");
    unmount();
  });

  it("shows success when the final timeout check finds the payment", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order: { status: "paid" } }) }));
    const onPaid = vi.fn();
    const { unmount } = render(
      <ZcwPayModal order={{ ...order, expiresAt: new Date(Date.now() + 500).toISOString() }} onClose={vi.fn()} onPaid={onPaid} />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(screen.getByText("支付成功")).toBeInTheDocument();
    expect(onPaid).toHaveBeenCalledOnce();
    unmount();
  });
});
