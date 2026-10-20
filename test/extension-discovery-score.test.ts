import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/extension/v1/discovery/score/route";
import { buildBrandContextDigest } from "@/lib/extension/reply-service";
import {
  DISCOVERY_HIGH_MIN, DISCOVERY_MEDIUM_MIN, discoveryScoreRequestSchema
} from "@/lib/extension/discovery-contracts";
import { buildDiscoveryScoreQuestions, discoveryTier, scoreDiscoveryPosts } from "@/lib/extension/discovery-scoring";
import type { BrandBrain } from "@/lib/brand-brain";

const mocks = vi.hoisted(() => ({
  askJev: vi.fn(), jevEnabled: vi.fn(), auth: vi.fn(), origin: vi.fn(), from: vi.fn(), rate: vi.fn(),
  brainPersistence: vi.fn(), brainColumns: "brand_name,product_description,target_audience,positioning_statement"
}));
vi.mock("@/lib/jev", () => ({ askJev: mocks.askJev, jevEnabled: mocks.jevEnabled }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("@/lib/extension/auth", () => ({ authenticateExtensionRequest: mocks.auth }));
vi.mock("@/lib/extension/cors", () => ({
  hasDisallowedExtensionOrigin: mocks.origin,
  extensionPreflight: () => new Response(null, { status: 204 }),
  extensionJson: (_: unknown, body: unknown, init?: ResponseInit) => Response.json(body, init)
}));
vi.mock("@/lib/supabase", () => ({ createSupabaseAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/brand-brain-persistence", () => ({
  BRAND_BRAIN_COLUMNS: mocks.brainColumns,
  mapBrandBrainFromRow: mocks.brainPersistence
}));

const userId = "11111111-1111-4111-8111-111111111111";
const post = (id: string) => ({ id, author: "somebody", text: "Any tool for scheduling client calls?", postedAt: new Date().toISOString(), replyCount: 3 });
const request = (body: unknown) => new Request("https://www.finfold.app/api/extension/v1/discovery/score", {
  method: "POST", body: JSON.stringify(body)
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FINFOLD_EXTENSION_AUTH_ENABLED", "true");
  vi.stubEnv("FINFOLD_EXTENSION_PAID_ACTIONS_ENABLED", "true");
  vi.stubEnv("FINFOLD_EXTENSION_REPLY_DRAFTS_ENABLED", "true");
  vi.stubEnv("FINFOLD_EXTENSION_REPLY_PILOT_USER_IDS", userId);
  mocks.auth.mockResolvedValue({ userId, scope: ["extension:generate"] });
  mocks.origin.mockReturnValue(false);
  mocks.rate.mockReturnValue(true);
  mocks.from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) })
  });
  mocks.brainPersistence.mockReturnValue(null);
  mocks.jevEnabled.mockReturnValue(true);
});

describe("discovery contracts", () => {
  it("caps batches at six posts and rejects unknown fields", () => {
    expect(discoveryScoreRequestSchema.safeParse({ posts: Array.from({ length: 7 }, (_, index) => post(`/a/status/${index}`)) }).success).toBe(false);
    expect(discoveryScoreRequestSchema.safeParse({ posts: [post("/a/status/1")], extra: true }).success).toBe(false);
    expect(discoveryScoreRequestSchema.safeParse({ posts: [post("/a/status/1")] }).success).toBe(true);
  });
});

describe("discovery tiering", () => {
  it("only welcomes substantive audiences at the high tier and keeps bait out", () => {
    expect(discoveryTier(DISCOVERY_HIGH_MIN, "potential_customer")).toBe("high");
    expect(discoveryTier(DISCOVERY_HIGH_MIN, "peer_builder")).toBe("high");
    expect(discoveryTier(DISCOVERY_HIGH_MIN, "discussion")).toBe("high");
    expect(discoveryTier(DISCOVERY_HIGH_MIN, "noise")).toBe("low");
    expect(discoveryTier(DISCOVERY_HIGH_MIN, "hostile")).toBe("low");
    expect(discoveryTier(DISCOVERY_MEDIUM_MIN, "other")).toBe("medium");
    expect(discoveryTier(DISCOVERY_HIGH_MIN - 0.01, "potential_customer")).toBe("medium");
    expect(discoveryTier(DISCOVERY_MEDIUM_MIN - 0.01, "potential_customer")).toBe("low");
  });
});

