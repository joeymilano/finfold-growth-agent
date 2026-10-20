import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  llm: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  refund: vi.fn(),
  rateLimited: false
}));

vi.mock("@/lib/supabase", () => ({
  getCurrentUserId: async () => "user-1",
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: table === "profiles" ? { plan: "pro" } : null, error: null })
      };
      return builder;
    }
  })
}));
vi.mock("@/lib/payment/entitlements", () => ({
  getActiveSubscription: () => null,
  resolveEffectivePlan: () => "pro",
  getPlanFeatures: () => ({ urlBootstrap: true })
}));
vi.mock("@/lib/payment", () => ({ ACTION_CREDITS: { brandVoiceAnalysis: 2 }, ensurePlanCredits: async () => undefined }));
vi.mock("@/lib/payment/ai-usage-billing", () => ({
  createAiUsageBilling: () => ({ reserveAndStart: mocks.reserve, settle: mocks.settle, refund: mocks.refund })
}));
vi.mock("@/lib/api-rate-limit", () => ({
  enforceApiRateLimit: () => (mocks.rateLimited ? Response.json({ error: "slow down" }, { status: 429 }) : null)
}));
vi.mock("@/lib/llm", () => ({ sendUntrustedContentPrompt: mocks.llm }));
vi.mock("@/lib/safe-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-url")>()),
  safeExternalFetch: mocks.fetch
}));

import { POST } from "@/app/api/brand-brain/extract/route";

const request = (body: unknown) => new Request("https://finfold.test/api/brand-brain/extract", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Accept-Language": "zh-CN" },
  body: JSON.stringify(body)
});

const page = `<html><body>${"Finfold helps small teams publish native content on every platform. ".repeat(5)}</body></html>`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rateLimited = false;
  mocks.reserve.mockResolvedValue({ outcome: "reserved" });
  mocks.settle.mockResolvedValue(undefined);
  mocks.refund.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue(new Response(page, { status: 200, headers: { "content-type": "text/html" } }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/brand-brain/extract", () => {
  it("returns the complete localized invalid-URL message without fetching", async () => {
    const response = await POST(request({ url: "ftp://example.com" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("请输入有效的网址，例如 https://finfold.app");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rate-limits and reserves Credits before any outbound fetch", async () => {
    mocks.rateLimited = true;
    expect((await POST(request({ url: "https://example.com" }))).status).toBe(429);
    expect(mocks.fetch).not.toHaveBeenCalled();

    mocks.rateLimited = false;
    mocks.reserve.mockResolvedValue({ outcome: "insufficient_credits" });
    expect((await POST(request({ url: "https://example.com" }))).status).toBe(402);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("reports unusable model output as an extraction problem and refunds", async () => {
    mocks.llm.mockResolvedValue("I could not find brand details on this page.");
    const response = await POST(request({ url: "https://example.com" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("没能从这个网址提取到品牌信息，请重试或手动填写");
    expect(mocks.refund).toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("accepts over-long model fields by trimming them", async () => {
    mocks.llm.mockResolvedValue(JSON.stringify({ brandName: "F".repeat(90), toneKeywords: Array.from({ length: 12 }, (_, i) => `t${i}`) }));
    const response = await POST(request({ url: "https://example.com" }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.brain.brandName).toHaveLength(60);
    expect(data.brain.toneKeywords).toHaveLength(10);
    expect(mocks.settle).toHaveBeenCalled();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});
