// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const SESSION_ID = "8a1f3c52-2d7b-4f0e-9c1a-6b5d4e3f2a10";

const mocks = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  loop: vi.fn()
}));

function queryBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: chain,
    eq: chain,
    order: chain,
    update: chain,
    limit: () => Promise.resolve({ data: [] }),
    maybeSingle: () => Promise.resolve({ data: { id: SESSION_ID } }),
    single: () => Promise.resolve({ data: { id: SESSION_ID }, error: null }),
    insert: (row: Record<string, unknown>) => {
      mocks.inserts.push({ table, row });
      return Promise.resolve({ error: null });
    },
    then: (resolve: (value: unknown) => unknown) => resolve({ error: null })
  });
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  getCurrentUserId: async () => "user-1",
  createSupabaseAdminClient: () => ({ from: (table: string) => queryBuilder(table) })
}));
vi.mock("@/lib/api-rate-limit", () => ({ enforceApiRateLimit: () => null }));
vi.mock("@/lib/agent/entitlements", () => ({ resolveAgentPlan: async () => "starter" }));
vi.mock("@/lib/payment", () => ({ ensurePlanCredits: async () => undefined }));
vi.mock("@/lib/agent/context", () => ({ buildAgentSystemPrompt: async () => "system" }));
vi.mock("@/lib/agent/attachment-content", () => ({
  resolvePrivateAttachmentEvidence: async () => ({ attachments: [], context: "" })
}));
vi.mock("@/lib/agent/public-web-context", () => ({
  readCurrentTurnPublicWeb: async () => null,
  appendCurrentPublicWebEvidence: (message: string) => message
}));
vi.mock("@/lib/agent/model-turn-billing", () => ({
  createAgentModelTurnBilling: () => ({
    reserve: async () => true,
    confirmSuccessfulTurn: async () => undefined,
    refundFailedTurn: async () => undefined
  })
}));
vi.mock("@/lib/llm", () => ({ hasDirectLLM: () => true }));
vi.mock("@/lib/posthog-server", () => ({ captureServerEvent: async () => undefined }));
vi.mock("@/lib/agent/loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/loop")>();
  return { ...actual, runAgentLoop: mocks.loop };
});

import { POST } from "@/app/api/agent/chat/route";

afterEach(() => {
  mocks.inserts.length = 0;
  mocks.loop.mockReset();
});

describe("POST /api/agent/chat when the user stops the run", () => {
  it.each([
    ["the request is aborted", "abort"],
    ["the client cancels the response stream", "cancel"]
  ] as const)("saves what the run produced as a paused assistant turn when %s", async (_label, stopVia) => {
    mocks.loop.mockImplementation(async function* (_messages: unknown, ctx: { signal?: AbortSignal }) {
      yield { type: "text", text: "已读取账号主页" };
      yield { type: "tool_call", name: "investigate_social_account", args: { accountUrl: "https://x.com/a" } };
      yield { type: "tool_result", name: "investigate_social_account", result: { summary: "粉丝 1.2 万" } };
      yield { type: "tool_call", name: "analyze_account_performance", args: {} };
      await new Promise<void>((resolve) => ctx.signal?.addEventListener("abort", () => resolve(), { once: true }));
    });

    const client = new AbortController();
    const response = await POST(new Request("https://www.finfold.app/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: SESSION_ID, message: "诊断我的账号" }),
      signal: client.signal
    }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let streamed = "";
    while (!streamed.includes("event: tool_call\ndata: {\"name\":\"analyze_account_performance\"")) {
      const { value, done } = await reader.read();
      if (done) break;
      streamed += decoder.decode(value, { stream: true });
    }

    if (stopVia === "abort") client.abort();
    else await reader.cancel();
    await vi.waitFor(() => {
      expect(mocks.inserts.some(({ table, row }) => table === "agent_messages" && row.role === "assistant")).toBe(true);
    });

    const assistant = mocks.inserts.find(({ table, row }) => table === "agent_messages" && row.role === "assistant")!;
    const content = assistant.row.content as {
      text: string;
      toolCalls: Array<{ name: string }>;
      toolResults: Array<{ name: string; result: unknown }>;
      work: { outcome: string };
    };
    expect(content.text).toBe("已读取账号主页");
    // Only finished calls are kept, so replayed calls and results stay paired.
    expect(content.toolCalls.map((call) => call.name)).toEqual(["investigate_social_account"]);
    expect(content.toolResults).toEqual([{ name: "investigate_social_account", result: { summary: "粉丝 1.2 万" } }]);
    expect(content.work.outcome).toBe("paused");
    expect(mocks.inserts.filter(({ row }) => row.role === "assistant")).toHaveLength(1);
  });

  it("localizes coded loop errors from the request locale", async () => {
    mocks.loop.mockImplementation(async function* () {
      yield { type: "error", code: "MAX_TURNS_REACHED", error: "这个任务步骤较多，我先停在这里。" };
    });

    const response = await POST(new Request("https://www.finfold.app/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "finfold-locale=en" },
      body: JSON.stringify({ sessionId: SESSION_ID, message: "Research this market" })
    }));
    const body = await response.text();

    expect(body).toContain('"code":"MAX_TURNS_REACHED"');
    expect(body).toContain("so I stopped here");
    expect(body).not.toContain("我先停在这里");
  });
});
