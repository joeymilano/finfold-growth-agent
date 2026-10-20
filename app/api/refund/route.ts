
import { NextResponse } from "next/server";
import { createSupabaseAdminClient, getCurrentUserId } from "@/lib/supabase";
import { isPaidPlan, isSubscriptionCurrentlyActive } from "@/lib/payment/entitlements";
import { PLAN_MONTHLY_LIMITS } from "@/lib/payment/types";
import {
  retrieveCreemSubscription,
  cancelCreemSubscription,
  isWithinRefundWindow
} from "@/lib/payment/creem-management";
import { requestOrderRefund } from "@/lib/payment/order-refund";
import { revokePaidPlanCredits } from "@/lib/payment/credits";
import { captureServerEvent } from "@/lib/posthog-server";
import {
  notifyRefundRequested,
  notifyUserRefundConfirmed
} from "@/lib/notifications/refund-email";
import { brand } from "@/lib/brand";
import { apiError, detectLocaleFromHeaders } from "@/lib/i18n";

/**
 * In-app self-service refund request.
 *
 * With `{ orderId }` it refunds a one-off order (credit pack / scan-to-pay
 * plan month) — see lib/payment/order-refund.ts; the 3-day window runs
 * against our own confirmed_at and packs get their credits frozen.
 *
 * Without it, a scan-to-pay subscriber (no live Creem subscription) is routed
 * to their latest paid scan-to-pay order for the current plan, which then
 * follows the one-off order flow above. Otherwise the original Creem
 * subscription flow applies:
 * authenticate → load active Creem subscription → reject duplicate
 * pending requests → verify the 3-day window against Creem's authoritative
 * charge date → record the request → cancel the subscription (stop the next
 * renewal) → downgrade the profile → notify the team.
 *
 * Creem has no public refund API, so the actual money movement is a dashboard
 * action by an operator; this endpoint gives the user a one-click, no-email,
 * trackable request and the webhook (`refund.created`) closes the loop.
 */
