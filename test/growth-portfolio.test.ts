import { describe, expect, it } from "vitest";
import {
  buildGrowthPortfolioOverview,
  growthAccountArchiveInputSchema,
  growthAccountInputSchema,
  growthGoalInputSchema,
  type ManagedSocialAccountRow,
  type SocialAccountSnapshotRow
} from "@/lib/growth-portfolio";

const accounts: ManagedSocialAccountRow[] = [
  {
    id: "account-xhs",
    platform: "xiaohongshu",
    display_name: "Finfold 小红书",
    handle: "@finfold",
    avatar_url: null,
    status: "active",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-15T00:00:00.000Z"
  },
  {
    id: "account-linkedin",
    platform: "linkedin",
    display_name: "Finfold LinkedIn",
    handle: null,
    avatar_url: null,
    status: "active",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-15T00:00:00.000Z"
  }
];

const snapshots: SocialAccountSnapshotRow[] = [
  {
    id: "snapshot-1",
    account_id: "account-xhs",
    follower_count: 10_000,
    period_follower_growth: 800,
    views: 80_000,
    leads: 8,
    source: "manual",
    measured_at: "2026-08-01T10:00:00.000Z"
  },
  {
    id: "snapshot-2",
    account_id: "account-linkedin",
    follower_count: 5_000,
    period_follower_growth: 200,
    views: 20_000,
    leads: 2,
    source: "official_sync",
    measured_at: "2026-08-05T10:00:00.000Z"
  },
  {
    id: "snapshot-3",
    account_id: "account-xhs",
    follower_count: 11_000,
    period_follower_growth: 1_800,
    views: 120_000,
    leads: 12,
    source: "manual",
    measured_at: "2026-08-15T10:00:00.000Z"
  }
];

