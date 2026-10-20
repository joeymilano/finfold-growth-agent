import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/posthog-server", () => ({ captureServerEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications/refund-email", () => ({
  notifyRefundRequested: vi.fn(),
  notifyUserRefundConfirmed: vi.fn()
}));

import { requestOrderRefund } from "@/lib/payment/order-refund";

function clientReturning(row: Record<string, unknown> | null) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    maybeSingle: async () => ({ data: row, error: null })
  };
  return { from: () => query };
}

describe("one-off order refund copy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("answers in one language per request instead of mixed zh / en", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(clientReturning(null));

    const zh = await requestOrderRefund("user-1", "missing", null, "zh");
    const en = await requestOrderRefund("user-1", "missing", null, "en");

    expect(zh).toMatchObject({ status: "rejected", httpCode: 404 });
    expect(zh.message).toMatch(/^未找到该订单/);
    expect(zh.message).not.toMatch(/Order not found/);
    expect(en.message).toMatch(/^Order not found/);
    expect(en.message).not.toMatch(/[一-鿿]/);
  });

  it("localizes the unpaid-order rejection", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(
      clientReturning({ id: "o1", user_id: "user-1", status: "pending", amount_cents: 100, created_at: new Date().toISOString() })
    );
    const en = await requestOrderRefund("user-1", "o1", null, "en");
    expect(en.message).toBe("Only paid orders can be refunded.");
  });
});
