import { describe, expect, it } from "vitest";
import { classifyAuthError, localizeAuthError } from "@/lib/auth-errors";
import { mapSignupError } from "@/lib/signup-error";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { createRecoveryGrant, verifyRecoveryGrant } from "@/lib/auth-recovery-grant";

const zh = new Headers({ cookie: "finfold-locale=zh" });
const en = new Headers({ cookie: "finfold-locale=en" });

describe("auth provider error localization", () => {
  it.each([
    [{ code: "over_request_rate_limit", message: "For security purposes, you can only request this after 30 seconds." }, "rate_limited"],
    [{ message: "Invalid login credentials" }, "invalid_credentials"],
    [{ code: "email_not_confirmed", message: "Email not confirmed" }, "email_not_confirmed"],
    [{ code: "email_exists", message: "A user with this email address has already been registered" }, "already_registered"],
    [{ code: "same_password", message: "New password should be different from the old password." }, "same_password"],
    [{ code: "weak_password", message: "Password should be at least 6 characters." }, "weak_password"],
    [{ message: "Something odd" }, "unknown"]
  ])("classifies %o as %s", (error, kind) => {
    expect(classifyAuthError(error)).toBe(kind);
  });

  it("answers in Chinese for Chinese visitors and never echoes unknown provider text", () => {
    expect(localizeAuthError(zh, { code: "same_password", message: "New password should be different" }, { zh: "失败", en: "Failed" }))
      .toMatchObject({ error: "新密码不能与当前密码相同。", status: 400 });
    expect(localizeAuthError(zh, { message: "Database error saving new user" }, { zh: "失败，请重试。", en: "Failed." }).error)
      .toBe("失败，请重试。");
    expect(localizeAuthError(en, { message: "Invalid login credentials" }, { zh: "x", en: "y" }).status).toBe(401);
  });

  it("localizes signup errors when request headers are available", () => {
    expect(mapSignupError({ message: "User already registered" }, zh)).toEqual({
      error: "该邮箱已注册，请直接登录或找回密码。",
      status: 409
    });
    expect(mapSignupError({ message: "Database error" }, zh).error).toBe("注册失败，请重试。");
  });

  it("localizes the shared API rate-limit response", async () => {
    const request = new Request("https://www.finfold.app/api/auth/login", { headers: { cookie: "finfold-locale=zh", "x-forwarded-for": "203.0.113.77" } });
    const options = { scope: `test-zh-${crypto.randomUUID()}`, subject: "same", limit: 1, windowMs: 1000 };
    expect(enforceApiRateLimit(request, options)).toBeNull();
    const limited = enforceApiRateLimit(request, options);
    expect(limited?.status).toBe(429);
    expect((await limited!.json()).error).toBe("请求太频繁，请稍等片刻再试。");
  });
});

describe("password recovery grant", () => {
  it("is bound to the user and expires", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-0123456789";
    const now = Date.now();
    const grant = await createRecoveryGrant("user-1", now);
    expect(grant).toBeTruthy();
    expect(await verifyRecoveryGrant(grant, "user-1", now)).toBe(true);
    expect(await verifyRecoveryGrant(grant, "user-2", now)).toBe(false);
    expect(await verifyRecoveryGrant(grant, "user-1", now + 31 * 60 * 1000)).toBe(false);
    expect(await verifyRecoveryGrant(`${grant!.split(".")[0]}.${"0".repeat(64)}`, "user-1", now)).toBe(false);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
});
