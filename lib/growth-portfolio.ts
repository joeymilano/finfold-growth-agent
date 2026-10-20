import { z } from "zod";
import type { PlatformId } from "@/lib/platforms";

export const GROWTH_PLATFORM_IDS = [
  "wechat", "xiaohongshu", "zhihu", "moments", "x", "linkedin",
  "instagram", "facebook", "reddit", "product-hunt", "threads",
  "hacker-news", "indie-hackers", "medium-substack"
] as const satisfies readonly PlatformId[];

export const growthAccountInputSchema = z.object({
  accountId: z.string().uuid().nullable().optional(),
  platform: z.enum(GROWTH_PLATFORM_IDS),
  displayName: z.string().trim().min(1).max(120),
  handle: z.string().trim().max(160).nullable().optional(),
  followerCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  periodFollowerGrowth: z.number().int().min(-2_000_000_000).max(2_000_000_000).nullable().optional(),
  views: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  leads: z.number().int().nonnegative().max(2_000_000_000).nullable().optional(),
  measuredAt: z.string().datetime().optional()
});

export const growthGoalInputSchema = z.object({
  periodType: z.enum(["month", "year"]),
  metric: z.enum(["follower_growth", "views", "leads"]),
  targetValue: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  periodStart: z.string().date(),
  periodEnd: z.string().date()
});

export const growthAccountArchiveInputSchema = z.object({
  accountId: z.string().uuid()
});

export type GrowthAccountInput = z.infer<typeof growthAccountInputSchema>;
export type GrowthAccountArchiveInput = z.infer<typeof growthAccountArchiveInputSchema>;
export type GrowthGoalInput = z.infer<typeof growthGoalInputSchema>;

export type ManagedSocialAccountRow = {
  id: string;
  platform: PlatformId;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  connected_account_id?: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

/** An account under a connected official authorization (Settings binding). */
export type ConnectedSocialAccountRow = {
  id: string;
  connector_id: string;
  display_name: string | null;
  handle: string | null;
  avatar_url: string | null;
};

export type GrowthPortfolioPendingAccount = {
  connectedAccountId: string;
  platform: PlatformId;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
};

export type SocialAccountSnapshotRow = {
  id: string;
  account_id: string;
  follower_count: number | null;
  period_follower_growth: number | null;
  views: number | null;
  leads: number | null;
  source: "manual" | "import" | "official_sync";
  measured_at: string;
};

export type GrowthPortfolioGoalRow = {
  id: string;
  period_type: "month" | "year";
  period_start: string;
  period_end: string;
  metric: "follower_growth" | "views" | "leads";
  target_value: number;
  status: "active" | "completed" | "archived";
};

export type GrowthPortfolioAccount = {
  id: string;
  platform: PlatformId;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  periodFollowerGrowth: number | null;
  /** "reported" = entered or provided by the platform; "derived" = computed from this month's snapshots. */
  periodFollowerGrowthSource?: "reported" | "derived" | null;
  views: number | null;
  leads: number | null;
  measuredAt: string | null;
  source: SocialAccountSnapshotRow["source"] | null;
};

export type GrowthPortfolioOverview = {
  totalFollowers: number | null;
  monthlyGrowth: number | null;
  knownFollowerAccounts: number;
  knownGrowthAccounts: number;
  totalAccounts: number;
  hasConnectedAuthorizations: boolean;
  /** Bound in Settings but not yet mirrored into the portfolio by a first sync. */
  pendingConnectedAccounts: GrowthPortfolioPendingAccount[];
  timeSeries: Array<{ date: string; followers: number }>;
  viewsTimeSeries: Array<{ date: string; views: number }>;
  accounts: GrowthPortfolioAccount[];
  goal: null | {
    id: string;
    periodType: "month" | "year";
    metric: "follower_growth" | "views" | "leads";
    targetValue: number;
    currentValue: number | null;
    progress: number | null;
    periodStart: string;
    periodEnd: string;
  };
  insight: {
    kind: "growth_driver" | "flat" | "needs_data" | "single_reporter";
    accountId: string | null;
    messageZh: string;
    messageEn: string;
  };
  lastUpdatedAt: string | null;
};

function latestSnapshotsByAccount(snapshots: SocialAccountSnapshotRow[]) {
  const latest = new Map<string, SocialAccountSnapshotRow>();
  for (const snapshot of [...snapshots].sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at))) {
    if (!latest.has(snapshot.account_id)) latest.set(snapshot.account_id, snapshot);
  }
  return latest;
}

