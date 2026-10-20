import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionMissingError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  currentPeriodKey: vi.fn(),
  getCreditAllowanceSnapshot: vi.fn(),
  getCreditSpendSummary: vi.fn(),
  hasSupabaseConfig: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  getUser: vi.fn()
}));

vi.mock("@/lib/payment", async () => {
  const { creditCycleBounds } = await vi.importActual<typeof import("@/lib/payment/credits")>("@/lib/payment/credits");
  return {
    creditCycleBounds,
    currentPeriodKey: mocks.currentPeriodKey,
    getCreditAllowanceSnapshot: mocks.getCreditAllowanceSnapshot,
    getCreditSpendSummary: mocks.getCreditSpendSummary
  };
});

vi.mock("@/lib/supabase", () => ({
  hasSupabaseConfig: mocks.hasSupabaseConfig,
  createSupabaseServerClient: mocks.createSupabaseServerClient
}));

import { GET } from "@/app/api/credits/spend-summary/route";

describe("GET /api/credits/spend-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSupabaseConfig.mockReturnValue(true);
    mocks.currentPeriodKey.mockReturnValue("2026-08");
    mocks.getCreditAllowanceSnapshot.mockResolvedValue({ used: 0, available: 50, periodKey: "2026-08" });
    mocks.createSupabaseServerClient.mockResolvedValue({
      auth: { getUser: mocks.getUser }
    });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null
    });
  });

  it("returns explicit semantics from one lower/upper bounded cycle", async () => {
    mocks.getCreditSpendSummary.mockResolvedValue({
      items: [{ action: "contentKitBase", credits: 15 }],
      grossReserved: 15,
      refunded: 5,
      netCharged: 10,
      manualCredits: 20,
      manualDebits: 3,
      expiredCredits: 4
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ action: "contentKitBase", credits: 15 }],
      grossReserved: 15,
      refunded: 5,
      netCharged: 10,
      manualCredits: 20,
      manualDebits: 3,
      expiredCredits: 4,
      cycleStart: "2026-08-01T00:00:00Z",
      cycleEnd: "2026-09-01T00:00:00Z"
    });
    expect(mocks.getCreditAllowanceSnapshot).toHaveBeenCalledWith("user-1");
    expect(mocks.getCreditSpendSummary).toHaveBeenCalledWith(
      "user-1",
      "2026-08-01T00:00:00Z",
      "2026-09-01T00:00:00Z"
    );
  });

  it("scopes a scan-pay plan to its paid 30-day window", async () => {
    mocks.getCreditAllowanceSnapshot.mockResolvedValue({
      used: 120,
      available: 4880,
      periodKey: "scan-2026-11-17T08:00:00Z"
    });
    mocks.getCreditSpendSummary.mockResolvedValue({
      items: [], grossReserved: 0, refunded: 0, netCharged: 0, manualCredits: 0, manualDebits: 0, expiredCredits: 0
    });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      cycleStart: "2026-10-18T08:00:00.000Z",
      cycleEnd: "2026-11-17T08:00:00.000Z"
    });
    expect(mocks.getCreditSpendSummary).toHaveBeenCalledWith(
      "user-1",
      "2026-10-18T08:00:00.000Z",
      "2026-11-17T08:00:00.000Z"
    );
  });

  it("falls back to the calendar month when the allowance read fails", async () => {
    mocks.getCreditAllowanceSnapshot.mockResolvedValue(null);
    mocks.getCreditSpendSummary.mockResolvedValue({
      items: [], grossReserved: 0, refunded: 0, netCharged: 0, manualCredits: 0, manualDebits: 0, expiredCredits: 0
    });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      cycleStart: "2026-08-01T00:00:00Z",
      cycleEnd: "2026-09-01T00:00:00Z"
    });
  });

  it("returns 401 for a confirmed unauthenticated request", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getCreditSpendSummary).not.toHaveBeenCalled();
  });

  it("returns 401 when Supabase reports that the auth session is missing", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError()
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getCreditSpendSummary).not.toHaveBeenCalled();
  });

  it("fails closed when authentication returns a read error", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "auth service unavailable" }
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication is temporarily unavailable."
    });
    expect(mocks.getCreditSpendSummary).not.toHaveBeenCalled();
  });

  it("fails closed when authentication throws", async () => {
    mocks.getUser.mockRejectedValue(new Error("network failure"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(mocks.getCreditSpendSummary).not.toHaveBeenCalled();
  });

  it("fails closed when the authoritative ledger read is unavailable", async () => {
    mocks.getCreditSpendSummary.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Credits activity is temporarily unavailable."
    });
  });
});
