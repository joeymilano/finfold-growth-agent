import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  admin: null as any,
  bridgeSecret: "test-bridge-secret-0123456789abcdef",
  reserveCreditsResult: { available: 197, cost: 3 } as { available: number; cost: number } | null,
  refundCalls: [] as Array<[string, number]>,
  afterCallbacks: [] as Array<() => unknown>
}));

vi.mock("@/lib/supabase", () => ({
  getCurrentUserId: async () => "web-user",
  createSupabaseAdminClient: () => state.admin
}));

vi.mock("@/lib/payment/credits", () => ({
  reserveCredits: vi.fn(async (_userId: string, amount: number) => {
    if (state.reserveCreditsResult === null) return null;
    return { ...state.reserveCreditsResult, cost: amount };
  }),
  refundCredits: vi.fn(async (userId: string, amount: number) => {
    state.refundCalls.push([userId, amount]);
  }),
  getAvailableCredits: vi.fn(async () => 42)
}));

vi.mock("@/lib/llm", () => ({
  sendRawPrompt: vi.fn(async () => {
    throw new Error("llm unavailable");
  })
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => unknown) => {
      state.afterCallbacks.push(callback);
    }
  };
});

import { POST as sessionPost } from "@/app/api/weapp/v1/session/route";
import { GET as meGet, PATCH as mePatch } from "@/app/api/weapp/v1/me/route";
import { GET as opportunitiesGet } from "@/app/api/weapp/v1/opportunities/route";
import { GET as draftsGet, POST as draftsPost } from "@/app/api/weapp/v1/drafts/route";
import { runWeappDraftGeneration } from "@/lib/weapp/drafts";
import { authenticateWeappRequest, randomWeappToken } from "@/lib/weapp/auth";

/* ============ 可链式调用的假 admin client ============ */

type Terminal = { data: unknown; error: unknown };

function makeChain(terminal: Terminal, result?: Terminal) {
  const chain: any = {};
  const terminalMethods = {
    maybeSingle: vi.fn(async () => result ?? terminal),
    single: vi.fn(async () => result ?? terminal)
  };
  for (const step of ["select", "insert", "update", "upsert", "eq", "is", "in", "gte", "order", "limit", "filter", "delete", "not", "lt"]) {
    chain[step] = vi.fn(() => chain);
  }
  Object.assign(chain, terminalMethods);
  return chain;
}

function makeAdmin(overrides: Record<string, Terminal> = {}, authUser: unknown = { id: "created-user-id" }) {
  const tables: Record<string, any> = {};
  const admin: any = {
    from(table: string) {
      if (!tables[table]) tables[table] = makeChain(overrides[table] ?? { data: null, error: null });
      return tables[table];
    },
    rpc: vi.fn(async (name: string) => {
      if (name === "create_weapp_draft") return state.reserveCreditsResult === null
        ? { data: null, error: { message: "insufficient_credits" } }
        : { data: { draft: { id: "draft-1", status: "pending", credits_charged: 3, created_at: new Date().toISOString() }, available: 197, created: true }, error: null };
      if (name === "fail_weapp_draft") return { data: draftRow({ status: "failed", credits_charged: 0 }), error: null };
      if (name === "get_available_credits") return { data: 42, error: null };
      if (name === "grant_weapp_signup_credits") return { data: 200, error: null };
      return { data: null, error: null };
    }),
    auth: {
      admin: {
        createUser: vi.fn(async () => ({ data: { user: authUser }, error: null })),
        deleteUser: vi.fn(async () => ({ data: null, error: null })),
        generateLink: vi.fn(async () => ({ data: { user: authUser, properties: {} }, error: null }))
      }
    },
    __tables: tables
  };
  return admin;
}

function bridgeRequest(body: unknown, secret = state.bridgeSecret) {
  return new Request("https://www.finfold.app/api/weapp/v1/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-weapp-bridge-secret": secret },
    body: JSON.stringify(body)
  });
}

const OPENID = "o-abc123def456ghi789";

beforeEach(() => {
  vi.stubEnv("WEAPP_BRIDGE_SECRET", state.bridgeSecret);
  state.admin = makeAdmin();
  state.reserveCreditsResult = { available: 197, cost: 3 };
  state.refundCalls = [];
  state.afterCallbacks = [];
});

