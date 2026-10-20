// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_ID = "8a1f3c52-2d7b-4f0e-9c1a-6b5d4e3f2a10";
const OTHER_RUN_ID = "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";

type SessionRow = {
  id: string;
  user_id: string;
  active_run_id: string | null;
  active_run_started_at: string | null;
};

const mocks = vi.hoisted(() => ({
  session: null as SessionRow | null,
  /** Every write in order, to check when the marker is set and cleared. */
  log: [] as Array<{ table: string; op: "insert" | "update"; values: Record<string, unknown>; matched: number }>,
  missingColumn: false,
  loop: vi.fn()
}));

function matchesOr(row: SessionRow, expression: string): boolean {
  return expression.split(",").some((clause) => {
    const [column, op, ...rest] = clause.split(".");
    const value = rest.join(".");
    const current = row[column as keyof SessionRow];
    if (op === "is" && value === "null") return current === null;
    if (op === "lt") return current !== null && Date.parse(current) < Date.parse(value);
    throw new Error(`unsupported filter ${clause}`);
  });
}

function queryBuilder(table: string) {
  let op: "select" | "update" | "insert" = "select";
  let columns = "";
  let values: Record<string, unknown> = {};
  const eqs: Array<[string, unknown]> = [];
  let orExpression: string | null = null;

  const touchesMarker = () => columns.includes("active_run") || Object.keys(values).some((key) => key.startsWith("active_run"));
  const matchingSessions = (): SessionRow[] => {
    const row = mocks.session;
    if (!row) return [];
    const ok = eqs.every(([column, value]) => row[column as keyof SessionRow] === value)
      && (!orExpression || matchesOr(row, orExpression));
    return ok ? [row] : [];
  };
  const run = () => {
    if (table !== "agent_sessions") {
      if (op === "insert") mocks.log.push({ table, op, values, matched: 1 });
      return { data: [], error: null };
    }
    if (mocks.missingColumn && touchesMarker()) {
      return { data: null, error: { code: "42703", message: "column agent_sessions.active_run_id does not exist" } };
    }
    if (op === "update") {
      const rows = matchingSessions();
      for (const row of rows) Object.assign(row, values);
      mocks.log.push({ table, op, values, matched: rows.length });
      return { data: rows.map((row) => ({ id: row.id })), error: null };
    }
    return { data: matchingSessions().map((row) => ({ ...row })), error: null };
  };

  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: (selected?: string) => {
      if (op === "select") columns = selected ?? "";
      return builder;
    },
    update: (next: Record<string, unknown>) => {
      op = "update";
      values = next;
      return builder;
    },
    insert: (row: Record<string, unknown>) => {
      op = "insert";
      values = row;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      eqs.push([column, value]);
      return builder;
    },
    or: (expression: string) => {
      orExpression = expression;
      return builder;
    },
    order: () => builder,
    limit: () => Promise.resolve({ data: [], error: null }),
    maybeSingle: () => {
      const result = run();
      return Promise.resolve({ data: result.error ? null : (result.data as SessionRow[])[0] ?? null, error: result.error });
    },
    single: () => Promise.resolve({ data: { id: SESSION_ID }, error: null }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      try {
        return Promise.resolve(resolve(run()));
      } catch (error) {
        return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
      }
    }
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
import { GET as getSession } from "@/app/api/agent/sessions/[id]/route";

function chatRequest(init: { signal?: AbortSignal; locale?: "en" } = {}) {
  return new Request("https://www.finfold.app/api/agent/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.locale === "en" ? { cookie: "finfold-locale=en" } : {})
    },
    body: JSON.stringify({ sessionId: SESSION_ID, message: "诊断我的账号" }),
    ...(init.signal ? { signal: init.signal } : {})
  });
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function sessionWrites() {
  return mocks.log.filter((entry) => entry.table === "agent_sessions" && "active_run_id" in entry.values);
}

beforeEach(() => {
  mocks.session = { id: SESSION_ID, user_id: "user-1", active_run_id: null, active_run_started_at: null };
  mocks.missingColumn = false;
  mocks.log.length = 0;
  mocks.loop.mockReset();
  mocks.loop.mockImplementation(async function* () {
    yield { type: "text", text: "账号诊断完成。" };
  });
});

afterEach(() => vi.useRealTimers());

