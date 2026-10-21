// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PACK_ENV_KEYS = [
  "CREEM_CREDIT_PACK_CN_STARTER_PRODUCT_ID",
  "CREEM_CREDIT_PACK_CN_STANDARD_PRODUCT_ID",
  "CREEM_CREDIT_PACK_CN_PLUS_PRODUCT_ID",
  "CREEM_CREDIT_PACK_CN_PRO_PRODUCT_ID",
  "CREEM_CREDIT_PACK_GLOBAL_STARTER_PRODUCT_ID",
  "CREEM_CREDIT_PACK_GLOBAL_STANDARD_PRODUCT_ID",
  "CREEM_CREDIT_PACK_GLOBAL_PLUS_PRODUCT_ID",
  "CREEM_CREDIT_PACK_GLOBAL_PRO_PRODUCT_ID",
  "CREEM_CREDIT_PACK_PRODUCTS"
];

async function loadCreem() {
  // The merged-id lookup memoizes per isolate; reload for a clean cache.
  vi.resetModules();
  return import("@/lib/payment/creem");
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  for (const key of PACK_ENV_KEYS) delete process.env[key];
});

describe("credit-pack product id sources (single JSON secret vs legacy per-product vars)", () => {
  it("reads all packs from the merged JSON secret alone", async () => {
    process.env.CREEM_CREDIT_PACK_PRODUCTS = JSON.stringify({
      cn: { starter_pack: "prod_cn_starter", plus_pack: "prod_cn_plus" },
      global: { pro_pack: "prod_global_pro" }
    });
    const { hasCreditPackCheckoutTarget } = await loadCreem();
    expect(hasCreditPackCheckoutTarget("starter_pack")).toBe(true);
    expect(hasCreditPackCheckoutTarget("pro_pack")).toBe(true);
    expect(hasCreditPackCheckoutTarget("standard_pack")).toBe(false);
  });

  it("falls back to the legacy per-product vars when the JSON secret is absent", async () => {
    process.env.CREEM_CREDIT_PACK_GLOBAL_PLUS_PRODUCT_ID = "prod_global_plus";
    const { hasCreditPackCheckoutTarget } = await loadCreem();
    expect(hasCreditPackCheckoutTarget("plus_pack")).toBe(true);
  });

  it("degrades to the legacy vars when the JSON secret is malformed, never breaking checkout", async () => {
    process.env.CREEM_CREDIT_PACK_PRODUCTS = "{not json";
    process.env.CREEM_CREDIT_PACK_CN_PRO_PRODUCT_ID = "prod_cn_pro";
    const { hasCreditPackCheckoutTarget } = await loadCreem();
    expect(hasCreditPackCheckoutTarget("pro_pack")).toBe(true);
  });

  it("prefers the merged secret over a same-named legacy var", async () => {
    process.env.CREEM_CREDIT_PACK_PRODUCTS = JSON.stringify({ cn: { starter_pack: "prod_merged" } });
    process.env.CREEM_CREDIT_PACK_CN_STARTER_PRODUCT_ID = "prod_legacy";
    const { resolveCreditPackByProductId } = await loadCreem();
    // Reverse lookup only sees the ids that actually won resolution.
    expect(resolveCreditPackByProductId("prod_merged")).toBe("starter_pack");
    expect(resolveCreditPackByProductId("prod_legacy")).toBeUndefined();
  });
});