describe("POST /api/weapp/v1/session", () => {
  it("rejects a missing or wrong bridge secret", async () => {
    const missing = await sessionPost(bridgeRequest({ openid: OPENID }, ""));
    expect(missing.status).toBe(401);
    const wrong = await sessionPost(bridgeRequest({ openid: OPENID }, "wrong-secret"));
    expect(wrong.status).toBe(401);
  });

  it("auto-provisions a user, identity, welcome grant and a token on first login", async () => {
    state.admin = makeAdmin(
      { weapp_identities: { data: null, error: null } },
      { id: "user-1" }
    );
    state.admin.from("weapp_identities"); // materialize the lazy table chain
    state.admin.from("weapp_tokens");
    // identity insert ... select().single()
    state.admin.__tables.weapp_identities.insert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: { id: "identity-1" }, error: null }) })
    }));
    // token insert
    state.admin.__tables.weapp_tokens.insert = vi.fn(async () => ({ data: null, error: null }));

    const response = await sessionPost(bridgeRequest({ openid: OPENID, nickname: "测试用户" }));
    const body = (await response.json()) as { token?: string; isNew?: boolean };

    expect(response.status).toBe(200);
    expect(body.isNew).toBe(true);
    expect(body.token).toMatch(/^ff_wa_[a-f0-9]{64}$/);
    expect(state.admin.auth.admin.createUser).toHaveBeenCalledTimes(1);
    const grant = state.admin.rpc.mock.calls.find((call: string[]) => call[0] === "grant_weapp_signup_credits");
    expect(grant).toBeTruthy();
  });

  it("reuses the existing identity on repeat login without creating a user", async () => {
    state.admin = makeAdmin({
      weapp_identities: { data: { id: "identity-1", user_id: "user-1", nickname: null, unionid: null }, error: null }
    });
    state.admin.from("weapp_identities");
    state.admin.from("weapp_tokens");
    state.admin.__tables.weapp_identities.update = vi.fn(() => ({
      eq: vi.fn(async () => ({ data: null, error: null }))
    }));
    state.admin.__tables.weapp_tokens.insert = vi.fn(async () => ({ data: null, error: null }));

    const response = await sessionPost(bridgeRequest({ openid: OPENID }));
    const body = (await response.json()) as { isNew?: boolean };

    expect(response.status).toBe(200);
    expect(body.isNew).toBe(false);
    expect(state.admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("retains a recoverable auth user when identity insertion fails", async () => {
    state.admin = makeAdmin({ weapp_identities: { data: null, error: null } });
    state.admin.from("weapp_identities");
    state.admin.from("weapp_tokens");
    state.admin.__tables.weapp_identities.insert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: null, error: { message: "identity boom" } }) })
    }));
    state.admin.__tables.weapp_tokens.insert = vi.fn(async () => ({ data: null, error: null }));

    const response = await sessionPost(bridgeRequest({ openid: OPENID }));

    expect(response.status).toBe(400);
    expect(state.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(state.admin.__tables.weapp_tokens.insert).not.toHaveBeenCalled();
  });

  it("re-links a lost identity instead of a permanent 409", async () => {
    state.admin = makeAdmin({ weapp_identities: { data: null, error: null } }, { id: "legacy-user" });
    state.admin.auth.admin.createUser = vi.fn(async () => ({ data: null, error: { message: "User already registered" } }));
    state.admin.from("weapp_identities");
    state.admin.from("weapp_tokens");
    state.admin.__tables.weapp_identities.insert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: { id: "identity-re" }, error: null }) })
    }));
    state.admin.__tables.weapp_tokens.insert = vi.fn(async () => ({ data: null, error: null }));

    const response = await sessionPost(bridgeRequest({ openid: OPENID }));
    const body = (await response.json()) as { isNew?: boolean };

    expect(response.status).toBe(200);
    expect(body.isNew).toBe(true);
    expect(state.admin.auth.admin.generateLink).toHaveBeenCalled();
    expect(state.admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    const grant = state.admin.rpc.mock.calls.find((call: string[]) => call[0] === "grant_weapp_signup_credits");
    expect(grant?.[1]).toEqual({ p_user_id: "legacy-user" });
  });
});

