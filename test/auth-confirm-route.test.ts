import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchange: vi.fn(),
  capture: vi.fn().mockResolvedValue(undefined),
  attributeReferral: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { verifyOtp: mocks.verifyOtp, exchangeCodeForSession: mocks.exchange }
  })),
  createSupabaseAdminClient: vi.fn(() => null)
}));
vi.mock("@/lib/founder-email", () => ({ sendFounderWelcome: vi.fn() }));
vi.mock("@/lib/referrals", () => ({
  attributeReferral: mocks.attributeReferral,
  readReferralCode: vi.fn(() => null),
  REFERRAL_COOKIE: "finfold-referral"
}));
vi.mock("@/lib/posthog-server", () => ({ captureServerEvent: mocks.capture }));

import { GET as confirm } from "@/app/(auth)/auth/confirm/route";
import { GET as callback } from "@/app/(auth)/auth/callback/route";

const user = { id: "user-1", email: "person@example.com", created_at: new Date().toISOString() };

afterEach(() => {
  vi.clearAllMocks();
});

describe("/auth/confirm (token_hash, cross-device email links)", () => {
  it("verifies a signup link without a PKCE verifier and lands on the encoded return path", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user }, error: null });
    const redirectTo = "https://www.finfold.app/auth/callback?next=%2Fworkbench%3Fstart%3D1&auth_mode=signup&auth_method=email&signup_flow_id=flow-12345678";
    const url = new URL("https://www.finfold.app/auth/confirm");
    url.searchParams.set("token_hash", "hash-abc");
    url.searchParams.set("type", "signup");
    url.searchParams.set("redirect_to", redirectTo);

    const response = await confirm(new Request(url));

    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-abc", type: "signup" });
    expect(response.headers.get("location")).toBe("https://www.finfold.app/workbench?start=1");
    expect(mocks.capture).toHaveBeenCalledWith("user-1", "signup_completed", expect.objectContaining({
      auth_mode: "signup",
      auth_method: "email",
      signup_flow_id: "flow-12345678"
    }));
  });

  it("reads params when the template inserts redirect_to unencoded, and never trusts its origin", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user }, error: null });
    const response = await confirm(new Request(
      "https://www.finfold.app/auth/confirm?token_hash=h&type=signup&redirect_to=https://evil.example/auth/callback?next=/settings&auth_mode=signup&auth_method=email"
    ));
    expect(response.headers.get("location")).toBe("https://www.finfold.app/settings");
  });

  it("hops to the site the user signed up on before verifying", async () => {
    const response = await confirm(new Request(
      "https://www.finfold.app/auth/confirm?token_hash=h&type=signup&redirect_to=https://www.finfold.cn/auth/callback?next=/settings&auth_mode=signup"
    ));
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://www.finfold.cn");
    expect(location.pathname).toBe("/auth/confirm");
    expect(location.searchParams.get("token_hash")).toBe("h");
    expect(location.searchParams.get("hop")).toBe("1");
  });

  it("verifies after one hop instead of bouncing again", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user }, error: null });
    const response = await confirm(new Request(
      "https://internal.local/auth/confirm?token_hash=h&type=signup&hop=1&redirect_to=https://www.finfold.cn/auth/callback?next=/settings"
    ));
    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe("https://internal.local/settings");
  });

  it("always sends recovery links to the new-password form", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user }, error: null });
    const response = await confirm(new Request(
      "https://www.finfold.app/auth/confirm?token_hash=h&type=recovery&next=%2Fdashboard"
    ));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/reset-password");
  });

  it("explains an already-used signup link instead of a generic sign-in failure", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Email link is invalid or has expired" } });
    const response = await confirm(new Request(
      "https://www.finfold.app/auth/confirm?token_hash=h&type=signup&next=%2Fdashboard"
    ));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("email_confirm");
    expect(location.searchParams.get("next")).toBe("/dashboard");
  });

  it("rejects unknown otp types without calling Supabase", async () => {
    const response = await confirm(new Request("https://www.finfold.app/auth/confirm?token_hash=h&type=sms"));
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("oauth");
  });
});

describe("/auth/callback failure messaging", () => {
  it("marks a failed email-signup code exchange (opened on another device) as email_confirm", async () => {
    mocks.exchange.mockResolvedValue({ data: {}, error: { message: "both auth code and code verifier should be non-empty" } });
    const response = await callback(new Request(
      "https://www.finfold.app/auth/callback?code=c&next=%2Fdashboard&auth_mode=signup&auth_method=email"
    ));
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("email_confirm");
  });

  it("keeps the generic retry for OAuth failures", async () => {
    mocks.exchange.mockResolvedValue({ data: {}, error: { message: "bad code" } });
    const response = await callback(new Request(
      "https://www.finfold.app/auth/callback?code=c&next=%2Fdashboard&auth_mode=login&auth_method=google"
    ));
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("oauth");
  });
});
