import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  ensurePlanCredits: vi.fn(),
  grantPurchaseCredits: vi.fn(),
  verifyZcwNotify: vi.fn(),
  queryZcwGatewayOrder: vi.fn()
}));

vi.mock("@/lib/supabase", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/payment/credits", () => ({
  createPendingPurchase: vi.fn(),
  ensurePlanCredits: mocks.ensurePlanCredits,
  grantPurchaseCredits: mocks.grantPurchaseCredits
}));
vi.mock("@/lib/payment/zcwpay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payment/zcwpay")>();
  return {
    ...actual,
    verifyZcwNotify: mocks.verifyZcwNotify,
    queryZcwGatewayOrder: mocks.queryZcwGatewayOrder
  };
});

import {
  fulfillZcwOrder,
  handleZcwNotify,
  hasActiveCardSubscription,
  syncZcwOrderStatus,
  type ZcwOrder
} from "@/lib/payment/zcw-orders";

type Row = Record<string, unknown>;

/**
 * In-memory Supabase double: eq-filtered select / update / upsert on plain
 * row arrays, with optional one-shot failures per "table:op".
 */
function fakeDb(tables: Record<string, Row[]>, failures: Set<string> = new Set()) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "update" | "upsert" = "select";
    let payload: Row = {};
    let returning = false;
    const matches = () => rows.filter((row) => filters.every(([k, v]) => row[k] === v));
    const fail = () => {
      const key = `${table}:${op}`;
      if (failures.has(key)) {
        failures.delete(key);
        return { message: `forced ${key} failure` };
      }
      return null;
    };
    const run = () => {
      const error = fail();
      if (error) return { data: null, error };
      if (op === "update") {
        const hit = matches();
        hit.forEach((row) => Object.assign(row, payload));
        return { data: returning ? hit : null, error: null };
      }
      if (op === "upsert") {
        const existing = rows.find((row) => row.user_id === payload.user_id && row.payment_provider === payload.payment_provider);
        if (existing) Object.assign(existing, payload);
        else rows.push({ ...payload });
        return { data: null, error: null };
      }
      return { data: matches(), error: null };
    };
    const query = {
      select: () => {
        if (op !== "select") returning = true;
        return query;
      },
      eq: (key: string, value: unknown) => {
        filters.push([key, value]);
        return query;
      },
      update: (next: Row) => {
        op = "update";
        payload = next;
        return query;
      },
      upsert: (next: Row) => {
        op = "upsert";
        payload = next;
        return query;
      },
      maybeSingle: async () => {
        const result = run();
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return { data, error: result.error };
      },
      then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
        Promise.resolve(run()).then(resolve, reject)
    };
    return query;
  };
  return { from };
}

const userId = "a1c85540-4316-4b0f-acf0-714a8dfc89ce";

function planOrder(status: string): Row {
  return {
    id: "order-1",
    user_id: userId,
    status,
    plan: "creator_v2",
    provider: "zcwpay",
    provider_checkout_id: "zcw:alipay:T123",
    order_code: "FF-ABCDEF12",
    amount_cents: 19900,
    confirmed_at: null
  };
}