describe("weapp bearer auth", () => {
  it("authenticateWeappRequest rejects unknown tokens and expired ones", async () => {
    const unknown = await authenticateWeappRequest(
      new Request("https://x.test", { headers: { authorization: `Bearer ${randomWeappToken()}` } }),
      state.admin
    );
    expect(unknown).toBeNull();

    state.admin = makeAdmin({
      weapp_tokens: { data: { id: "t", identity_id: "i", user_id: "u", expires_at: "2000-01-01T00:00:00.000Z" }, error: null }
    });
    const expired = await authenticateWeappRequest(
      new Request("https://x.test", { headers: { authorization: `Bearer ${randomWeappToken()}` } }),
      state.admin
    );
    expect(expired).toBeNull();
  });

  it("me and drafts reject requests without a token", async () => {
    expect((await meGet(new Request("https://x.test"))).status).toBe(401);
    expect(
      (await draftsPost(new Request("https://x.test", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).status
    ).toBe(401);
    expect((await opportunitiesGet(new Request("https://x.test"))).status).toBe(401);
  });
});

describe("PATCH /api/weapp/v1/me", () => {
  function tokenRequest(patch: unknown) {
    return new Request("https://x.test/api/weapp/v1/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: "Bearer ff_wa_" + "0".repeat(64) },
      body: JSON.stringify(patch)
    });
  }

  it("upserts brand brain and an operating program with the watchlist", async () => {
    state.admin = makeAdmin({
      weapp_tokens: { data: { id: "t", identity_id: "i", user_id: "user-1", expires_at: "2999-01-01T00:00:00.000Z" }, error: null },
      weapp_identities: { data: { nickname: null }, error: null },
      operating_programs: { data: null, error: null }
    });

    const response = await mePatch(
      tokenRequest({ business: "帮独立开发者做增长的工具", focusKeywords: ["AI", "出海"], platform: "xiaohongshu" })
    );
    expect(response.status).toBe(200);

    const brainUpsert = state.admin.__tables.brand_brains.upsert.mock.calls[0][0];
    expect(brainUpsert.product_description).toBe("帮独立开发者做增长的工具");
    const programInsert = state.admin.__tables.operating_programs.insert.mock.calls[0][0];
    expect(programInsert.watchlist.keywords).toEqual(["AI", "出海"]);
    expect(programInsert.platform).toBe("xiaohongshu");
    expect(programInsert.status).toBe("active");
  });

  it("keeps the latest program platform and offer fields when only keywords change", async () => {
    state.admin = makeAdmin({
      weapp_tokens: { data: { id: "t", identity_id: "i", user_id: "user-1", expires_at: "2999-01-01T00:00:00.000Z" }, error: null },
      operating_programs: {
        data: {
          id: "p-1",
          platform: "xiaohongshu",
          status: "active",
          watchlist: { keywords: ["旧词"], competitors: ["竞品"] },
          offer: { name: "训练营", summary: "旧简介", price: "199" }
        },
        error: null
      }
    });

    const response = await mePatch(tokenRequest({ focusKeywords: ["新词"] }));
    expect(response.status).toBe(200);

    const update = state.admin.__tables.operating_programs.update.mock.calls[0][0];
    expect(update.platform).toBe("xiaohongshu");
    expect(update.offer).toEqual({ name: "训练营", summary: "旧简介", price: "199" });
    expect(update.watchlist.keywords).toEqual(["新词"]);
    expect(update.watchlist.competitors).toEqual(["竞品"]);
    expect(state.admin.__tables.operating_programs.insert).not.toHaveBeenCalled();
  });

  it("reports a failed program write instead of a silent ok", async () => {
    state.admin = makeAdmin({
      weapp_tokens: { data: { id: "t", identity_id: "i", user_id: "user-1", expires_at: "2999-01-01T00:00:00.000Z" }, error: null }
    });
    state.admin.from("operating_programs");
    state.admin.__tables.operating_programs.insert = vi.fn(() =>
      Promise.resolve({ data: null, error: { message: "unique violation" } })
    );

    const response = await mePatch(tokenRequest({ business: "业务描述足够长", focusKeywords: ["AI"] }));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("unique violation");
  });
});

describe("POST /api/weapp/v1/drafts", () => {
  function tokenRequest(body: unknown) {
    return new Request("https://x.test/api/weapp/v1/drafts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer ff_wa_" + "0".repeat(64),
        "x-forwarded-for": "203.0.113.7"
      },
      body: JSON.stringify(body)
    });
  }

  beforeEach(() => {
    state.admin = makeAdmin({
      weapp_tokens: { data: { id: "t", identity_id: "i", user_id: "user-1", expires_at: "2999-01-01T00:00:00.000Z" }, error: null },
      topic_opportunities: { data: { id: "opp-1" }, error: null }
    });
    state.admin.from("weapp_drafts"); // materialize before overriding insert
    state.admin.__tables.weapp_drafts.insert = vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: "draft-1", status: "pending", credits_charged: 3, created_at: new Date().toISOString() }, error: null })
      })
    }));
  });

  it("creates a pending draft, reserves credits, schedules generation", async () => {
    const response = await draftsPost(
      tokenRequest({ requestId: "test-request-123", source: "opportunity", opportunityId: "00000000-0000-4000-8000-000000000001", platform: "wechat", topic: { title: "AI 选题测试" } })
    );
    const body = (await response.json()) as { id?: string; cost?: number };

    expect(response.status).toBe(200);
    expect(body.id).toBe("draft-1");
    expect(body.cost).toBe(3);
    expect(state.afterCallbacks.length).toBe(1);
    expect(state.admin.rpc).toHaveBeenCalledWith("create_weapp_draft", expect.objectContaining({ p_platform: "wechat", p_request_id: "test-request-123" }));
  });

  it("returns 402 without inserting when the balance is insufficient", async () => {
    state.reserveCreditsResult = null;
    const response = await draftsPost(
      tokenRequest({ requestId: "test-request-123", source: "free", platform: "moments", topic: { title: "额度不足测试" } })
    );
    expect(response.status).toBe(402);
    expect((await response.json()).code).toBe("insufficient_credits");
    expect(state.admin.__tables.weapp_drafts.insert).not.toHaveBeenCalled();
  });

  it("returns 404 when the opportunity belongs to someone else", async () => {
    state.admin = makeAdmin({
      weapp_tokens: { data: { id: "t", identity_id: "i", user_id: "user-1", expires_at: "2999-01-01T00:00:00.000Z" }, error: null },
      topic_opportunities: { data: null, error: null }
    });
    const response = await draftsPost(
      tokenRequest({ requestId: "test-request-123", source: "opportunity", opportunityId: "00000000-0000-4000-8000-000000000002", platform: "wechat", topic: { title: "越权测试" } })
    );
    expect(response.status).toBe(404);
  });

  it("returns a retryable server error without a separate refund when the transaction fails", async () => {
    const original = state.admin.rpc;
    state.admin.rpc = vi.fn((name: string, args: unknown) => name === "create_weapp_draft"
      ? Promise.resolve({ data: null, error: { message: "insert failed" } }) : original(name, args));
    const response = await draftsPost(tokenRequest({ requestId: "test-request-123", source: "free", platform: "wechat", topic: { title: "插入失败" } }));
    expect(response.status).toBe(503);
    expect(state.refundCalls).toEqual([]);
    expect(state.afterCallbacks).toEqual([]);
  });
  it("does not schedule a second worker on an idempotent replay", async () => {
    const original = state.admin.rpc;
    state.admin.rpc = vi.fn(async (name: string, args: unknown) => {
      const result = await original(name, args);
      if (name === "create_weapp_draft") result.data.created = false;
      return result;
    });
    const response = await draftsPost(tokenRequest({ requestId: "replay-123", source: "free", platform: "wechat", topic: { title: "相同选题" } }));
    expect(response.status).toBe(200);
    expect(state.afterCallbacks).toEqual([]);
  });
});

