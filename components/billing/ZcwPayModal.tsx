"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { CheckCircle2, Copy, Loader2, ShieldAlert, X } from "@/components/ui/icons";
import { QRCODE_PLANS, type QrcodePlanId } from "@/lib/payment/qrcode-constants";

// ZCW aggregate-gateway cashier. Shown as an overlay right after
// /api/checkout-zcwpay returns: renders the wallet QR, counts down the order
// window, and polls the order until it flips to paid (the poll itself
// completes fulfillment, so a lost gateway callback never strands the user).
//
// Copy follows the repo rules: no sentence periods in titles, no internal
// payment-rail jargon on screen.

export type ZcwCheckoutOrder = {
  id: string;
  orderCode: string;
  amountYuan: string;
  credits: number;
  channel: "alipay" | "wxpay" | null;
  payType: string | null;
  payInfo: string | null;
  expiresAt: string | null;
  /** Pricing V2 plan for a subscription order; null for a credit-pack order. */
  plan: QrcodePlanId | null;
  status: string;
};

const POLL_INTERVAL_MS = 3000;

function planNameCN(plan: QrcodePlanId): string {
  return QRCODE_PLANS[plan].nameCN;
}

export function ZcwPayModal({
  order,
  onClose,
  onPaid
}: {
  order: ZcwCheckoutOrder;
  onClose: () => void;
  /** Called once when the order turns paid — lets the host refresh balances. */
  onPaid?: () => void;
}) {
  const isEn = false; // scan-to-pay is CN-only; zh copy with en fallbacks.
  const [status, setStatus] = useState<"waiting" | "paid" | "expired">(
    order.status === "paid" ? "paid" : "waiting"
  );
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  // While the order is still awaiting payment, closing asks first: the
  // buyer may have scanned already and the payment can still be landing.
  const [confirmingClose, setConfirmingClose] = useState(false);
  const paidNotified = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const requestCloseRef = useRef<() => void>(() => undefined);

  const requestClose = useCallback(() => {
    if (status === "waiting") {
      setConfirmingClose((open) => !open);
      return;
    }
    onClose();
  }, [status, onClose]);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestCloseRef.current();
      } else if (event.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'
        ) ?? []);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  const channelLabel =
    order.channel === "wxpay"
      ? isEn ? "WeChat Pay" : "微信支付"
      : isEn ? "Alipay" : "支付宝";

  // Render the QR once from the checkout response payload.
  useEffect(() => {
    if (status !== "waiting" || !order.payInfo) return;
    let active = true;
    QRCode.toDataURL(order.payInfo, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" }
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [order.payInfo, status]);

  // Poll order status; a paid answer means fulfillment already happened.
  const poll = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/zcwpay-order/${order.id}`, { cache: "no-store" });
      const data = (await res.json()) as { order?: { status?: string }; error?: string };
      if (res.ok && data.order?.status === "paid") {
        setStatus("paid");
        return true;
      }
    } catch {
      // transient network error — next tick retries
    }
    return false;
  }, [order.id]);

  // Countdown + expiry. The wallet can still settle a QR scanned just before
  // the window closed, so the timeout does one last status check first.
  useEffect(() => {
    if (status !== "waiting" || !order.expiresAt) return;
    let cancelled = false;
    const tick = () => {
      const left = new Date(order.expiresAt as string).getTime() - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        window.clearInterval(timer);
        void poll().then((paid) => {
          if (!cancelled && !paid) setStatus("expired");
        });
      } else {
        setRemainingMs(left);
      }
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [order.expiresAt, status, poll]);

  useEffect(() => {
    if (status !== "waiting") return;
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [poll, status]);

  useEffect(() => {
    if (status === "paid" && !paidNotified.current) {
      paidNotified.current = true;
      onPaid?.();
    }
  }, [status, onPaid]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(order.orderCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  function formatRemaining(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  const itemLabel = order.plan
    ? planNameCN(order.plan)
    : `${order.credits.toLocaleString()} ${isEn ? "credits" : "创作点数"}`;

  return (
    <div
      ref={dialogRef}
      className="workspace-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={isEn ? "Scan to pay" : "扫码支付"}
    >
      <div className="panel-inset relative w-full max-w-sm rounded-2xl p-6">
        <button
          ref={closeRef}
          type="button"
          onClick={requestClose}
          aria-label={isEn ? "Close" : "关闭"}
          className="focus-ring absolute right-4 top-4 rounded-lg p-1.5 text-fg-muted transition-colors hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>

        {status === "waiting" && confirmingClose ? (
          <div
            role="alertdialog"
            aria-labelledby="zcw-close-confirm-title"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-2xl bg-bg/95 p-6 text-center"
          >
            <ShieldAlert className="h-9 w-9 text-warning" />
            <div>
              <h2 id="zcw-close-confirm-title" className="text-base font-bold text-fg">
                {isEn ? "Close the payment window?" : "确定关闭付款窗口"}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-fg-muted">
                {isEn
                  ? "If you've already scanned and paid, don't pay again. It activates automatically once the payment lands; you can check it under Order history."
                  : "如已扫码付款，请勿重复支付。到账后会自动开通，可在订单记录查看结果。"}
              </p>
            </div>
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className="btn-primary focus-ring flex-1 rounded-xl px-4 py-2 text-xs font-bold"
              >
                {isEn ? "Keep waiting" : "继续等待"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost focus-ring flex-1 rounded-xl px-4 py-2 text-xs font-bold"
              >
                {isEn ? "Close anyway" : "仍要关闭"}
              </button>
            </div>
          </div>
        ) : null}

        {status === "paid" ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/15 text-brand">
              <CheckCircle2 className="h-9 w-9" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-fg">
                {isEn ? "Payment received" : "支付成功"}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-fg-muted">
                {order.plan
                  ? isEn
                    ? `${planNameCN(order.plan)} is active for 30 days. It reverts to the free plan on expiry.`
                    : `${planNameCN(order.plan)}已开通，有效期 30 天，到期后自动恢复为免费版`
                  : isEn
                    ? `${order.credits.toLocaleString()} credits have been added to your account.`
                    : `${order.credits.toLocaleString()} 创作点数已到账，可立即使用`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary focus-ring rounded-xl px-4 py-2 text-xs font-bold"
            >
              {isEn ? "Done" : "完成"}
            </button>
          </div>
        ) : status === "expired" ? (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <ShieldAlert className="h-10 w-10 text-risk" />
            <div>
              <h2 className="text-lg font-bold text-fg">{isEn ? "Payment window closed" : "付款时间已到"}</h2>
              <p className="mt-1.5 text-sm leading-6 text-fg-muted">
                {isEn
                  ? "If you've already paid, don't pay again — it activates automatically once the payment lands. Check the order status in a moment."
                  : "如已付款请勿重复支付，到账后会自动开通，稍后可刷新订单状态查看。未付款可关闭后重新发起支付。"}
              </p>
            </div>
            <div className="flex w-full gap-2">
              <Link
                href={`/billing/pay/${order.id}`}
                className="btn-ghost focus-ring flex-1 rounded-xl px-4 py-2 text-xs font-bold"
              >
                {isEn ? "Check order status" : "查看订单状态"}
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary focus-ring flex-1 rounded-xl px-4 py-2 text-xs font-bold"
              >
                {isEn ? "Close" : "知道了"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <div>
              <h2 className="text-lg font-bold text-fg">
                {isEn ? `Scan with ${channelLabel}` : `使用${channelLabel}扫码付款`}
              </h2>
              <p className="mt-1 text-xs text-fg-muted">
                {itemLabel} · ¥{order.amountYuan}
                {isEn ? "" : " · "}
                {isEn ? "" : remainingMs != null ? `${formatRemaining(remainingMs)} 内有效` : null}
              </p>
            </div>

            <div className="workspace-payment-code rounded-2xl border border-hairline bg-white p-3">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt={isEn ? "Payment QR code" : "支付二维码"}
                  width={220}
                  height={220}
                  className="h-[220px] w-[220px]"
                />
              ) : order.payInfo ? (
                <div className="flex h-[220px] w-[220px] items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-brand" />
                </div>
              ) : (
                <div className="flex h-[220px] w-[220px] flex-col items-center justify-center gap-2 px-4">
                  <ShieldAlert className="h-8 w-8 text-risk" />
                  <p className="text-xs leading-5 text-fg-muted">
                    {isEn
                      ? "The code is unavailable. Close this window and start a new payment."
                      : "二维码获取失败，请关闭后重新发起支付"}
                  </p>
                </div>
              )}
            </div>

            {order.payInfo && order.payType !== "qrcode" ? (
              <a
                href={order.payInfo}
                className="btn-primary focus-ring rounded-xl px-4 py-2 text-xs font-bold"
              >
                {isEn ? "Open payment page" : "打开支付页面"}
              </a>
            ) : null}

            <button
              type="button"
              onClick={() => void copyCode()}
              className="focus-ring inline-flex items-center gap-2 rounded-xl border border-hairline px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
            >
              {isEn ? "Order" : "订单号"} {order.orderCode}{" "}
              {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
            </button>

            <p className="text-[11px] leading-5 text-fg-muted">
              {isEn
                ? "Keep this window open. The page updates itself once the payment lands."
                : "请保持本窗口打开，到账后会自动完成"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