export async function POST(request: Request) {
  try {
    const userId = await getCurrentUserId();

    const body = (await request.json().catch(() => ({}))) as { reason?: string; orderId?: string };
    const reason =
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim().slice(0, 500)
        : null;

    // One-off order refund (credit pack / scan-to-pay plan month).
    const locale = detectLocaleFromHeaders(request.headers);
    const refundOrder = async (orderId: string) => {
      const result = await requestOrderRefund(userId, orderId, reason, locale);
      if (result.status === "rejected") {
        return NextResponse.json({ error: result.message }, { status: result.httpCode });
      }
      return NextResponse.json({ status: result.status, message: result.message });
    };

    if (typeof body.orderId === "string" && body.orderId.length > 0) {
      return refundOrder(body.orderId);
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: apiError(request.headers, "服务暂不可用，请稍后再试", "Service unavailable.") },
        { status: 503 }
      );
    }

    // 1. Load the user's profile + most recent Creem subscription.
    const [{ data: profile }, { data: subscription }] = await Promise.all([
      supabase.from("profiles").select("id, plan").eq("id", userId).maybeSingle(),
      supabase
        .from("subscriptions")
        .select("provider_subscription_id, status, current_period_end, payment_provider")
        .eq("user_id", userId)
        .eq("payment_provider", "creem")
        .not("provider_subscription_id", "is", null)
        .order("current_period_end", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
    ]);

    if (!profile || !isPaidPlan(profile.plan)) {
      return NextResponse.json(
        { error: apiError(request.headers, "只有付费订阅用户可申请退款", "Only paid subscribers can request a refund.") },
        { status: 400 }
      );
    }

    // Scan-to-pay plans have no Creem subscription behind them — refund the
    // paid scan-to-pay order that opened the current plan instead.
    const creemActive = isSubscriptionCurrentlyActive(
      subscription
        ? { status: subscription.status, currentPeriodEnd: subscription.current_period_end, provider: "creem" }
        : null
    );
    if (!creemActive) {
      const { data: scanOrder } = await supabase
        .from("credit_purchases")
        .select("id")
        .eq("user_id", userId)
        .eq("provider", "zcwpay")
        .eq("status", "paid")
        .eq("plan", profile.plan)
        .order("confirmed_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (scanOrder?.id) {
        return refundOrder(scanOrder.id as string);
      }
    }

    const subscriptionId = subscription?.provider_subscription_id;
    if (!subscriptionId) {
      return NextResponse.json(
        {
          error: apiError(
            request.headers,
            `未找到可自助退款的订阅。请在「订单记录」中对具体订单申请退款，或邮件 ${brand.legal.contactEmail} 处理`,
            `No refundable subscription found. Request a refund on the specific order under Order history, or email ${brand.legal.contactEmail}.`
          )
        },
        { status: 404 }
      );
    }

    // 2. Reject a duplicate pending SUBSCRIPTION request (fast path; the
    //    per-target unique partial index on refund_requests is the durable
    //    guard — order refunds may coexist with it).
    const { data: existingOpen } = await supabase
      .from("refund_requests")
      .select("id, requested_at")
      .eq("user_id", userId)
      .eq("status", "pending")
      .not("provider_subscription_id", "is", null)
      .maybeSingle();

    if (existingOpen) {
      return NextResponse.json({
        status: "already_requested",
        message: apiError(request.headers, "你的退款申请正在处理中", "Your refund request is already in progress.")
      });
    }

    // 3. Verify the 3-day window against Creem's authoritative charge date.
    //    subscriptions.* doesn't store the charge amount/date, so we ask Creem.
    let creemSub;
    try {
      creemSub = await retrieveCreemSubscription(subscriptionId);
    } catch (err) {
      console.error("[refund] retrieve failed:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        {
          error: apiError(
            request.headers,
            `暂时无法核验订阅状态，请稍后再试或邮件 ${brand.legal.contactEmail}`,
            `Unable to verify subscription status right now. Please try again or email ${brand.legal.contactEmail}.`
          )
        },
        { status: 502 }
      );
    }

    const chargeDate = creemSub.last_transaction_date ?? creemSub.current_period_start_date;
    if (!isWithinRefundWindow(chargeDate)) {
      return NextResponse.json(
        {
          error: apiError(
            request.headers,
            `你最近一笔扣费已超过 3 天退款期。请邮件 ${brand.legal.contactEmail}，我们会尽量协助`,
            `Your most recent charge is outside the 3-day refund window. Email ${brand.legal.contactEmail} and we'll see what we can do.`
          )
        },
        { status: 409 }
      );
    }

    const txn = creemSub.last_transaction ?? {};

    // 4. Record the refund request BEFORE canceling, so a cancel failure
    //    still leaves an auditable, operator-visible row.
    const { error: insertError } = await supabase.from("refund_requests").insert({
      user_id: userId,
      provider: "creem",
      provider_subscription_id: subscriptionId,
      provider_order_id: txn.order ?? null,
      plan: profile.plan,
      amount: typeof txn.amount === "number" ? txn.amount : null,
      currency: txn.currency ?? null,
      reason,
      status: "pending"
    });

    if (insertError) {
      if (insertError.code === "23505") {
        // Lost the race to the one-open-per-user unique index.
        return NextResponse.json({
          status: "already_requested",
          message: apiError(request.headers, "你的退款申请正在处理中", "Your refund request is already in progress.")
        });
      }
      console.error("[refund] insert failed:", JSON.stringify(insertError));
      return NextResponse.json(
        { error: apiError(request.headers, "提交退款申请失败", "Failed to submit refund request.") },
        { status: 500 }
      );
    }

    // 5. Cancel the subscription so the user isn't charged again next month.
    //    A failure here is recoverable by ops (the request is already logged),
    //    so we don't surface it to the user as a hard error.
    try {
      await cancelCreemSubscription(subscriptionId, "immediate");
    } catch (cancelError) {
      console.error(
        "[refund] cancel failed (request still recorded):",
        cancelError instanceof Error ? cancelError.message : cancelError
      );
    }

    // 6. Downgrade the profile immediately. The subscription.canceled webhook
    //    will reconcile this too, but doing it now avoids a paid-only window.
    await supabase
      .from("profiles")
      .update({
        plan: "free",
        monthly_limit: PLAN_MONTHLY_LIMITS.free,
        subscription_status: "canceled",
        updated_at: new Date().toISOString()
      })
      .eq("id", userId);

    // 6b. The refunded month's unspent plan credits go back with the money.
    const revocation = await revokePaidPlanCredits(userId, { subscription_id: subscriptionId });

    // 7. Notify the team (PostHog). captureServerEvent is best-effort.
    await captureServerEvent(userId, "refund_requested", {
      plan: profile.plan,
      subscription_id: subscriptionId,
      order_id: txn.order ?? null,
      amount: txn.amount ?? null,
      currency: txn.currency ?? null,
      credits_revoked: revocation?.revoked ?? null,
      paid_credits_consumed: revocation?.consumedPaid ?? null
    }).catch(() => undefined);

    // 8. Resolve the user's email once for both notifications below.
    let userEmail = "(unknown)";
    try {
      const {
        data: { user: authUser }
      } = await supabase.auth.admin.getUserById(userId);
      userEmail = authUser?.email ?? "(unknown)";
    } catch {
      // best-effort; notifications fall back to "(unknown)"
    }

    // 9. Email the team (best-effort — never blocks the refund). Requires
    //    RESEND_API_KEY + REFUND_NOTIFY_EMAIL; skips silently if unset.
    try {
      await notifyRefundRequested({
        userEmail,
        userId,
        plan: profile.plan,
        subscriptionId,
        orderId: txn.order ?? null,
        amount: typeof txn.amount === "number" ? txn.amount : null,
        currency: txn.currency ?? null,
        reason,
        creditsRevoked: revocation?.revoked ?? null,
        paidCreditsConsumed: revocation?.consumedPaid ?? null
      });
    } catch (notifyError) {
      console.error(
        "[refund] team email notify failed:",
        notifyError instanceof Error ? notifyError.message : notifyError
      );
    }

    // 10. Email the user a bilingual confirmation (best-effort). Reassures them
    //     the refund is received and sets expectations on timing.
    try {
      await notifyUserRefundConfirmed({
        userEmail,
        plan: profile.plan,
        subscriptionId,
        amount: typeof txn.amount === "number" ? txn.amount : null,
        currency: txn.currency ?? null
      });
    } catch (userNotifyError) {
      console.error(
        "[refund] user email notify failed:",
        userNotifyError instanceof Error ? userNotifyError.message : userNotifyError
      );
    }

    return NextResponse.json({
      status: "requested",
      message: apiError(
        request.headers,
        "退款申请已受理。款项将按原支付方式退回，通常 5–10 个工作日到账",
        "Refund request received. It will be returned to your original payment method, typically within 5–10 business days."
      )
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json(
        { error: apiError(request.headers, "请先登录", "Please log in to request a refund.") },
        { status: 401 }
      );
    }
    console.error("[refund] error:", error);
    return NextResponse.json(
      {
        error: apiError(request.headers, "处理退款申请失败，请稍后再试", "Failed to process refund request.")
      },
      { status: 500 }
    );
  }
}

/**
 * GET — surface the user's refund eligibility + most recent request, so the
 * billing page can show the right button state without calling Creem on load.
 * The 3-day-window check itself happens at POST time (it needs a Creem API
 * call), so `eligible` here only means "is a paid subscriber".
 */
export async function GET(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json(
        { error: apiError(request.headers, "服务暂不可用，请稍后再试", "Service unavailable.") },
        { status: 503 }
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("plan, subscription_status")
      .eq("id", userId)
      .maybeSingle();

    const { data: latestRequest } = await supabase
      .from("refund_requests")
      .select("status, requested_at, resolved_at")
      .eq("user_id", userId)
      .not("provider_subscription_id", "is", null)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const paid = Boolean(profile && isPaidPlan(profile.plan));
    return NextResponse.json({
      eligible: paid,
      plan: profile?.plan ?? "free",
      latestRequest: latestRequest ?? null
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: apiError(request.headers, "请先登录", "Please log in.") }, { status: 401 });
    }
    return NextResponse.json(
      { error: apiError(request.headers, "加载退款状态失败", "Failed to load refund status.") },
      { status: 500 }
    );
  }
}