/* ============ weapp_drafts 专用链：读(maybeSingle) / 列表(await 链) / claim(await update 链) ============ */

function draftsTableChain(opts: { read?: Terminal; list?: Terminal; claim?: Terminal } = {}) {
  const read = opts.read ?? { data: null, error: null };
  const list = opts.list ?? { data: [], error: null };
  const claim = opts.claim ?? { data: [], error: null };
  const chain: any = {};
  for (const step of ["select", "insert", "upsert", "eq", "is", "in", "gte", "order", "limit", "filter", "delete", "not", "lt"]) {
    chain[step] = vi.fn(() => chain);
  }
  // Bare `await` on the list chain (GET 列表查询) resolves to the list terminal.
  chain.then = (onFulfilled: any, onRejected: any) => Promise.resolve(list).then(onFulfilled, onRejected);
  chain.maybeSingle = vi.fn(async () => read);
  chain.single = vi.fn(async () => read);
  // update().eq().eq().select("id") then awaited (claim) resolves to the claim terminal.
  const claimChain: any = {};
  for (const step of ["eq", "select", "is"]) claimChain[step] = vi.fn(() => claimChain);
  claimChain.then = (onFulfilled: any, onRejected: any) => Promise.resolve(claim).then(onFulfilled, onRejected);
  claimChain.maybeSingle = vi.fn(async () => claim);
  claimChain.single = vi.fn(async () => claim);
  chain.update = vi.fn(() => claimChain);
  return chain;
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-9",
    user_id: "user-1",
    source: "free",
    opportunity_id: null,
    topic: { title: "超时选题" },
    platform: "wechat",
    status: "pending",
    content: null,
    error: null,
    credits_charged: 3,
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    finished_at: null,
    ...overrides
  };
}