describe("growth portfolio aggregation", () => {
  it("does not report last month's snapshot as this month's growth or goal progress", () => {
    const overview = buildGrowthPortfolioOverview(accounts, snapshots, {
      id: "goal-views",
      period_type: "month",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      metric: "views",
      target_value: 200_000,
      status: "active"
    }, new Date("2026-09-20T00:00:00.000Z"));
    expect(overview.totalFollowers).toBe(16_000);
    expect(overview.monthlyGrowth).toBeNull();
    expect(overview.accounts.every((account) => account.periodFollowerGrowth === null)).toBe(true);
    expect(overview.goal?.currentValue).toBeNull();
  });

  it("surfaces an account bound in Settings before its first sync lands", () => {
    const linked: ManagedSocialAccountRow[] = [{ ...accounts[1], connected_account_id: "conn-linkedin" }];
    const overview = buildGrowthPortfolioOverview(
      linked,
      [],
      null,
      new Date("2026-08-16T00:00:00.000Z"),
      [{ connector_id: "linkedin" }, { connector_id: "wechat" }],
      [
        { id: "conn-linkedin", connector_id: "linkedin", display_name: "Finfold LinkedIn", handle: null, avatar_url: null },
        { id: "conn-wechat", connector_id: "wechat", display_name: "Finfold 公众号", handle: "finfold", avatar_url: null }
      ]
    );
    expect(overview.pendingConnectedAccounts).toEqual([
      { connectedAccountId: "conn-wechat", platform: "wechat", displayName: "Finfold 公众号", handle: "finfold", avatarUrl: null }
    ]);
  });

  it("keeps missing numbers missing instead of showing convincing zeroes", () => {
    const overview = buildGrowthPortfolioOverview(accounts, [], null, new Date("2026-08-16T00:00:00.000Z"));
    expect(overview.totalFollowers).toBeNull();
    expect(overview.monthlyGrowth).toBeNull();
    expect(overview.timeSeries).toEqual([]);
    expect(overview.insight.kind).toBe("needs_data");
  });

  it("draws the views curve from any reporting account without waiting for all of them", () => {    // X reports followers only (no profile views), which must not block the
    // views chart the way it would block the follower gauge.
    const xAccount: ManagedSocialAccountRow = {
      id: "account-x",
      platform: "x",
      display_name: "Finfold X",
      handle: "@finfold",
      avatar_url: null,
      status: "active",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-15T00:00:00.000Z"
    };
    const xSnapshot: SocialAccountSnapshotRow = {
      id: "snapshot-x",
      account_id: "account-x",
      follower_count: 192,
      period_follower_growth: null,
      views: null,
      leads: null,
      source: "official_sync",
      measured_at: "2026-08-10T10:00:00.000Z"
    };
    const overview = buildGrowthPortfolioOverview(
      [...accounts, xAccount],
      [...snapshots, xSnapshot],
      null,
      new Date("2026-08-16T00:00:00.000Z")
    );
    expect(overview.viewsTimeSeries.length).toBeGreaterThan(0);
    const first = overview.viewsTimeSeries[0];
    expect(first.date).toBe("2026-08-01");
    expect(first.views).toBe(80_000);
    expect(overview.viewsTimeSeries[overview.viewsTimeSeries.length - 1].views).toBe(140_000);
  });

  it("states the plain fact instead of a meaningless 100% when only one account reports growth", () => {
    // X syncs follower count only (period_follower_growth null), so the
    // xiaohongshu account is the lone growth reporter.
    const xAccount: ManagedSocialAccountRow = {
      id: "account-x",
      platform: "x",
      display_name: "Finfold X",
      handle: "@finfold",
      avatar_url: null,
      status: "active",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-15T00:00:00.000Z"
    };
    const xSnapshot: SocialAccountSnapshotRow = {
      id: "snapshot-x",
      account_id: "account-x",
      follower_count: 192,
      period_follower_growth: null,
      views: null,
      leads: null,
      source: "official_sync",
      measured_at: "2026-08-15T11:00:00.000Z"
    };
    const overview = buildGrowthPortfolioOverview(
      [accounts[0], xAccount],
      [...snapshots, xSnapshot],
      null,
      new Date("2026-08-16T00:00:00.000Z")
    );
    expect(overview.insight.kind).toBe("single_reporter");
    expect(overview.insight.accountId).toBe("account-xhs");
    expect(overview.insight.messageZh).toContain("+1800");
    expect(overview.insight.messageZh).toContain("全部来自小红书");
    expect(overview.insight.messageZh).toContain("X还没有增长基线（现 192 粉）");
    expect(overview.insight.messageZh).toContain("单账号扛盘");
    expect(overview.insight.messageZh).not.toContain("100%");
  });

  it("sums only the latest real snapshot for each account", () => {
    const overview = buildGrowthPortfolioOverview(accounts, snapshots, null, new Date("2026-08-16T00:00:00.000Z"));
    expect(overview.totalFollowers).toBe(16_000);
    expect(overview.monthlyGrowth).toBe(2_000);
    expect(overview.knownFollowerAccounts).toBe(2);
    expect(overview.lastUpdatedAt).toBe("2026-08-15T10:00:00.000Z");
  });

  it("starts the portfolio curve only after all active accounts have a known total", () => {
    const overview = buildGrowthPortfolioOverview(accounts, snapshots, null, new Date("2026-08-16T00:00:00.000Z"));
    expect(overview.timeSeries[0]).toEqual({ date: "2026-08-05", followers: 15_000 });
    expect(overview.timeSeries.at(-1)).toEqual({ date: "2026-08-16", followers: 16_000 });
  });

  it("computes one clear goal and a plain-language growth driver", () => {
    const overview = buildGrowthPortfolioOverview(accounts, snapshots, {
      id: "goal-1",
      period_type: "month",
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      metric: "follower_growth",
      target_value: 4_000,
      status: "active"
    }, new Date("2026-08-16T00:00:00.000Z"));
    expect(overview.goal?.progress).toBe(0.5);
    expect(overview.insight.kind).toBe("growth_driver");
    expect(overview.insight.accountId).toBe("account-xhs");
    expect(overview.insight.messageZh).toContain("90%");
  });
});

