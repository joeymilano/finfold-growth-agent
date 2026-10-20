import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  ensurePlanCredits: vi.fn(),
  grantPurchaseCredits: vi.fn()
}));

vi.mock("@/lib/supabase", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/payment/credits", () => ({
  createPendingPurchase: vi.fn(),
  ensurePlanCredits: mocks.ensurePlanCredits,
  grantPurchaseCredits: mocks.grantPurchaseCredits
}));

import { fulfillZcwOrder } from "@/lib/payment/zcw-orders";

const userId = "a1c85540-4316-4b0f-acf0-714a8dfc89ce";

/** Minimal chainable Supabase double that records every write per table. */
function fakeAdmin(plan: string) {
  const writes: Array<{ table: string; op: string; payload: unknown }> = [];
  const from = vi.fn((table: string) => {
    let op = "select";
    const query: Record<string, unknown> = {};
    const chain = () => query;
    Object.assign(query, {
      select: vi.fn(chain),
      eq: vi.fn(chain),
      update: vi.fn((payload: unknown) => { op = "update"; writes.push({ table, op, payload }); return query; }),
      upsert: vi.fn((payload: unknown) => { op = "upsert"; writes.push({ table, op, payload }); return query; }),
      maybeSingle: vi.fn(async () => {
        if (table === "credit_purchases" && op === "select") {
          return { data: { id: "order-1", status: "pending", plan, provider: "zcwpay" }, error: null };
        }
        if (table === "credit_purchases" && op === "update") {
          return { data: { user_id: userId, plan, order_code: "FF123" }, error: null };
        }
        return { data: null, error: null };
      }),
      then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null })
    });
    return query;
  });
  return { client: { from }, writes };
}

describe("ZCW scan-to-pay fulfillment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.grantPurchaseCredits.mockResolvedValue("balance-1");
  });

  it.each(["starter_v2", "creator_v2", "growth_v2", "digital_employee_v2"])(
    "activates the %s plan instead of crediting a pack",
    async (plan) => {
      const { client, writes } = fakeAdmin(plan);
      mocks.createSupabaseAdminClient.mockReturnValue(client);

      const result = await fulfillZcwOrder("order-1", "trade-1");

      expect(result).toEqual({ fulfilled: true, alreadyPaid: false });
      expect(mocks.grantPurchaseCredits).not.toHaveBeenCalled();
      expect(writes.find((write) => write.table === "profiles")?.payload).toMatchObject({ plan });
      expect(writes.some((write) => write.table === "subscriptions" && write.op === "upsert")).toBe(true);
      expect(mocks.ensurePlanCredits).toHaveBeenCalledWith(userId, plan);
    }
  );
});