describe("runWeappDraftGeneration failure refund", () => {
  it("refunds once when it claims the pending→failed transition", async () => {
    state.admin = makeAdmin();
    state.admin.__tables.weapp_drafts = draftsTableChain({
      read: { data: draftRow(), error: null },
      claim: { data: draftRow(), error: null }
    });
    await runWeappDraftGeneration("draft-9");
    expect(state.admin.rpc).toHaveBeenCalledWith("fail_weapp_draft", expect.objectContaining({ p_id: "draft-9" }));
  });

  it("never double-refunds when a stale settle already failed the draft", async () => {
    state.admin = makeAdmin();
    state.admin.__tables.weapp_drafts = draftsTableChain({
      read: { data: draftRow(), error: null },
      claim: { data: null, error: null } // 0 行命中：已被 settle 置为 failed 并退过款
    });
    await runWeappDraftGeneration("draft-9");
    expect(state.refundCalls).toEqual([]);
  });
});

describe("GET /api/weapp/v1/drafts", () => {
  function getRequest() {
    return new Request("https://x.test/api/weapp/v1/drafts", {
      headers: { authorization: "Bearer ff_wa_" + "0".repeat(64) }
    });
  }

  function authAdmin(draftsChain: any) {
    state.admin = makeAdmin({
      weapp_tokens: { data: { id: "t", identity_id: "i", user_id: "user-1", expires_at: "2999-01-01T00:00:00.000Z" }, error: null }
    });
    state.admin.__tables.weapp_drafts = draftsChain;
    return state.admin;
  }

  it("settles a stale pending draft, refunds it, and reports it failed", async () => {
    const chain = draftsTableChain({
      list: { data: [draftRow()], error: null },
      claim: { data: draftRow(), error: null }
    });
    authAdmin(chain);
    const response = await draftsGet(getRequest());
    const body = (await response.json()) as { drafts?: Array<{ status?: string }> };
    expect(response.status).toBe(200);
    expect(body.drafts?.[0].status).toBe("failed");
    expect(state.admin.rpc).toHaveBeenCalledWith("fail_weapp_draft", expect.objectContaining({ p_id: "draft-9" }));
  });

  it("leaves a fresh pending draft alone (no update, no refund)", async () => {
    const chain = draftsTableChain({
      list: { data: [draftRow({ created_at: new Date().toISOString() })], error: null }
    });
    authAdmin(chain);
    const response = await draftsGet(getRequest());
    const body = (await response.json()) as { drafts?: Array<{ status?: string }> };
    expect(body.drafts?.[0].status).toBe("pending");
    expect(chain.update).not.toHaveBeenCalled();
    expect(state.refundCalls).toEqual([]);
  });

  it("returns ready content", async () => {
    authAdmin(draftsTableChain({ list: { data: [draftRow({ status: "ready", content: "正文内容" })], error: null } }));
    const body = (await (await draftsGet(getRequest())).json()) as { drafts?: Array<{ content?: string }> };
    expect(body.drafts?.[0].content).toBe("正文内容");
  });
});