describe("growth portfolio official accounts and periods", () => {
  const xAccount: ManagedSocialAccountRow = {
    id: "account-x",
    platform: "x",
    display_name: "Finfold X",
    handle: "@finfold",
    avatar_url: null,
    connected_account_id: "conn-x",
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z"
  };
  const official = (id: string, followers: number, measuredAt: string): SocialAccountSnapshotRow => ({
    id,
    account_id: "account-x",
    follower_count: followers,
    period_follower_growth: null,
    views: null,
    leads: null,
    source: "official_sync",
    measured_at: measuredAt
  });

  it("does not offer an archived binding as pending again", () => {
    const overview = buildGrowthPortfolioOverview(
      [{ ...xAccount, status: "archived" }],
      [],
      null,
      new Date("2026-09-20T00:00:00.000Z"),
      [{ connector_id: "x" }],
      [{ id: "conn-x", connector_id: "x", display_name: "Finfold X", handle: "@finfold", avatar_url: null }]
    );
    expect(overview.totalAccounts).toBe(0);
    expect(overview.pendingConnectedAccounts).toEqual([]);
  });

  it("derives an official account's monthly growth from this month's first and latest readings", () => {
    const overview = buildGrowthPortfolioOverview([xAccount], [
      official("x-aug", 100, "2026-08-25T02:00:00.000Z"),
      official("x-sep-1", 120, "2026-09-02T02:00:00.000Z"),
      official("x-sep-2", 150, "2026-09-18T02:00:00.000Z")
    ], null, new Date("2026-09-20T00:00:00.000Z"));
    expect(overview.accounts[0].periodFollowerGrowth).toBe(30);
    expect(overview.accounts[0].periodFollowerGrowthSource).toBe("derived");
    expect(overview.monthlyGrowth).toBe(30);
  });

  it("keeps a single reading this month as a baseline, not growth", () => {
    const overview = buildGrowthPortfolioOverview([xAccount], [
      official("x-sep-1", 120, "2026-09-02T02:00:00.000Z")
    ], null, new Date("2026-09-20T00:00:00.000Z"));
    expect(overview.accounts[0].periodFollowerGrowth).toBeNull();
  });

  it("measures a yearly follower goal over the year, not this month", () => {
    const overview = buildGrowthPortfolioOverview([xAccount], [
      official("x-jan", 100, "2026-01-05T02:00:00.000Z"),
      official("x-sep-1", 400, "2026-09-02T02:00:00.000Z"),
      official("x-sep-2", 500, "2026-09-18T02:00:00.000Z")
    ], {
      id: "goal-year",
      period_type: "year",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      metric: "follower_growth",
      target_value: 1_000,
      status: "active"
    }, new Date("2026-09-20T00:00:00.000Z"));
    expect(overview.monthlyGrowth).toBe(100);
    expect(overview.goal?.currentValue).toBe(400);
    expect(overview.goal?.progress).toBe(0.4);
  });

  it("buckets the trend by China-time day, matching 本月新增", () => {
    const overview = buildGrowthPortfolioOverview([xAccount], [
      official("x-late", 150, "2026-09-17T20:00:00.000Z")
    ], null, new Date("2026-09-18T02:00:00.000Z"));
    expect(overview.timeSeries).toEqual([{ date: "2026-09-18", followers: 150 }]);
  });
});

describe("growth portfolio input contracts", () => {
  it("requires a real non-negative follower total", () => {
    expect(() => growthAccountInputSchema.parse({ platform: "xiaohongshu", displayName: "Test", followerCount: -1 })).toThrow();
    expect(growthAccountInputSchema.parse({ platform: "xiaohongshu", displayName: "Test", followerCount: 0 }).followerCount).toBe(0);
  });

  it("accepts one simple monthly target", () => {
    expect(growthGoalInputSchema.parse({
      periodType: "month",
      metric: "follower_growth",
      targetValue: 2_000,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31"
    }).targetValue).toBe(2_000);
  });

  it("requires a real account id before archiving", () => {
    expect(growthAccountArchiveInputSchema.parse({ accountId: "fd5c0925-c441-4f24-8841-5c80bb580ea7" }).accountId).toBe("fd5c0925-c441-4f24-8841-5c80bb580ea7");
    expect(() => growthAccountArchiveInputSchema.parse({ accountId: "account-xhs" })).toThrow();
  });
});
