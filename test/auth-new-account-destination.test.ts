import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn().mockResolvedValue(undefined),
  exchange: vi.fn(),
  verifyOtp: vi.fn()
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verifyOtp }
  })),
  createSupabaseAdminClient: vi.fn(() => null)
}));
vi.mock("@/lib/founder-email", () => ({ sendFounderWelcome: vi.fn() }));
vi.mock("@/lib/referrals", () => ({
  attributeReferral: vi.fn().mockResolvedValue(undefined),
  readReferralCode: vi.fn(() => null),
  REFERRAL_COOKIE: "finfold-referral"
}));
vi.mock("@/lib/posthog-server", () => ({ captureServerEvent: mocks.capture }));

import { GET as callback } from "@/app/(auth)/auth/callback/route";
import { GET as confirm } from "@/app/(auth)/auth/confirm/route";
import { resolveNewAccountReturnTo, wasRecentlyCreated } from "@/lib/auth-return";

const ORIGIN = "https://www.finfold.app";
const NEW_USER = () => ({ id: "user-new", email: "new@example.com", created_at: new Date().toISOString() });
const OLD_USER = { id: "user-old", email: "old@example.com", created_at: "2025-01-01T00:00:00.000Z" };

async function oauthLanding(query: string, user: { id: string; email: string; created_at: string }) {
  mocks.exchange.mockResolvedValueOnce({ data: { user }, error: null });
  const response = await callback(new Request(`${ORIGIN}/auth/callback?code=ok&${query}`));
  return response.headers.get("location")?.replace(ORIGIN, "");
}

afterEach(() => vi.clearAllMocks());

describe("resolveNewAccountReturnTo", () => {
  it("replaces only the generic default with the guided first task", () => {
    expect(resolveNewAccountReturnTo(undefined)).toBe("/workbench?start=1");
    expect(resolveNewAccountReturnTo("/dashboard")).toBe("/workbench?start=1");
    expect(resolveNewAccountReturnTo("https://evil.example/x")).toBe("/workbench?start=1");
  });

  it("keeps every explicit product target", () => {
    for (const target of [
      "/billing?plan=starter",
      "/operations/account-health",
      "/oauth/consent?authorization_id=12345678-1234-4234-8234-123456789012",
      "/invite/abc123",
      "/extension/authorize?state=x",
      "/workbench?start=1&draft=dcd384a8-49ac-4d0e-ac59-6f71db5197ef",
      "/dashboard?prompt=hello"
    ]) {
      expect(resolveNewAccountReturnTo(target)).toBe(target);
    }
  });

  it("treats only accounts created in the last 10 minutes as new", () => {
    const now = Date.parse("2026-10-18T12:00:00.000Z");
    expect(wasRecentlyCreated("2026-10-18T11:55:00.000Z", now)).toBe(true);
    expect(wasRecentlyCreated("2026-10-18T11:40:00.000Z", now)).toBe(false);
    expect(wasRecentlyCreated(undefined, now)).toBe(false);
  });
});

describe("post-auth destination for new accounts", () => {
  it("sends a confirmed email signup without a target to the first task", async () => {
    mocks.exchange.mockResolvedValueOnce({ data: { user: NEW_USER() }, error: null });
    const response = await callback(new Request(`${ORIGIN}/auth/callback?code=ok&next=%2Fdashboard&auth_mode=signup&auth_method=email`));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/workbench?start=1`);
    expect(mocks.capture).toHaveBeenCalledWith("user-new", "signup_completed", expect.objectContaining({
      return_to: "/dashboard",
      destination: "/workbench?start=1"
    }));
  });

  it("does the same for cross-device /auth/confirm links", async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: NEW_USER() }, error: null });
    const response = await confirm(new Request(`${ORIGIN}/auth/confirm?token_hash=h&type=signup&next=%2Fdashboard&auth_mode=signup&auth_method=email`));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/workbench?start=1`);
  });

  it("sends a first OAuth login to the first task from either auth page", async () => {
    expect(await oauthLanding("next=%2Fdashboard&auth_mode=signup&auth_method=google", NEW_USER())).toBe("/workbench?start=1");
    expect(await oauthLanding("next=%2Fdashboard&auth_mode=login&auth_method=github", NEW_USER())).toBe("/workbench?start=1");
  });

  it("keeps explicit targets for new accounts", async () => {
    expect(await oauthLanding("next=%2Fbilling%3Fplan%3Dstarter&auth_mode=signup&auth_method=google", NEW_USER())).toBe("/billing?plan=starter");
    expect(await oauthLanding("next=%2Foperations%2Faccount-health&auth_mode=signup&auth_method=google", NEW_USER())).toBe("/operations/account-health");
  });

  it("keeps returning users on /dashboard", async () => {
    expect(await oauthLanding("next=%2Fdashboard&auth_mode=login&auth_method=google", OLD_USER)).toBe("/dashboard");
    expect(await oauthLanding("next=%2Fdashboard&auth_mode=signup&auth_method=google", OLD_USER)).toBe("/dashboard");
  });

  it("never diverts a password recovery", async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: NEW_USER() }, error: null });
    const response = await confirm(new Request(`${ORIGIN}/auth/confirm?token_hash=h&type=recovery&next=%2Fdashboard`));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/reset-password");
  });
});