describe("ZCW fulfillment recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensurePlanCredits.mockResolvedValue(undefined);
    mocks.grantPurchaseCredits.mockResolvedValue("balance-1");
    mocks.verifyZcwNotify.mockReturnValue(true);
  });

  it("fulfills an order our side already closed when the gateway confirms payment", async () => {
    const tables = { credit_purchases: [planOrder("failed")], profiles: [{ id: userId, plan: "free" }], subscriptions: [] };
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb(tables));

    const result = await fulfillZcwOrder("order-1", "T123");

    expect(result).toEqual({ fulfilled: true, alreadyPaid: false });
    expect(tables.credit_purchases[0].status).toBe("paid");
    expect(tables.profiles[0].plan).toBe("creator_v2");
    expect(tables.subscriptions).toHaveLength(1);
  });

  it("revives a closed credit-pack order before granting the pack", async () => {
    const order: Row = { ...planOrder("failed"), plan: null };
    const tables = { credit_purchases: [order] };
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb(tables));

    const result = await fulfillZcwOrder("order-1", "T123");

    expect(result).toEqual({ fulfilled: true, alreadyPaid: false });
    expect(mocks.grantPurchaseCredits).toHaveBeenCalledWith("order-1", "T123");
    // The RPC only grants from `pending`, so the row must be reopened first.
    expect(order.status).toBe("pending");
  });

  it("releases the claim when the plan cannot be activated, so a retry completes it", async () => {
    const tables = { credit_purchases: [planOrder("pending")], profiles: [{ id: userId, plan: "free" }], subscriptions: [] };
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb(tables, new Set(["subscriptions:upsert"])));

    await expect(fulfillZcwOrder("order-1", "T123")).rejects.toThrow("Failed to record the subscription.");
    expect(tables.credit_purchases[0]).toMatchObject({
      status: "pending",
      confirmed_at: null,
      provider_checkout_id: "zcw:alipay:T123"
    });

    const retry = await fulfillZcwOrder("order-1", "T123");
    expect(retry).toEqual({ fulfilled: true, alreadyPaid: false });
    expect(tables.credit_purchases[0].status).toBe("paid");
    expect(tables.subscriptions).toHaveLength(1);
  });

  it("keeps the plan open when only the credit grant fails", async () => {
    const tables = { credit_purchases: [planOrder("pending")], profiles: [{ id: userId, plan: "free" }], subscriptions: [] };
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb(tables));
    mocks.ensurePlanCredits.mockRejectedValueOnce(new Error("rpc down"));

    const result = await fulfillZcwOrder("order-1", "T123");

    expect(result).toEqual({ fulfilled: true, alreadyPaid: false });
    expect(tables.credit_purchases[0].status).toBe("paid");
  });

  it("does not acknowledge a paid notify for an order in an unexpected state", async () => {
    const tables = { credit_purchases: [planOrder("cancelled")] };
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb(tables));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await handleZcwNotify({
      pid: "1", tradeNo: "T123", outTradeNo: "FF-ABCDEF12", apiTradeNo: "", type: "alipay",
      tradeStatus: "TRADE_SUCCESS", money: "199.00", buyer: "", timestamp: "0", sign: "s"
    });

    expect(result).toEqual({ ok: false, reason: "unexpected_status" });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("acknowledges a paid notify that arrives after the local window closed", async () => {
    const tables = { credit_purchases: [planOrder("failed")], profiles: [{ id: userId, plan: "free" }], subscriptions: [] };
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb(tables));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await handleZcwNotify({
      pid: "1", tradeNo: "T123", outTradeNo: "FF-ABCDEF12", apiTradeNo: "", type: "alipay",
      tradeStatus: "TRADE_SUCCESS", money: "199.00", buyer: "", timestamp: "0", sign: "s"
    });

    expect(result).toEqual({ ok: true });
    expect(tables.profiles[0].plan).toBe("creator_v2");
  });

  it("re-checks a locally closed order on the status page and fulfills a late payment", async () => {
    const tables = { credit_purchases: [planOrder("failed")], profiles: [{ id: userId, plan: "free" }], subscriptions: [] };
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb(tables));
    mocks.queryZcwGatewayOrder.mockResolvedValue({ status: "paid", money: "199.00", tradeNo: "T123" });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const view: ZcwOrder = {
      id: "order-1", orderCode: "FF-ABCDEF12", credits: 2000, amountCents: 19900, amountYuan: "199.00",
      status: "failed", channel: "alipay", plan: "creator_v2", payType: null, payInfo: null,
      expiresAt: new Date(Date.now() - 60_000).toISOString(), createdAt: new Date().toISOString()
    };
    const synced = await syncZcwOrderStatus(view);

    expect(synced.status).toBe("paid");
    expect(tables.profiles[0].plan).toBe("creator_v2");
  });

  it("skips the gateway for closed orders the gateway never accepted", async () => {
    mocks.createSupabaseAdminClient.mockReturnValue(fakeDb({}));
    const view: ZcwOrder = {
      id: "order-2", orderCode: "FF-00000000", credits: 500, amountCents: 4900, amountYuan: "49.00",
      status: "failed", channel: null, plan: null, payType: null, payInfo: null, expiresAt: null,
      createdAt: new Date().toISOString()
    };
    expect(await syncZcwOrderStatus(view)).toBe(view);
    expect(mocks.queryZcwGatewayOrder).not.toHaveBeenCalled();
  });
});

describe("scan-to-pay vs card subscription", () => {
  it("detects a live Creem card subscription", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    mocks.createSupabaseAdminClient.mockReturnValue(
      fakeDb({ subscriptions: [{ user_id: userId, payment_provider: "creem", status: "active", current_period_end: future }] })
    );
    expect(await hasActiveCardSubscription(userId)).toBe(true);
  });

  it("ignores canceled card subscriptions and scan-to-pay rows", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    mocks.createSupabaseAdminClient.mockReturnValue(
      fakeDb({
        subscriptions: [
          { user_id: userId, payment_provider: "creem", status: "canceled", current_period_end: future },
          { user_id: userId, payment_provider: "zcwpay", status: "active", current_period_end: future }
        ]
      })
    );
    expect(await hasActiveCardSubscription(userId)).toBe(false);
  });
});
