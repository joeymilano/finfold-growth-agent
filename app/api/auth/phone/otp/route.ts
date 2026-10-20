
import { NextResponse } from "next/server";
import { createSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabase";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { PHONE_AUTH_ENABLED } from "@/lib/auth-features";
import { apiError } from "@/lib/i18n";
import { authUnavailableMessage } from "@/lib/auth-errors";

/**
 * POST /api/auth/phone/otp
 *
 * Send a one-time SMS verification code to a phone number.
 * Calls Supabase `signInWithOtp({ phone })`; the actual SMS delivery is
 * handled by whichever SMS provider is configured on the Supabase project
 * (built-in Twilio/Vonage, or a custom Send SMS Hook — e.g. a China-friendly
 * provider such as Alibaba Cloud / Tencent Cloud SMS).
 *
 * The server client keeps the session/keys server-side. SMS costs money and
 * is abuse-prone, so this endpoint is rate-limited more tightly than login.
 *
 * Expected body: { phone: string }   // E.164 format, e.g. +8613800138000
 */
const E164 = /^\+[1-9]\d{6,14}$/;

export async function POST(request: Request) {
  // The phone entry is hidden while the flag is off; SMS is paid, so the
  // endpoint must not stay reachable by direct calls either.
  if (!PHONE_AUTH_ENABLED) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // SMS is paid & abusable — cap at 5 sends per IP per hour.
  const rateLimited = enforceApiRateLimit(request, {
    scope: "auth:phone-otp",
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (rateLimited) return rateLimited;

  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: authUnavailableMessage(request.headers) },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { phone?: string };
  const phone = body.phone?.trim();

  if (!phone || !E164.test(phone)) {
    return NextResponse.json(
      { error: apiError(request.headers, "手机号格式不正确，请包含国家区号，例如 +8613800138000。", "Invalid phone number. Please include the country code, e.g. +8613800138000.") },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: authUnavailableMessage(request.headers) },
      { status: 503 },
    );
  }

  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: {
      // Auto-register on first use — phone OTP login/sign-up are unified,
      // matching the common China-market UX (no separate sign-up step).
      shouldCreateUser: true,
      channel: "sms",
    },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("rate limit") || message.includes("too many") || message.includes("sms")) {
      return NextResponse.json(
        { error: apiError(request.headers, "验证码发送太频繁，请稍等一分钟再试。", "Too many code requests. Please wait a minute and try again.") },
        { status: 429 },
      );
    }
    if (message.includes("not enabled") || message.includes("provider") || message.includes("phone")) {
      return NextResponse.json(
        { error: apiError(request.headers, "手机号登录暂未开放，请使用邮箱登录。", "Phone login is not enabled. Please use email.") },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: apiError(request.headers, "验证码发送失败，请稍后重试。", "Failed to send verification code.") },
      { status: 400 },
    );
  }

  return NextResponse.json({ sent: true });
}
