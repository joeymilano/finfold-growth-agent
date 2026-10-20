import { beforeEach, describe, expect, it, vi } from "vitest";
import { replyDraftRequestSchema, replyDraftResultSchema } from "@/lib/extension/reply-contracts";
import { buildReplyPrompt } from "@/lib/extension/reply-generation";
import { runReplyDraft } from "@/lib/extension/reply-service";

const mocks = vi.hoisted(() => ({
  llm: vi.fn(), from: vi.fn(), reserve: vi.fn(), settle: vi.fn(), refund: vi.fn(), recoverSettle: vi.fn(),
  entitlement: vi.fn(), available: vi.fn(), providers: vi.fn(), askJev: vi.fn(), jevEnabled: vi.fn()
}));
vi.mock("@/lib/jev", () => ({ askJev: mocks.askJev, jevEnabled: mocks.jevEnabled }));
vi.mock("@/lib/llm", () => ({ sendUntrustedContentPrompt: mocks.llm, sendRawPromptWithImages: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createSupabaseAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/payment/ai-usage-billing", () => ({ createAiUsageBilling: () => ({ reserveAndStart: mocks.reserve, settle: mocks.settle, refund: mocks.refund }) }));
vi.mock("@/lib/payment", () => ({ getAvailableCredits: mocks.available, settleAiUsageOperation: mocks.recoverSettle }));
vi.mock("@/lib/extension/service", () => ({ getExtensionEntitlement: mocks.entitlement, extensionActionCost: () => 3 }));
vi.mock("@/lib/llm-providers", () => ({ resolveLLMProviders: mocks.providers }));

const userId = "11111111-1111-4111-8111-111111111111";
let tables: Record<string, { data?: unknown; error?: unknown; count?: number }>;
beforeEach(() => {
  vi.clearAllMocks();
  tables = {};
  mocks.from.mockImplementation((table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      neq: () => q,
      like: () => q,
      gte: () => q,
      maybeSingle: async () => ({ data: null, error: null, ...tables[table] }),
      insert: async () => ({ error: null, ...tables[table] }),
      then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
        Promise.resolve({ count: tables[table]?.count ?? 0, error: tables[table]?.error ?? null }).then(resolve, reject)
    };
    return q;
  });
  mocks.jevEnabled.mockReturnValue(true);
  mocks.reserve.mockResolvedValue({ outcome: "authorized", available: 27 });
  mocks.settle.mockResolvedValue(undefined);
  mocks.refund.mockResolvedValue(undefined);
  mocks.recoverSettle.mockResolvedValue("settled");
  mocks.available.mockResolvedValue(27);
  mocks.entitlement.mockResolvedValue({ providerPolicy: "all" });
  mocks.providers.mockReturnValue([]);
  mocks.llm.mockResolvedValue('{"status":"draft","body":"helpful reply","altBody":"bolder reply","factsToCheck":[]}');
});

const discoverInput = () => replyDraftRequestSchema.parse({
  requestId: "22222222-2222-4222-8222-222222222222",
  platform: "x",
  comment: "Tired of scheduling client calls over email, any tool for this?",
  mode: "discover",
  targetAuthor: "somebody",
  discoveryTriage: { audienceType: "potential_customer", worthReplying: 0.88 }
});

describe("discovery draft contracts", () => {
  it("defaults to own-post mode and keeps old requests valid", () => {
    const legacy = replyDraftRequestSchema.parse({ requestId: "22222222-2222-4222-8222-222222222222", platform: "x", comment: "how much?" });
    expect(legacy.mode).toBe("own_post");
    expect(legacy.targetAuthor).toBe("");
    expect(legacy.discoveryTriage).toBeUndefined();
  });
  it("rejects a discovery triage outside discover mode and out-of-range verdicts", () => {
    expect(replyDraftRequestSchema.safeParse({
      requestId: "22222222-2222-4222-8222-222222222222", platform: "x", comment: "hi",
      discoveryTriage: { audienceType: "peer_builder", worthReplying: 0.5 }
    }).success).toBe(false);
    expect(replyDraftRequestSchema.safeParse({
      requestId: "22222222-2222-4222-8222-222222222222", platform: "x", comment: "hi", mode: "discover",
      discoveryTriage: { audienceType: "peer_builder", worthReplying: 1.5 }
    }).success).toBe(false);
  });
  it("accepts an optional bolder altBody on draft results only", () => {
    const dual = replyDraftResultSchema.parse({ status: "draft", body: "a", altBody: "b", factsToCheck: [] });
    expect(dual.status === "draft" && dual.altBody).toBe("b");
    const single = replyDraftResultSchema.parse({ status: "draft", body: "a", factsToCheck: [] });
    expect(single.status === "draft" && single.altBody).toBeUndefined();
    expect(replyDraftResultSchema.safeParse({ status: "needs_context", body: "", factsToCheck: ["q?"], altBody: "x" }).success).toBe(false);
  });
});

describe("discovery draft prompt", () => {
  it("switches stance, tightens promotion rules and carries the author handle", () => {
    const input = discoverInput();
    const prompt = buildReplyPrompt(input, undefined, input.discoveryTriage
      ? { audienceType: input.discoveryTriage.audienceType, worthReplying: input.discoveryTriage.worthReplying }
      : null);
    expect(prompt).toContain("someone else's post");
    expect(prompt).toContain("(@somebody)");
    expect(prompt).toContain("Mention what the user builds only when it directly answers the post");
    expect(prompt).toContain("POST TRIAGE (Jev): audience_type=potential_customer, worth_replying=0.88");
    expect(prompt).toContain('"targetComment"');
    expect(prompt).toContain("altBody");
  });
  it("keeps the own-post prompt exactly as before", () => {
    const own = replyDraftRequestSchema.parse({ requestId: "22222222-2222-4222-8222-222222222222", platform: "x", comment: "how much?" });
    const prompt = buildReplyPrompt(own);
    expect(prompt).toContain("reply to a single comment on their own post");
    expect(prompt).not.toContain("someone else's post");
    expect(prompt).not.toContain("POST TRIAGE");
    expect(prompt).toContain("altBody");
  });
});

describe("discovery draft billing flow", () => {
  it("reuses the carried verdict instead of a second decision call", async () => {
    const { result } = await runReplyDraft(userId, discoverInput());
    expect(mocks.askJev).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "draft", body: "helpful reply", altBody: "bolder reply" });
    expect(mocks.llm.mock.calls[0][1]).toMatchObject({ operation: "chrome_extension_reply_draft" });
  });
  it("still charges the standard reply cost under the same operation key", async () => {
    await runReplyDraft(userId, discoverInput());
    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.settle).toHaveBeenCalledOnce();
  });
});
