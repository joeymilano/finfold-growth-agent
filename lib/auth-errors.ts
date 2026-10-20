import { apiError } from "@/lib/i18n";

/**
 * Supabase Auth returns English provider wording (and sometimes only a code).
 * Classify the common cases once so every /api/auth/* route can answer in the
 * visitor's locale instead of passing provider text straight into the UI.
 */
export type AuthProviderError = { message?: string | null; code?: string | null };

export type AuthErrorKind =
  | "rate_limited"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "already_registered"
  | "same_password"
  | "weak_password"
  | "invalid_email"
  | "session_missing"
  | "unknown";

export function classifyAuthError(error: AuthProviderError): AuthErrorKind {
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();

  if (
    code.includes("rate_limit")
    || message.includes("rate limit")
    || message.includes("too many")
    || message.includes("you can only request this after")
  ) return "rate_limited";
  if (
    code === "invalid_credentials"
    || message.includes("invalid login credentials")
    || message.includes("invalid credentials")
  ) return "invalid_credentials";
  if (code === "email_not_confirmed" || message.includes("email not confirmed")) return "email_not_confirmed";
  if (
    code === "user_already_exists"
    || code === "email_exists"
    || message.includes("already registered")
    || message.includes("already been registered")
  ) return "already_registered";
  if (code === "same_password" || message.includes("different from the old password")) return "same_password";
  if (
    code === "weak_password"
    || message.includes("password should")
    || message.includes("password is too weak")
    || message.includes("password does not meet")
  ) return "weak_password";
  if (
    code === "email_address_invalid"
    || (message.includes("email") && (message.includes("invalid") || message.includes("validate")))
  ) return "invalid_email";
  if (
    code === "session_not_found"
    || code === "session_expired"
    || code === "no_authorization"
    || message.includes("auth session missing")
  ) return "session_missing";
  return "unknown";
}

const KNOWN_MESSAGES: Record<Exclude<AuthErrorKind, "unknown">, { zh: string; en: string; status: number }> = {
  rate_limited: {
    zh: "操作太频繁，请稍等片刻再试。",
    en: "Too many attempts. Please wait a moment and try again.",
    status: 429
  },
  invalid_credentials: {
    zh: "邮箱或密码不正确，请检查后重试。",
    en: "Invalid email or password. Please check your credentials and try again.",
    status: 401
  },
  email_not_confirmed: {
    zh: "邮箱还没验证，去收件箱点一下验证链接再登录。没收到可以检查垃圾邮件。",
    en: "Please confirm your email address before signing in. Check your inbox for the confirmation link.",
    status: 403
  },
  already_registered: {
    zh: "该邮箱已注册，请直接登录或找回密码。",
    en: "This email is already registered. Sign in or reset your password instead.",
    status: 409
  },
  same_password: {
    zh: "新密码不能与当前密码相同。",
    en: "Your new password must be different from the current one.",
    status: 400
  },
  weak_password: {
    zh: "密码不满足要求：至少 8 位，需含字母和数字。",
    en: "Password does not meet requirements: at least 8 characters with letters and numbers.",
    status: 400
  },
  invalid_email: {
    zh: "邮箱地址格式不正确。",
    en: "Invalid email address.",
    status: 400
  },
  session_missing: {
    zh: "登录状态已失效，请重新登录。",
    en: "Your session expired. Please sign in again.",
    status: 401
  }
};

/**
 * Localized `{ error, status }` for a provider error. Unknown provider text
 * is never echoed: the caller's fallback (already bilingual) is used instead.
 */
export function localizeAuthError(
  headers: Headers,
  error: AuthProviderError,
  fallback: { zh: string; en: string; status?: number }
): { error: string; status: number; kind: AuthErrorKind } {
  const kind = classifyAuthError(error);
  if (kind === "unknown") {
    return { error: apiError(headers, fallback.zh, fallback.en), status: fallback.status ?? 400, kind };
  }
  const known = KNOWN_MESSAGES[kind];
  return { error: apiError(headers, known.zh, known.en), status: known.status, kind };
}

/** Shared bilingual wording for the "auth backend not configured/available" 503s. */
export function authUnavailableMessage(headers: Headers): string {
  return apiError(headers, "登录服务暂时不可用，请稍后再试。", "Sign-in is temporarily unavailable. Please try again later.");
}
