import { apiError } from "@/lib/i18n";

type SignupErrorInput = {
  message?: string;
  code?: string;
};

export type SignupErrorResponse = {
  error: string;
  status: number;
  code?: "confirmation_email_rate_limited" | "auth_request_rate_limited";
};

/**
 * Keep provider wording from turning an email-delivery limit into validation.
 * With request headers the message follows the visitor's locale; without them
 * (legacy callers) it stays English.
 */
export function mapSignupError(error: SignupErrorInput, headers?: Headers): SignupErrorResponse {
  const message = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toLowerCase();
  const text = (zh: string, en: string) => (headers ? apiError(headers, zh, en) : en);

  if (code === "over_request_rate_limit" || code === "over_sms_send_rate_limit") {
    return {
      error: text("注册尝试过于频繁，请稍后重试；也可以使用 Google 或 GitHub 继续。", "Too many authentication attempts. Please wait and try again."),
      status: 429,
      code: "auth_request_rate_limited"
    };
  }

  if (
    code.includes("rate_limit")
    || message.includes("rate limit")
    || message.includes("too many requests")
  ) {
    return {
      error: text("确认邮件发送过于频繁，请等待几分钟后重试。", "Too many confirmation emails were requested. Please wait a few minutes and try again."),
      status: 429,
      code: "confirmation_email_rate_limited",
    };
  }

  if (
    code === "user_already_exists"
    || code === "email_exists"
    || message.includes("already registered")
    || message.includes("user already registered")
  ) {
    return {
      error: text("该邮箱已注册，请直接登录或找回密码。", "This email is already registered. Try logging in instead."),
      status: 409,
    };
  }

  if (code === "weak_password" || message.includes("password")) {
    return {
      error: text("密码不满足要求：至少 8 位，需含字母和数字。", "Password does not meet requirements."),
      status: 400
    };
  }

  if (code === "email_address_invalid" || message.includes("email")) {
    return { error: text("邮箱地址格式不正确。", "Invalid email address."), status: 400 };
  }

  return {
    error: headers
      ? apiError(headers, "注册失败，请重试。", "Sign-up failed. Please try again.")
      : error.message || "Sign-up failed. Please try again.",
    status: 400,
  };
}

export function localizeSignupError(
  code: unknown,
  locale: "zh" | "en",
  fallback: string,
): string {
  if (code === "auth_request_rate_limited") return locale === "zh"
    ? "注册尝试过于频繁，请稍后重试；也可以使用 Google 或 GitHub 继续。"
    : "Too many signup attempts. Please wait, or continue with Google or GitHub.";
  if (code !== "confirmation_email_rate_limited") return fallback;
  return locale === "zh"
    ? "确认邮件发送过于频繁，请等待几分钟后重试。"
    : "Too many confirmation emails were requested. Please wait a few minutes and try again.";
}