describe("discovery scoring", () => {
  it("scores each post in one fan-out call and passes the brand context through", async () => {
    mocks.askJev.mockImplementation(async (state: { brand_context?: string | null }) => ({
      model: "jev-1.13.0",
      answers: {
        worth_replying: { type: "noul", noul: 0.9 },
        audience_type: { type: "choice", choice: "potential_customer", probabilities: {}, confidence: null }
      },
      usage: { inputTokens: 100, outputTokens: 0, brandContext: state.brand_context }
    }));
    const scored = await scoreDiscoveryPosts({ userId, brandContext: "Finfold — growth OS for indie makers", posts: [post("/a/status/1"), post("/b/status/2")] });
    expect(scored.scoringAvailable).toBe(true);
    expect(scored.scores).toHaveLength(2);
    expect(scored.scores[0]).toMatchObject({ id: "/a/status/1", tier: "high", audienceType: "potential_customer", worthReplying: 0.9 });
    expect(mocks.askJev.mock.calls[0][0].brand_context).toBe("Finfold — growth OS for indie makers");
    expect(Object.keys(buildDiscoveryScoreQuestions())).toEqual(["worth_replying", "audience_type"]);
  });

  it("fails open per post and reports the judge as unavailable when disabled", async () => {
    mocks.askJev.mockRejectedValue(new Error("down"));
    const partial = await scoreDiscoveryPosts({ userId, brandContext: null, posts: [post("/a/status/1")] });
    expect(partial.scoringAvailable).toBe(true);
    expect(partial.scores).toHaveLength(0);
    mocks.jevEnabled.mockReturnValue(false);
    const off = await scoreDiscoveryPosts({ userId, brandContext: null, posts: [post("/a/status/1")] });
    expect(off.scoringAvailable).toBe(false);
  });

  it("maps unknown audience choices to other instead of dropping the verdict", async () => {
    mocks.askJev.mockResolvedValue({
      model: "jev-1.13.0",
      answers: {
        worth_replying: { type: "noul", noul: 0.5 },
        audience_type: { type: "choice", choice: "alien", probabilities: {}, confidence: null }
      },
      usage: { inputTokens: 100, outputTokens: 0 }
    });
    const scored = await scoreDiscoveryPosts({ userId, brandContext: null, posts: [post("/a/status/1")] });
    expect(scored.scores[0].audienceType).toBe("other");
    expect(scored.scores[0].tier).toBe("medium");
  });
});

describe("brand context digest", () => {
  it("includes the targeting audience alongside name, offering and positioning", () => {
    const brain = {
      brandName: "Finfold", productDescription: "growth OS", targetAudience: "indie makers going global", positioningStatement: ""
    } as unknown as BrandBrain;
    expect(buildBrandContextDigest(brain)).toBe("Finfold — growth OS — indie makers going global");
    expect(buildBrandContextDigest(null)).toBeNull();
  });
});

describe("discovery score route", () => {
  it("rejects untrusted origins before touching user data", async () => {
    mocks.origin.mockReturnValue(true);
    expect((await POST(request({ posts: [post("/a/status/1")] }))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("requires the reply pilot gate", async () => {
    vi.stubEnv("FINFOLD_EXTENSION_REPLY_DRAFTS_ENABLED", "false");
    expect((await POST(request({ posts: [post("/a/status/1")] }))).status).toBe(403);
  });
  it("rate limits free scoring per user", async () => {
    mocks.rate.mockReturnValue(false);
    const response = await POST(request({ posts: [post("/a/status/1")] }));
    expect(response.status).toBe(429);
    expect(mocks.askJev).not.toHaveBeenCalled();
  });
  it("returns tiered scores for a valid batch", async () => {
    mocks.askJev.mockResolvedValue({
      model: "jev-1.13.0",
      answers: {
        worth_replying: { type: "noul", noul: 0.91 },
        audience_type: { type: "choice", choice: "potential_customer", probabilities: {}, confidence: null }
      },
      usage: { inputTokens: 100, outputTokens: 0 }
    });
    const response = await POST(request({ posts: [post("/a/status/1")] }));
    expect(response.status).toBe(200);
    const body = await response.json() as { scores: { tier: string }[]; scoringAvailable: boolean };
    expect(body.scoringAvailable).toBe(true);
    expect(body.scores[0].tier).toBe("high");
  });
  it("rejects malformed batches without scoring", async () => {
    expect((await POST(request({ posts: [] }))).status).toBe(400);
    expect(mocks.askJev).not.toHaveBeenCalled();
  });

  it("enforces the body limit while streaming, even without Content-Length", async () => {
    const chunk = new TextEncoder().encode("x".repeat(60_000));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      }
    });
    const streamed = new Request("https://www.finfold.app/api/extension/v1/discovery/score", {
      method: "POST", body, duplex: "half"
    } as RequestInit & { duplex: "half" });
    expect(streamed.headers.get("content-length")).toBeNull();
    expect((await POST(streamed)).status).toBe(413);
    expect(mocks.askJev).not.toHaveBeenCalled();
  });
});
