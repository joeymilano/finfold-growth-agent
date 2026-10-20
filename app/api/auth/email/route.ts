
import { NextResponse } from "next/server";
import { createSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabase";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { getAuthCallbackUrl } from "@/lib/auth-callback-url";
import { apiError } from "@/lib/i18n";
import { authUnavailableMessage, localizeAuthError } from "@/lib/auth-errors";

/**
 * POST /api/auth/email
 *
 * Update the current user's email address.
 * The server client validates the session cookie before performing
 * the update, so the secret key is never exposed to the browser.
 *
 * Expected body: { email: string }
 */
export async function POST(request: Request) {
  const rateLimited = enforceApiRateLimit(request, { scope: "auth:email", limit: 5, windowMs: 60 * 60 * 1000 });
  if (rateLimited) return rateLimited;

  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: authUnavailableMessage(request.headers) },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
  };

  const email = body.email?.trim();

  if (!email) {
    return NextResponse.json(
      { error: apiError(request.headers, "请输入新邮箱地址。", "New email address is required.") },
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

  // Verify the user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: apiError(request.headers, "登录状态已失效，请重新登录后再修改邮箱。", "You must be logged in to update your email.") },
      { status: 401 }
    );
  }

  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: getAuthCallbackUrl(request) }
  );

  if (error) {
    const mapped = localizeAuthError(request.headers, error, {
      zh: "邮箱修改失败，请稍后重试。",
      en: "Failed to update email. Please try again."
    });
    return NextResponse.json(
      {
        error: mapped.kind === "already_registered"
          ? apiError(request.headers, "该邮箱已被其他账号使用，请换一个邮箱。", "This email is already used by another account.")
          : mapped.error
      },
      { status: mapped.status }
    );
  }

  return NextResponse.json({ ok: true });
}
