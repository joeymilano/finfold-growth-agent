import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: string; values: Row; filters: Array<[string, unknown]> }>
}));

/** Minimal PostgREST-like builder: eq/is filters, update/insert/upsert, maybeSingle. */
function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let op: "select" | "update" | "insert" | "upsert" = "select";
  let values: Row = {};
  const rows = () => (state.tables[table] ??= []);
  const matches = (row: Row) => filters.every(([column, value]) => (value === null ? row[column] == null : row[column] === value));
  const run = () => {
    if (op === "select") return rows().filter(matches);
    state.writes.push({ table, op, values, filters: [...filters] });
    if (op === "insert" || (op === "upsert" && !rows().some((row) => row.user_id === values.user_id))) {
      rows().push({ ...values });
      return [values];
    }
    const target = op === "upsert" ? rows().filter((row) => row.user_id === values.user_id) : rows().filter(matches);
    target.forEach((row) => Object.assign(row, values));
    return target;
  };
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
    is: (column: string, value: unknown) => { filters.push([column, value]); return builder; },
    order: () => builder,
    update: (next: Row) => { op = "update"; values = next; return builder; },
    insert: (next: Row) => { op = "insert"; values = next; return builder; },
    upsert: (next: Row) => { op = "upsert"; values = next; return builder; },
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null })
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  getCurrentUserId: async () => "user-1",
  createSupabaseAdminClient: () => ({ from: (table: string) => query(table) })
}));
vi.mock("@/lib/memory-events", () => ({ logMemoryEvent: async () => undefined }));

import { PUT as putBrandBrain } from "@/app/api/brand-brain/route";
import { PUT as putGuardrails } from "@/app/api/guardrails/route";
import { POST as createMcpToken } from "@/app/api/mcp/tokens/route";

const zhHeaders = { "Content-Type": "application/json", "Accept-Language": "zh-CN" };

beforeEach(() => {
  state.tables = {};
  state.writes = [];
});

describe("PUT /api/brand-brain optimistic concurrency", () => {
  it("refuses a stale save instead of erasing examples learned elsewhere", async () => {
    state.tables.brand_brains = [{ user_id: "user-1", brand_name: "Finfold", approved_examples: ["learned from publishing"], updated_at: "2026-10-18T10:05:00.000Z" }];
    const response = await putBrandBrain(new Request("https://finfold.test/api/brand-brain", {
      method: "PUT",
      headers: zhHeaders,
      body: JSON.stringify({ brandName: "Finfold", approvedExamples: [], expectedUpdatedAt: "2026-10-18T10:00:00.000Z" })
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("内容已在别处更新，请刷新后再保存");
    expect(state.tables.brand_brains[0].approved_examples).toEqual(["learned from publishing"]);
    expect(state.writes).toHaveLength(0);
  });

  it("saves on top of the loaded version and returns the new one", async () => {
    state.tables.brand_brains = [{ user_id: "user-1", brand_name: "Old", updated_at: "2026-10-18T10:00:00.000+00:00" }];
    const response = await putBrandBrain(new Request("https://finfold.test/api/brand-brain", {
      method: "PUT",
      headers: zhHeaders,
      body: JSON.stringify({ brandName: "New", expectedUpdatedAt: "2026-10-18T10:00:00.000Z" })
    }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.brain.brandName).toBe("New");
    expect(data.updatedAt).not.toBe("2026-10-18T10:00:00.000+00:00");
    expect(state.writes[0]).toMatchObject({ op: "update", filters: [["user_id", "user-1"], ["updated_at", "2026-10-18T10:00:00.000+00:00"]] });
  });
});

describe("PUT /api/guardrails optimistic concurrency", () => {
  it("rejects a full-list save built from stale state", async () => {
    state.tables.custom_guardrails = [{ user_id: "user-1", rules: [{ title: "Agent rule", detail: "added by agent", type: "avoid" }], enabled_packs: [], updated_at: "2026-10-18T11:00:00Z" }];
    const response = await putGuardrails(new Request("https://finfold.test/api/guardrails", {
      method: "PUT",
      headers: zhHeaders,
      body: JSON.stringify({ rules: [], enabledPacks: [], expectedUpdatedAt: "2026-10-18T10:00:00Z" })
    }));
    expect(response.status).toBe(409);
    expect(state.tables.custom_guardrails[0].rules).toHaveLength(1);
  });

  it("keeps rule ids through a save", async () => {
    const response = await putGuardrails(new Request("https://finfold.test/api/guardrails", {
      method: "PUT",
      headers: zhHeaders,
      body: JSON.stringify({ rules: [{ id: "rule-1", title: "No hype", detail: "Avoid superlatives", type: "avoid" }], enabledPacks: [], expectedUpdatedAt: null })
    }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.rules[0].id).toBe("rule-1");
    expect(state.writes[0].op).toBe("insert");
  });
});

describe("POST /api/mcp/tokens", () => {
  it("caps active tokens per user", async () => {
    state.tables.mcp_api_tokens = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, user_id: "user-1", revoked_at: null, expires_at: null }));
    const response = await createMcpToken(new Request("https://finfold.test/api/mcp/tokens", {
      method: "POST",
      headers: zhHeaders,
      body: JSON.stringify({ name: "My agent" })
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("最多同时保留 10 个");
  });
});
