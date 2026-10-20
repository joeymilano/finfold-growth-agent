import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient, createSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabase";
import { accountHasPassword } from "@/lib/auth-password-state";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { analyzePassword } from "@/lib/password-policy";
import { apiError } from "@/lib/i18n";
import { authUnavailableMessage, classifyAuthError, localizeAuthError } from "@/lib/auth-errors";
import {
  readCookie,
  RECOVERY_GRANT_COOKIE,
  recoveryGrantCookieOptions,
  verifyRecoveryGrant
} from "@/lib/auth-recovery-grant";

/**
 * POST /api/auth/password
 *
 * Update the current user's password.
 *
 * - Settings change-password: the current password is required whenever the
 *   account already has an email password, so a borrowed or stolen session
 *   alone cannot take over the account.
 * - Recovery email (/reset-password): the callback issued a short-lived signed
 *   recovery grant, which stands in for the forgotten current password.
 * - OAuth-only accounts setting their first password have nothing to verify.
 *
 * After a successful change every other session is signed out.
 *
 * Expected body: { password: string, currentPassword?: string }
 */
export async function POST(request: Request) {
  const rateLimited = enforceApiRateLimit(request, { scope: "auth:password", limit: 5, windowMs: 60 * 60 * 1000 });
  if (rateLimited) return rateLimited;

  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { error: authUnavailableMessage(request.headers) },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    password?: string;
    currentPassword?: string;
  };

  const password = typeof body.password === "string" ? body.password : "";
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";

  if (!password) {
    return NextResponse.json(
      { error: apiError(request.headers, "请输入新密码。", "New password is required.") },
      { status: 400 }
    );
  }

  // 密码强度硬校验（与前端 / 注册共享同一策略，防绕过）
  const pwdResult = analyzePassword(password);
  if (!pwdResult.valid) {
    return NextResponse.json(
      { error: apiError(request.headers, `密码不满足要求：${pwdResult.messageZh}。`, pwdResult.messageEn || "Password does not meet requirements.") },
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
      { error: apiError(request.headers, "登录状态已失效，请重新登录。", "You must be logged in to update your password.") },
      { status: 401 }
    );
  }

  const recoveryGranted = await verifyRecoveryGrant(readCookie(request, RECOVERY_GRANT_COOKIE), user.id);
  const hadPassword = accountHasPassword(user);
  if (!recoveryGranted && hadPassword) {
    if (!currentPassword) {
      return NextResponse.json(
        {
          error: apiError(request.headers, "请输入当前密码。", "Enter your current password."),
          code: "current_password_required"
        },
        { status: 400 }
      );
    }
    const verification = user.email
      ? await verifyCurrentPassword(user.email, currentPassword)
      : "invalid";
    if (verification === "rate_limited") {
      return NextResponse.json(
        { error: apiError(request.headers, "尝试太频繁，请稍等片刻再试。", "Too many attempts. Please wait a moment and try again.") },
        { status: 429 }
      );
    }
    if (verification !== "ok") {
      return NextResponse.json(
        {
          error: apiError(request.headers, "当前密码不正确。", "Your current password is incorrect."),
          code: "current_password_invalid"
        },
        { status: 400 }
      );
    }
  }

  const { error } = await supabase.auth.updateUser({
    password,
  });

  if (error) {
    const mapped = localizeAuthError(request.headers, error, {
      zh: "密码更新失败，请重试。",
      en: "Failed to update password. Please try again."
    });
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  // OAuth-only accounts that just set their first password must confirm it
  // from now on; Supabase doesn't add an "email" identity for them.
  if (!hadPassword) {
    const admin = createSupabaseAdminClient();
    const { error: flagError } = admin
      ? await admin.auth.admin.updateUserById(user.id, {
          // GoTrue merges app_metadata keys, so provider fields stay intact.
          app_metadata: { password_set: true }
        })
      : { error: new Error("admin client unavailable") };
    if (flagError) console.error("[auth/password] could not record password_set", flagError.message);
  }

  // A password change must end every other session (a stolen session or a
  // forgotten shared computer). The current device stays signed in.
  try {
    const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
    if (signOutError) console.warn("[auth/password] other sessions sign-out failed", signOutError.code ?? "unknown");
  } catch (signOutError) {
    console.warn("[auth/password] other sessions sign-out threw", signOutError instanceof Error ? signOutError.name : "UnknownError");
  }

  const response = NextResponse.json({ ok: true });
  if (recoveryGranted) {
    response.cookies.set(RECOVERY_GRANT_COOKIE, "", { ...recoveryGrantCookieOptions, maxAge: 0 });
  }
  return response;
}

/**
 * Check the current password with a throwaway, non-persisting client so the
 * browser's session cookies are untouched; the verification session is
 * revoked right away.
 */
async function verifyCurrentPassword(
  email: string,
  password: string
): Promise<"ok" | "invalid" | "rate_limited"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return "invalid";
  const verifier = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data, error } = await verifier.auth.signInWithPassword({ email, password });
  if (error) return classifyAuthError(error) === "rate_limited" ? "rate_limited" : "invalid";
  if (data.session) {
    await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  return "ok";
}
