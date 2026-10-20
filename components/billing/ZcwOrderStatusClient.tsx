"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock, Loader2, RotateCcw, ShieldAlert } from "@/components/ui/icons";
import { AlipayIcon, WechatPayIcon } from "@/components/billing/PaymentBrandIcons";
import { QrcodePayClient } from "@/components/billing/QrcodePayClient";
import { ZcwPayModal, type ZcwCheckoutOrder } from "@/components/billing/ZcwPayModal";
import { useLocale } from "@/hooks/useLocale";
import { CREDIT_PACKS } from "@/lib/payment/types";
import { QRCODE_PLANS } from "@/lib/payment/qrcode-constants";

// /billing/pay/[id] — the order status page. It is the gateway's return URL
// after a wallet payment and the target of "continue payment" in the order
// history. Scan-to-pay (ZCW) orders are read from /api/zcwpay-order/[id],
// whose GET also asks the gateway and fulfills a payment that landed late;
// any other id falls back to the legacy transfer-QR order view.

const POLL_INTERVAL_MS = 4000;

type ZcwOrderView = ZcwCheckoutOrder & {
  amountCents: number;
  status: "pending" | "paid" | "refunded" | "failed";
};

type LoadState = "loading" | "ready" | "legacy" | "error";

export function PayOrderClient({ orderId }: { orderId: string }) {
  const locale = useLocale();
  const isEn = locale === "en";
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [order, setOrder] = useState<ZcwOrderView | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [restartChannel, setRestartChannel] = useState<"alipay" | "wxpay" | null>(null);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [newOrder, setNewOrder] = useState<ZcwCheckoutOrder | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const restartInFlight = useRef(false);

  const fetchOrder = useCallback(async (): Promise<ZcwOrderView | null> => {
    try {
      const res = await fetch(`/api/zcwpay-order/${orderId}`, { cache: "no-store" });
      if (res.status === 404) {
        setLoadState("legacy");
        return null;
      }
      const data = (await res.json()) as { order?: ZcwOrderView };
      if (!res.ok || !data.order) {
        setLoadState((prev) => (prev === "ready" ? prev : "error"));
        return null;
      }
      setOrder(data.order);
      setLoadState("ready");
      setNow(Date.now());
      return data.order;
    } catch {
      setLoadState((prev) => (prev === "ready" ? prev : "error"));
      return null;
    }
  }, [orderId]);

  // Keep polling while the order can still turn paid inside its window.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const current = await fetchOrder();
      if (!active) return;
      if (current && current.status === "pending" && !isExpired(current, Date.now())) {
        timer = setTimeout(run, POLL_INTERVAL_MS);
      }
    };
    void run();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [fetchOrder]);

  async function refresh() {
    setRefreshing(true);
    await fetchOrder();
    setRefreshing(false);
  }

  async function restartPayment(channel: "alipay" | "wxpay") {
    if (!order || restartInFlight.current) return;
    const body = restartBody(order, channel, isEn);
    if (!body) return;
    restartInFlight.current = true;
    setRestartChannel(channel);
    setRestartError(null);
    try {
      const res = await fetch("/api/checkout-zcwpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = (await res.json()) as { order?: ZcwCheckoutOrder; error?: string };
      if (!res.ok || !data.order) {
        throw new Error(data.error ?? (isEn ? "Unable to start the payment." : "无法发起支付，请稍后重试。"));
      }
      setNewOrder(data.order);
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : isEn ? "Unable to start the payment." : "无法发起支付，请稍后重试。");
    } finally {
      restartInFlight.current = false;
      setRestartChannel(null);
    }
  }

  if (loadState === "legacy") {
    return <QrcodePayClient orderId={orderId} />;
  }

  if (loadState === "loading") {
    return (
      <Shell isEn={isEn}>
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="h-7 w-7 animate-spin text-brand" />
          <p className="text-sm text-fg-muted">{isEn ? "Loading order…" : "加载订单…"}</p>
        </div>
      </Shell>
    );
  }

  if (loadState === "error" || !order) {
    return (
      <Shell isEn={isEn}>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <ShieldAlert className="h-10 w-10 text-risk" />
          <p className="text-sm font-semibold text-fg">
            {isEn ? "Couldn't load this order" : "订单暂时加载不出来"}
          </p>
          <button type="button" onClick={() => void refresh()} className="btn-ghost focus-ring text-xs">
            <RotateCcw className="h-3.5 w-3.5" />
            {isEn ? "Retry" : "重试"}
          </button>
        </div>
      </Shell>
    );
  }

  const itemLabel = order.plan
    ? isEn ? QRCODE_PLANS[order.plan].name : QRCODE_PLANS[order.plan].nameCN
    : isEn
      ? `${order.credits.toLocaleString()} credits`
      : `${order.credits.toLocaleString()} 创作点数`;
  const canRestart = restartBody(order, "alipay", isEn) !== null;
  const expired = order.status === "failed" || (order.status === "pending" && isExpired(order, now));

  const modal = newOrder ? (
    <ZcwPayModal
      order={newOrder}
      onClose={() => {
        const wasPaid = newOrder.status === "paid";
        setNewOrder(null);
        if (wasPaid) window.location.href = "/billing";
      }}
      onPaid={() => setNewOrder((prev) => (prev ? { ...prev, status: "paid" } : prev))}
    />
  ) : null;

  if (order.status === "paid") {
    return (
      <Shell isEn={isEn}>
        <div className="flex flex-col items-center gap-4 py-6 text-center" data-testid="zcw-order-paid">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand/15 text-brand">
            <CheckCircle2 className="h-9 w-9" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-fg">{isEn ? "Payment received" : "支付成功"}</h1>
            <p className="mt-1.5 text-sm leading-6 text-fg-muted">
              {order.plan
                ? isEn
                  ? `${itemLabel} is active for 30 days. It reverts to the free plan on expiry.`
                  : `${itemLabel}已开通，有效期 30 天，到期后自动恢复为免费版`
                : isEn
                  ? `${itemLabel} have been added to your account.`
                  : `${itemLabel}已到账，可立即使用`}
            </p>
          </div>
          <OrderMeta order={order} isEn={isEn} />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Link href="/billing/orders" className="btn-ghost focus-ring rounded-xl px-4 py-2 text-xs font-bold">
              {isEn ? "Order history" : "订单记录"}
            </Link>
            <Link href="/dashboard" className="btn-primary focus-ring rounded-xl px-4 py-2 text-xs font-bold">
              {isEn ? "Start creating" : "开始创作"}
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  if (order.status === "refunded") {
    return (
      <Shell isEn={isEn}>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <RotateCcw className="h-10 w-10 text-fg-muted" />
          <h1 className="text-xl font-bold text-fg">{isEn ? "This order was refunded" : "这笔订单已退款"}</h1>
          <OrderMeta order={order} isEn={isEn} />
          <Link href="/billing/orders" className="btn-ghost focus-ring rounded-xl px-4 py-2 text-xs font-bold">
            {isEn ? "Order history" : "订单记录"}
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell isEn={isEn}>
      <div className="flex flex-col items-center gap-4 text-center" data-testid="zcw-order-open">
        {expired ? (
          <ShieldAlert className="h-10 w-10 text-warning" />
        ) : (
          <Clock className="h-10 w-10 text-brand" />
        )}
        <div>
          <h1 className="text-xl font-bold text-fg">
            {expired
              ? isEn ? "Payment window closed" : "订单已超过付款时间"
              : isEn ? "Waiting for your payment" : "等待付款结果"}
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-fg-muted">
            {expired
              ? isEn
                ? `If you already paid, don't pay again — ${itemLabel} activates automatically once the payment lands. Refresh in a moment, or email support@finfold.app with the order number if it hasn't arrived.`
                : `如已付款请勿重复支付，到账确认后会自动开通${itemLabel}。稍后刷新订单状态即可，长时间未到账请邮件 support@finfold.app 并附上订单号。`
              : isEn
                ? "This page updates itself once the payment lands. If you already paid, don't pay again."
                : "到账后本页会自动更新。如已付款请勿重复支付。"}
          </p>
        </div>

        <OrderMeta order={order} isEn={isEn} />

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="btn-ghost focus-ring text-xs"
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          {isEn ? "Refresh status" : "刷新订单状态"}
        </button>

        {canRestart ? (
          <div className="w-full space-y-2 border-t border-hairline pt-4">
            <p className="text-xs font-semibold text-fg">
              {isEn ? "Haven't paid yet? Start a new payment" : "还没付款？重新发起支付"}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void restartPayment("alipay")}
                disabled={restartChannel !== null}
                className="focus-ring flex items-center justify-center gap-2 rounded-xl border border-hairline bg-bg px-3 py-2 text-xs font-bold text-fg transition hover:border-brand/40 disabled:opacity-50"
              >
                {restartChannel === "alipay" ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlipayIcon className="h-5 w-5" />}
                {isEn ? "Alipay" : "支付宝"}
              </button>
              <button
                type="button"
                onClick={() => void restartPayment("wxpay")}
                disabled={restartChannel !== null}
                className="focus-ring flex items-center justify-center gap-2 rounded-xl border border-hairline bg-bg px-3 py-2 text-xs font-bold text-fg transition hover:border-brand/40 disabled:opacity-50"
              >
                {restartChannel === "wxpay" ? <Loader2 className="h-4 w-4 animate-spin" /> : <WechatPayIcon className="h-5 w-5" />}
                {isEn ? "WeChat Pay" : "微信支付"}
              </button>
            </div>
            {restartError ? <p className="text-xs text-risk">{restartError}</p> : null}
          </div>
        ) : null}
      </div>
      {modal}
    </Shell>
  );
}

function isExpired(order: Pick<ZcwOrderView, "expiresAt">, now: number): boolean {
  if (!order.expiresAt) return false;
  const expiresMs = new Date(order.expiresAt).getTime();
  return Number.isFinite(expiresMs) && expiresMs <= now;
}

/** Checkout body that re-buys the same plan month / credit pack. */
function restartBody(
  order: ZcwOrderView,
  channel: "alipay" | "wxpay",
  isEn: boolean
): Record<string, string> | null {
  if (order.plan) {
    const plan = QRCODE_PLANS[order.plan];
    return {
      kind: "plan",
      planId: order.plan,
      channel,
      name: `Finfold ${isEn ? plan.name : plan.nameCN} · ${isEn ? "1 month" : "1个月"}`
    };
  }
  const pack = CREDIT_PACKS.find(
    (p) => p.credits === order.credits && Math.round(p.priceCNY * 100) === order.amountCents
  );
  if (!pack) return null;
  return {
    kind: "credits",
    packageId: pack.id,
    channel,
    name: `Finfold ${isEn ? pack.name : pack.nameCN}`
  };
}

function OrderMeta({ order, isEn }: { order: ZcwOrderView; isEn: boolean }) {
  return (
    <p className="text-xs text-fg-muted">
      {isEn ? "Order" : "订单号"} <span className="font-mono">{order.orderCode}</span> · ¥{order.amountYuan}
    </p>
  );
}

function Shell({ children, isEn }: { children: React.ReactNode; isEn: boolean }) {
  return (
    <div className="mx-auto max-w-md pb-10">
      <Link
        href="/billing/orders"
        className="focus-ring mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {isEn ? "Order history" : "订单记录"}
      </Link>
      <div className="panel rounded-2xl p-6 sm:p-8">{children}</div>
    </div>
  );
}