describe("POST /api/agent/chat in-progress marker", () => {
  it("marks the session while the run works and clears it after the result is saved", async () => {
    let markerDuringRun: string | null = null;
    mocks.loop.mockImplementation(async function* () {
      markerDuringRun = mocks.session!.active_run_id;
      yield { type: "text", text: "账号诊断完成。" };
    });

    const body = await (await POST(chatRequest())).text();

    expect(body).toContain("event: done");
    expect(markerDuringRun).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.session).toMatchObject({ active_run_id: null, active_run_started_at: null });
    const assistantIndex = mocks.log.findIndex((entry) => entry.table === "agent_messages" && entry.values.role === "assistant");
    const clearIndex = mocks.log.findIndex((entry) => entry.table === "agent_sessions" && entry.values.active_run_id === null);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(clearIndex).toBeGreaterThan(assistantIndex);
  });

  it("refuses a second run with a localized 409 while another run holds a fresh marker", async () => {
    const startedAt = minutesAgo(1);
    mocks.session!.active_run_id = OTHER_RUN_ID;
    mocks.session!.active_run_started_at = startedAt;

    const response = await POST(chatRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "AGENT_SESSION_BUSY",
      error: "这个对话里已有任务在进行，请等它完成"
    });
    expect(mocks.loop).not.toHaveBeenCalled();
    expect(mocks.log.some((entry) => entry.table === "agent_messages")).toBe(false);
    expect(mocks.session).toMatchObject({ active_run_id: OTHER_RUN_ID, active_run_started_at: startedAt });
  });

  it("takes over a stale marker left by a run that never cleared it", async () => {
    mocks.session!.active_run_id = OTHER_RUN_ID;
    mocks.session!.active_run_started_at = minutesAgo(20);

    const response = await POST(chatRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("event: done");
    expect(mocks.loop).toHaveBeenCalledTimes(1);
    expect(mocks.session!.active_run_id).toBeNull();
  });

  it("only clears its own marker, never a newer run's", async () => {
    const newerStartedAt = new Date().toISOString();
    mocks.loop.mockImplementation(async function* () {
      yield { type: "text", text: "账号诊断完成。" };
      // A stale-takeover elsewhere replaced this run's marker mid-run.
      mocks.session!.active_run_id = OTHER_RUN_ID;
      mocks.session!.active_run_started_at = newerStartedAt;
    });

    await (await POST(chatRequest())).text();

    expect(mocks.session).toMatchObject({ active_run_id: OTHER_RUN_ID, active_run_started_at: newerStartedAt });
    const clear = sessionWrites().find((entry) => entry.values.active_run_id === null);
    expect(clear?.matched).toBe(0);
  });

  it("clears the marker once a stopped run has saved its paused turn", async () => {
    let releaseLoop!: () => void;
    mocks.loop.mockImplementation(async function* (_messages: unknown, ctx: { signal?: AbortSignal }) {
      yield { type: "text", text: "已读取账号主页" };
      // The loop keeps unwinding for a while after the stop.
      await new Promise<void>((resolve) => {
        releaseLoop = resolve;
      });
      void ctx;
    });

    const client = new AbortController();
    const response = await POST(chatRequest({ signal: client.signal }));
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let streamed = "";
    while (!streamed.includes("event: text")) {
      const { value, done } = await reader.read();
      if (done) break;
      streamed += decoder.decode(value, { stream: true });
    }
    expect(mocks.session!.active_run_id).not.toBeNull();

    client.abort();
    await vi.waitFor(() => expect(mocks.session!.active_run_id).toBeNull());
    const paused = mocks.log.find((entry) => entry.table === "agent_messages" && entry.values.role === "assistant");
    expect((paused?.values.content as { work: { outcome: string } }).work.outcome).toBe("paused");
    releaseLoop();
  });

  it("keeps working without a marker before the migration is applied", async () => {
    mocks.missingColumn = true;

    const response = await POST(chatRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("event: done");
    expect(body).toContain("账号诊断完成。");
    expect(mocks.log.some((entry) => entry.table === "agent_messages" && entry.values.role === "assistant")).toBe(true);
  });
});

describe("GET /api/agent/sessions/[id] in-progress marker", () => {
  const params = { params: Promise.resolve({ id: SESSION_ID }) };

  it("reports a fresh marker so other tabs show the run as in progress", async () => {
    const startedAt = minutesAgo(2);
    mocks.session!.active_run_id = OTHER_RUN_ID;
    mocks.session!.active_run_started_at = startedAt;

    const data = await (await getSession(new Request("https://www.finfold.app"), params)).json();

    expect(data.activeRun).toEqual({ id: OTHER_RUN_ID, startedAt });
  });

  it("ignores a stale marker and loads without one before the migration", async () => {
    mocks.session!.active_run_id = OTHER_RUN_ID;
    mocks.session!.active_run_started_at = minutesAgo(30);
    expect((await (await getSession(new Request("https://www.finfold.app"), params)).json()).activeRun).toBeNull();

    mocks.missingColumn = true;
    const response = await getSession(new Request("https://www.finfold.app"), params);
    expect(response.status).toBe(200);
    expect((await response.json()).activeRun).toBeNull();
  });
});

describe("migration 128", () => {
  it("adds the marker columns without touching RLS", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/128_agent_session_active_run.sql"), "utf8");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS active_run_id uuid/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS active_run_started_at timestamptz/);
    expect(migration).not.toMatch(/DISABLE ROW LEVEL SECURITY|DROP POLICY|DROP TABLE/i);
  });
});
