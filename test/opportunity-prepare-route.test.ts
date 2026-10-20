import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  loadTopicOpportunity: vi.fn(),
  buildTopicOpportunityGenerationRequest: vi.fn()
}));

vi.mock("@/lib/supabase", () => ({
  getCurrentUserId: mocks.getCurrentUserId,
  createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));
vi.mock("@/lib/trends/service", () => ({
  loadTopicOpportunity: mocks.loadTopicOpportunity,
  buildTopicOpportunityGenerationRequest: mocks.buildTopicOpportunityGenerationRequest
}));

import { POST } from "@/app/api/operations/topic-opportunities/[id]/prepare/route";

const opportunityId = "8f0e6a9c-6f0f-4f43-9d4e-2a1b8c3d4e5f";

function adminFor(row: Record<string, unknown>, outcomes: string[]) {
  const updates: Array<Record<string, unknown>> = [];
  const rpc = vi.fn(async () => ({ data: [{ outcome: outcomes.shift() ?? "conflict", existing_content_kit_id: null }], error: null }));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "is"]) builder[method] = () => builder;
    builder.update = (values: Record<string, unknown>) => {
      updates.push(values);
      return builder;
    };
    builder.maybeSingle = async () => ({ data: row, error: null });
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ error: null });
    return builder;
  });
  return { admin: { rpc, from }, rpc, updates };
}

function request(key: string) {
  return new Request(`https://www.finfold.app/api/operations/topic-opportunities/${opportunityId}/prepare`, {
    method: "POST",
    headers: { "Idempotency-Key": key, "accept-language": "zh-CN" }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUserId.mockResolvedValue("user-1");
  mocks.loadTopicOpportunity.mockResolvedValue({ id: opportunityId });
  mocks.buildTopicOpportunityGenerationRequest.mockResolvedValue({ idea: "x" });
});

describe("opportunity prepare route", () => {
  it("takes over a confirmation that never produced a draft", async () => {
    const { admin, rpc, updates } = adminFor({
      preparation_status: "confirmed",
      preparation_idempotency_key: "old-key-123",
      prepared_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      content_kit_id: null
    }, ["conflict", "claimed"]);
    mocks.createSupabaseAdminClient.mockReturnValue(admin);
    const response = await POST(request("new-key-456"), { params: Promise.resolve({ id: opportunityId }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(updates).toContainEqual(expect.objectContaining({ preparation_status: "failed" }));
  });

  it("explains a recent in-flight confirmation in the user's language", async () => {
    const { admin, rpc } = adminFor({
      preparation_status: "confirmed",
      preparation_idempotency_key: "old-key-123",
      prepared_at: new Date().toISOString(),
      content_kit_id: null
    }, ["conflict"]);
    mocks.createSupabaseAdminClient.mockReturnValue(admin);
    const response = await POST(request("new-key-456"), { params: Promise.resolve({ id: opportunityId }) });
    expect(response.status).toBe(409);
    expect(rpc).toHaveBeenCalledTimes(1);
    const payload = await response.json() as { error: string };
    expect(payload.error).toContain("正在生成草稿");
    expect(payload.error).not.toMatch(/another request/);
  });
});