function sumKnown(values: Array<number | null>): { value: number | null; known: number } {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return { value: known.length ? known.reduce((sum, value) => sum + value, 0) : null, known: known.length };
}

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar month in China time, matching how WeChat reports monthly growth. */
function shanghaiMonthKey(value: string | Date): string {
  return new Date(new Date(value).getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 7);
}

function shanghaiDay(value: string | Date): string {
  return new Date(new Date(value).getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC-midnight Date whose ISO date is the China-time calendar day of value. */
function shanghaiCalendarDate(value: string | Date): Date {
  const shifted = new Date(new Date(value).getTime() + SHANGHAI_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function isoDay(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Follower change between the first and the latest snapshot whose China-time
 * day falls inside [fromDay, toDay]. Needs two distinct readings; a single
 * reading is a baseline, not growth.
 */
function followerGrowthWithin(
  snapshots: SocialAccountSnapshotRow[],
  fromDay: string,
  toDay: string
): number | null {
  const readings = snapshots
    .filter((snapshot) => {
      if (snapshot.follower_count === null) return false;
      const day = shanghaiDay(snapshot.measured_at);
      return day >= fromDay && day <= toDay;
    })
    .sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));
  if (readings.length < 2) return null;
  const first = readings[0];
  const last = readings[readings.length - 1];
  if (Date.parse(first.measured_at) === Date.parse(last.measured_at)) return null;
  return (last.follower_count as number) - (first.follower_count as number);
}

/**
 * Daily portfolio series bucketed by China-time calendar day (the same clock
 * as 「本月新增」). With requireEveryAccount the line starts only once every
 * account has a known value; otherwise unknown accounts contribute zero.
 */
function buildDailySeries(
  accountIds: string[],
  snapshots: SocialAccountSnapshotRow[],
  now: Date,
  pick: (snapshot: SocialAccountSnapshotRow) => number | null,
  requireEveryAccount: boolean
): Array<{ date: string; value: number }> {
  if (accountIds.length === 0) return [];
  const ids = new Set(accountIds);
  const readings = snapshots
    .filter((snapshot) => pick(snapshot) !== null && ids.has(snapshot.account_id))
    .sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));
  if (readings.length === 0) return [];

  const end = shanghaiCalendarDate(now);
  const windowStart = new Date(end);
  windowStart.setUTCDate(windowStart.getUTCDate() - 89);
  const earliest = shanghaiCalendarDate(readings[0].measured_at);
  const firstDay = earliest > windowStart ? earliest : windowStart;
  const latestByAccount = new Map<string, number>();
  let cursor = 0;
  const result: Array<{ date: string; value: number }> = [];

  for (let day = new Date(firstDay); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const endOfDay = day.getTime() + DAY_MS - 1 - SHANGHAI_OFFSET_MS;
    while (cursor < readings.length && Date.parse(readings[cursor].measured_at) <= endOfDay) {
      latestByAccount.set(readings[cursor].account_id, pick(readings[cursor]) as number);
      cursor += 1;
    }
    const ready = requireEveryAccount ? latestByAccount.size === ids.size : latestByAccount.size > 0;
    if (ready) {
      result.push({
        date: isoDay(day),
        value: [...latestByAccount.values()].reduce((sum, value) => sum + value, 0)
      });
    }
  }
  return result;
}

function buildFollowerSeries(
  accountIds: string[],
  snapshots: SocialAccountSnapshotRow[],
  now: Date
): Array<{ date: string; followers: number }> {
  // Do not draw a misleading partial total. The portfolio line starts only
  // once every active account has a known follower count.
  return buildDailySeries(accountIds, snapshots, now, (snapshot) => snapshot.follower_count, true)
    .map((point) => ({ date: point.date, followers: point.value }));
}

/**
 * Views are a period metric not every platform reports (X public_metrics has
 * no profile-view count), so a day enters the series as soon as ANY account
 * has a known views value; unknown accounts simply contribute zero instead
 * of blocking the line like the follower gauge does.
 */
function buildViewsSeries(
  accountIds: string[],
  snapshots: SocialAccountSnapshotRow[],
  now: Date
): Array<{ date: string; views: number }> {
  return buildDailySeries(accountIds, snapshots, now, (snapshot) => snapshot.views, false)
    .map((point) => ({ date: point.date, views: point.value }));
}

export function buildGrowthPortfolioOverview(
  accounts: ManagedSocialAccountRow[],
  snapshots: SocialAccountSnapshotRow[],
  goalRow: GrowthPortfolioGoalRow | null,
  now = new Date(),
  connections: Array<{ connector_id: string }> = [],
  connectedAccounts: ConnectedSocialAccountRow[] = []
): GrowthPortfolioOverview {
  const activeAccounts = accounts.filter((account) => account.status === "active");
  const activeIds = new Set(activeAccounts.map((account) => account.id));
  const activeSnapshots = snapshots.filter((snapshot) => activeIds.has(snapshot.account_id));
  const latest = latestSnapshotsByAccount(activeSnapshots);
  const snapshotsByAccount = new Map<string, SocialAccountSnapshotRow[]>();
  for (const snapshot of activeSnapshots) {
    const list = snapshotsByAccount.get(snapshot.account_id) ?? [];
    list.push(snapshot);
    snapshotsByAccount.set(snapshot.account_id, list);
  }
  const currentMonth = shanghaiMonthKey(now);
  const today = shanghaiDay(now);
  const mappedAccounts: GrowthPortfolioAccount[] = activeAccounts.map((account) => {
    const snapshot = latest.get(account.id);
    // "This month's growth" from a snapshot taken last month is last month's
    // number; showing it as current misreports the portfolio and the goal.
    const isCurrentMonth = Boolean(snapshot && shanghaiMonthKey(snapshot.measured_at) === currentMonth);
    const reportedGrowth = isCurrentMonth ? snapshot?.period_follower_growth ?? null : null;
    // Official syncs (X, Instagram, LinkedIn) report a follower total but no
    // monthly delta, so derive it from this month's first and latest readings.
    const derivedGrowth = isCurrentMonth && reportedGrowth === null
      ? followerGrowthWithin(snapshotsByAccount.get(account.id) ?? [], `${currentMonth}-01`, today)
      : null;
    return {
      id: account.id,
      platform: account.platform,
      displayName: account.display_name,
      handle: account.handle,
      avatarUrl: account.avatar_url,
      followerCount: snapshot?.follower_count ?? null,
      periodFollowerGrowth: reportedGrowth ?? derivedGrowth,
      periodFollowerGrowthSource: reportedGrowth !== null ? "reported" : derivedGrowth !== null ? "derived" : null,
      views: snapshot?.views ?? null,
      leads: snapshot?.leads ?? null,
      measuredAt: snapshot?.measured_at ?? null,
      source: snapshot?.source ?? null
    };
  });

  const followers = sumKnown(mappedAccounts.map((account) => account.followerCount));
  const growth = sumKnown(mappedAccounts.map((account) => account.periodFollowerGrowth));
  const timeSeries = buildFollowerSeries(activeAccounts.map((account) => account.id), activeSnapshots, now);
  const viewsTimeSeries = buildViewsSeries(activeAccounts.map((account) => account.id), activeSnapshots, now);

  let goal: GrowthPortfolioOverview["goal"] = null;
  if (goalRow) {
    const inGoalPeriod = (measuredAt: string | null) => {
      if (!measuredAt) return false;
      const day = shanghaiDay(measuredAt);
      return day >= goalRow.period_start && day <= goalRow.period_end;
    };
    // Follower growth is measured over the goal's own period: the current
    // calendar month reuses 「本月新增」, any other period (a year, a past
    // month) compares the first and latest readings inside that period.
    const isCurrentMonthGoal = goalRow.period_type === "month"
      && goalRow.period_start.slice(0, 7) === currentMonth
      && goalRow.period_end.slice(0, 7) === currentMonth;
    const goalPeriodEnd = goalRow.period_end < today ? goalRow.period_end : today;
    const current = goalRow.metric === "follower_growth"
      ? isCurrentMonthGoal
        ? growth.value
        : sumKnown(activeAccounts.map((account) =>
            followerGrowthWithin(snapshotsByAccount.get(account.id) ?? [], goalRow.period_start, goalPeriodEnd))).value
      : sumKnown(mappedAccounts
          .filter((account) => inGoalPeriod(account.measuredAt))
          .map((account) => goalRow.metric === "views" ? account.views : account.leads)).value;
    goal = {
      id: goalRow.id,
      periodType: goalRow.period_type,
      metric: goalRow.metric,
      targetValue: goalRow.target_value,
      currentValue: current,
      progress: current === null ? null : Math.max(0, Math.min(1, current / goalRow.target_value)),
      periodStart: goalRow.period_start,
      periodEnd: goalRow.period_end
    };
  }

  const growthAccounts = mappedAccounts.filter((account) => account.periodFollowerGrowth !== null);
  const bestGrowthAccount = [...growthAccounts].sort(
    (a, b) => (b.periodFollowerGrowth ?? 0) - (a.periodFollowerGrowth ?? 0)
  )[0];
  const worstGrowthAccount = [...growthAccounts].sort(
    (a, b) => (a.periodFollowerGrowth ?? 0) - (b.periodFollowerGrowth ?? 0)
  )[0];
  const noBaselineAccounts = mappedAccounts.filter(
    (account) => account.periodFollowerGrowth === null && account.followerCount !== null
  );
  const platformZh: Record<string, string> = {
    x: "X",
    xiaohongshu: "小红书",
    linkedin: "LinkedIn",
    instagram: "Instagram",
    wechat: "微信"
  };
  const platformEn: Record<string, string> = {
    x: "X",
    xiaohongshu: "Xiaohongshu",
    linkedin: "LinkedIn",
    instagram: "Instagram",
    wechat: "WeChat"
  };
  const zhName = (account: GrowthPortfolioAccount) => platformZh[account.platform] ?? account.platform;
  const enName = (account: GrowthPortfolioAccount) => platformEn[account.platform] ?? account.platform;
  const signedZh = (value: number) => (value >= 0 ? `+${value}` : `${value}`);
  const signedEn = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

  let insight: GrowthPortfolioOverview["insight"];
  if (!growthAccounts.length && mappedAccounts.length === 0) {
    insight = {
      kind: "needs_data",
      accountId: null,
      messageZh: "补充各账号的本月新增后，我会告诉你增长主要来自哪里。",
      messageEn: "Add this month’s growth for each account and I’ll show you what is driving the result."
    };
  } else if (!growthAccounts.length) {
    // Accounts exist but nobody has reported monthly growth yet — describe
    // the actual base instead of implying a zero.
    insight = {
      kind: "needs_data",
      accountId: null,
      messageZh: `${mappedAccounts.length} 个账号共 ${followers.value?.toLocaleString("en-US") ?? "—"} 粉丝，本月还没有新增数据。手动账号点开卡片补上本月新增，官方账号本月再同步一次就能算出新增，我再告诉你增长主要来自哪里。`,
      messageEn: `${mappedAccounts.length} account(s), ${followers.value?.toLocaleString("en-US") ?? "—"} followers, and no growth data for this month yet. Add monthly growth on manual account cards; official accounts show it after one more sync this month. Then I’ll show you what is driving the result.`
    };
  } else if (bestGrowthAccount && growthAccounts.length === 1 && (bestGrowthAccount.periodFollowerGrowth ?? 0) > 0) {
    // One account is doing all the work. Say so, name the idle ones, and
    // point at the next operating move instead of asking for more data.
    const baselineZh = noBaselineAccounts
      .filter((account) => account.id !== bestGrowthAccount.id)
      .map((account) => `${zhName(account)}还没有增长基线（现 ${account.followerCount} 粉），先别下结论`)
      .join("；");
    const baselineEn = noBaselineAccounts
      .filter((account) => account.id !== bestGrowthAccount.id)
      .map((account) => `${enName(account)} has no growth baseline yet (${account.followerCount} followers)`)
      .join("; ");
    const idleZh = mappedAccounts.length - growthAccounts.length;
    insight = {
      kind: "single_reporter",
      accountId: bestGrowthAccount.id,
      messageZh: `本月 ${signedZh(bestGrowthAccount.periodFollowerGrowth ?? 0)} 全部来自${zhName(bestGrowthAccount)}。${baselineZh ? `${baselineZh}。` : ""}${idleZh > 0 ? `现在就是单账号扛盘，${idleZh > 1 ? "其他账号" : "另一个账号"}把更新节奏跑起来再说。` : ""}`,
      messageEn: `All of this month’s ${signedEn(bestGrowthAccount.periodFollowerGrowth ?? 0)} came from ${enName(bestGrowthAccount)}.${baselineEn ? ` ${baselineEn}.` : ""}${idleZh > 0 ? ` One account is carrying the whole portfolio — get the other${idleZh > 1 ? "s" : ""} posting consistently before reading anything into it.` : ""}`
    };
  } else if (!bestGrowthAccount || (bestGrowthAccount.periodFollowerGrowth ?? 0) <= 0 || (growth.value ?? 0) <= 0) {
    insight = {
      kind: "flat",
      accountId: worstGrowthAccount?.id ?? null,
      messageZh: `本月全网 ${signedZh(growth.value ?? 0)} 粉，还没有形成增长信号。${worstGrowthAccount && (worstGrowthAccount.periodFollowerGrowth ?? 0) < 0 ? `${zhName(worstGrowthAccount)} 掉得最多（${worstGrowthAccount.periodFollowerGrowth}），先复盘它最近三帖的选题和发布时间，再谈加量。` : "先把出帖节奏稳定住，让数据自己长出来。"}`,
      messageEn: `The portfolio moved ${signedEn(growth.value ?? 0)} followers this month — no real signal yet.${worstGrowthAccount && (worstGrowthAccount.periodFollowerGrowth ?? 0) < 0 ? ` ${enName(worstGrowthAccount)} lost the most (${worstGrowthAccount.periodFollowerGrowth}); review its last three posts before adding volume.` : " Stabilize the posting rhythm first and let the numbers grow."}`
    };
  } else {
    const contribution = Math.round(((bestGrowthAccount.periodFollowerGrowth ?? 0) / (growth.value ?? 1)) * 100);
    const laggard = worstGrowthAccount && worstGrowthAccount.id !== bestGrowthAccount.id
      ? (worstGrowthAccount.periodFollowerGrowth ?? 0) < 0
        ? `${zhName(worstGrowthAccount)}掉粉 ${Math.abs(worstGrowthAccount.periodFollowerGrowth ?? 0)}，回查它最近的内容`
        : `${zhName(worstGrowthAccount)}原地踏步`
      : null;
    const laggardEn = worstGrowthAccount && worstGrowthAccount.id !== bestGrowthAccount.id
      ? (worstGrowthAccount.periodFollowerGrowth ?? 0) < 0
        ? `${enName(worstGrowthAccount)} lost ${Math.abs(worstGrowthAccount.periodFollowerGrowth ?? 0)} — check its recent content`
        : `${enName(worstGrowthAccount)} is treading water`
      : null;
    insight = {
      kind: "growth_driver",
      accountId: bestGrowthAccount.id,
      messageZh: `本月增长主要来自${zhName(bestGrowthAccount)}：${signedZh(bestGrowthAccount.periodFollowerGrowth ?? 0)}，约占新增的 ${contribution}%。${laggard ? `${laggard}。` : "全账号都在涨，这个节奏值得保持。"}`,
      messageEn: `${enName(bestGrowthAccount)} drove this month’s growth: ${signedEn(bestGrowthAccount.periodFollowerGrowth ?? 0)} followers, about ${contribution}% of the total.${laggardEn ? ` ${laggardEn}.` : " Every account is up — keep this cadence."}`
    };
  }

  const lastUpdatedAt = mappedAccounts
    .map((account) => account.measuredAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;

  // The one-tap sync button must be reachable before the first official
  // account lands (otherwise it hides itself in a chicken-and-egg loop), so
  // surface it whenever any syncable authorization is connected.
  const syncableConnectors = new Set(["x", "linkedin", "instagram", "wechat"]);
  // A binding only lands in the portfolio after its first successful sync, so
  // surface the gap instead of letting a freshly bound account look missing.
  // Archived bindings count as mirrored: the user removed them on purpose, so
  // they must neither reappear as pending nor trigger an auto-sync.
  const mirroredConnectedIds = new Set(accounts
    .filter((account) => account.status === "active" || account.status === "archived")
    .map((account) => account.connected_account_id)
    .filter(Boolean));
  const pendingConnectedAccounts: GrowthPortfolioPendingAccount[] = connectedAccounts
    .filter((account) => syncableConnectors.has(account.connector_id) && !mirroredConnectedIds.has(account.id))
    .map((account) => ({
      connectedAccountId: account.id,
      platform: account.connector_id as PlatformId,
      displayName: account.display_name || account.handle || account.connector_id,
      handle: account.handle,
      avatarUrl: account.avatar_url
    }));

  return {
    totalFollowers: followers.value,
    monthlyGrowth: growth.value,
    knownFollowerAccounts: followers.known,
    knownGrowthAccounts: growth.known,
    totalAccounts: mappedAccounts.length,
    hasConnectedAuthorizations: connections.some((connection) =>
      syncableConnectors.has(connection.connector_id)
    ),
    pendingConnectedAccounts,
    timeSeries,
    viewsTimeSeries,
    accounts: mappedAccounts,
    goal,
    insight,
    lastUpdatedAt
  };
}
