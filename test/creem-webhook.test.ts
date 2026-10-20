import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCreemCustomerLink,
  buildCreemSubscriptionUpsert,
  isFoundingMemberProduct,
  resolveCreemPlanId
} from "@/lib/payment/creem-webhook";

describe("Creem webhook helpers", () => {
  afterEach(() => {
    delete process.env.CREEM_FOUNDING_MEMBER_PRODUCT_ID;
  });

  it("resolves plan from Creem product environment mapping", () => {
    process.env.CREEM_PRO_PRODUCT_ID = "prod_pro";

    expect(resolveCreemPlanId({ productId: "prod_pro" })).toBe("pro");
  });

  it("falls back to trusted metadata plan when product mapping is unavailable", () => {
    expect(resolveCreemPlanId({ metadataPlan: "pro" })).toBe("pro");
    expect(resolveCreemPlanId({ metadataPlan: "free" })).toBeNull();
  });

  it("resolves the founding-member product to the employee plan", () => {
    process.env.CREEM_FOUNDING_MEMBER_PRODUCT_ID = "prod_founding";

    expect(isFoundingMemberProduct("prod_founding")).toBe(true);
    expect(isFoundingMemberProduct("prod_other")).toBe(false);
    expect(resolveCreemPlanId({ productId: "prod_founding" })).toBe("employee");
  });

  it("builds subscription upsert data with metadata user fallback", () => {
    const upsert = buildCreemSubscriptionUpsert({
      status: "active",
      subscriptionId: "sub_123",
      customerId: "cus_123",
      existingUserId: null,
      metadataUserId: "user_123",
      currentPeriodEnd: "2099-01-01T00:00:00.000Z"
    });

    expect(upsert.userId).toBe("user_123");
    expect(upsert.data).toMatchObject({
      user_id: "user_123",
      payment_provider: "creem",
      provider_customer_id: "cus_123",
      provider_subscription_id: "sub_123",
      status: "active",
      current_period_end: "2099-01-01T00:00:00.000Z"
    });
  });

  it("refuses to build an upsert without a user id", () => {
    expect(() =>
      buildCreemSubscriptionUpsert({
        status: "active",
        subscriptionId: "sub_123",
        customerId: "cus_123",
        existingUserId: null,
        metadataUserId: undefined
      })
    ).toThrow("Cannot upsert Creem subscription without a user_id.");
  });

  it("checkout.completed never downgrades an existing subscription row", () => {
    // subscription.active/paid may arrive before checkout.completed; the late
    // checkout event must only attach the customer id, not reset status.
    const link = buildCreemCustomerLink({
      existingRowId: "sub-row-1",
      userId: "user-1",
      customerId: "cust_1",
      now: "2026-10-18T00:00:00.000Z"
    });
    expect(link).toEqual({
      op: "update",
      id: "sub-row-1",
      data: { provider_customer_id: "cust_1", updated_at: "2026-10-18T00:00:00.000Z" }
    });
    expect(link.data).not.toHaveProperty("status");
  });

  it("checkout.completed seeds a new row as incomplete only when none exists", () => {
    const link = buildCreemCustomerLink({ existingRowId: null, userId: "user-1", customerId: "cust_1" });
    expect(link.op).toBe("insert");
    expect(link.data).toMatchObject({
      user_id: "user-1",
      payment_provider: "creem",
      provider_customer_id: "cust_1",
      status: "incomplete"
    });
  });

  it("routes every credit top-up checkout away from subscription linking", () => {
    const route = readFileSync(join(process.cwd(), "app/api/webhooks/creem/route.ts"), "utf8");
    expect(route).toContain("if (isCreditTopup) {");
    expect(route).not.toContain("isCreditTopup && checkout.metadata?.purchase_id");
    expect(route).toContain("buildCreemCustomerLink(");
  });
});
