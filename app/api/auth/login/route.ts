
import { NextResponse } from "next/server";
import { createSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabase";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { REFERRAL_COOKIE } from "@/lib/referrals";
import { apiError } from "@/lib/i18n";
import { authUnavailableMessage, localizeAuthError } from "@/lib/auth-errors";

/**
 * POST /api/auth/login
 *
 * Sign in an existing user with email and password.
 * The server client sets the session cookie, so the secret key
 * is never exposed to the browser.
 *
 * Expected body: { email: string, password: string }
 */
export async function POST(request: Request) {
  const rateLimited = enforceApiRateLimit(request, { scope: "auth:login", limit: 10, windowMs: 15 * 60 * 1000 });
  if (rateLimited) return rateLimited;

  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: authUnavailableMessage(request.headers) },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  const email = body.email?.trim();
  const password = body.password;

  if (!email || !password) {
    return NextResponse.json(
      { error: apiError(request.headers, "请输入邮箱和密码。", "Email and password are required.") },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: authUnavailableMessage(request.headers) },
      { status: 503 }
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const mapped = localizeAuthError(request.headers, error, {
      zh: "登录失败，请重试。",
      en: "Login failed. Please try again.",
      status: 401
    });
    return NextResponse.json(
      {
        error: mapped.error,
        ...(mapped.kind === "email_not_confirmed" ? { code: "email_not_confirmed" } : {})
      },
      { status: mapped.kind === "unknown" || mapped.kind === "invalid_email" ? 401 : mapped.status }
    );
  }

  const response = NextResponse.json({
    user: data.user
      ? {
          id: data.user.id,
          email: data.user.email,
        }
      : null,
  });
  response.cookies.delete(REFERRAL_COOKIE);
  return response;
}
