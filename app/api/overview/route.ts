import { NextResponse } from "next/server";
import { apiError } from "@/lib/i18n";
import {
  buildGrowthPortfolioOverview,
  type ConnectedSocialAccountRow,
  type GrowthPortfolioGoalRow,
  type ManagedSocialAccountRow,
  type SocialAccountSnapshotRow
} from "@/lib/growth-portfolio";
import { isLocalMockMode, persistenceUnavailableMessage } from "@/lib/runtime-mode";
import { createSupabaseAdminClient, getCurrentUserId } from "@/lib/supabase";
import { buildLocalGrowthPortfolioDesignPreview } from "@/lib/growth-portfolio-preview";
import { logError } from "@/lib/observability";

const SNAPSHOT_COLUMNS = "id,account_id,follower_count,period_follower_growth,views,leads,source,measured_at";
const LATEST_SNAPSHOT_LIMIT = 2000;
const BASELINE_SNAPSHOT_LIMIT = 1000;

/** First day of the current China-time month, as an ISO date. */
function shanghaiMonthStart(now: Date): string {
  return `${new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7)}-01`;
}

function isMissingOverviewSchema(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && ["42P01", "PGRST205"].includes(String((error as { code: unknown }).code));
}

export async function GET(request: Request) {
  try {
    const userId = await getCurrentUserId();
    const admin = createSupabaseAdminClient();
    if (!admin) {
      if (isLocalMockMode()) {
        return NextResponse.json({
          overview: process.env.GROWTH_PORTFOLIO_DESIGN_PREVIEW === "true"
            ? buildLocalGrowthPortfolioDesignPreview()
            : buildGrowthPortfolioOverview([], [], null),
          persisted: false
        });
      }
      return NextResponse.json(
        { error: persistenceUnavailableMessage("Growth overview") },
        { status: 503 }
      );
    }

    const [accountsResult, snapshotsResult, goalResult, connectionsResult] = await Promise.all([
      admin
        .from("managed_social_accounts")
        .select("id,platform,display_name,handle,avatar_url,connected_account_id,status,created_at,updated_at")
        .eq("user_id", userId)
        // Archived rows are needed so archived bindings are not offered again
        // as "pending"; the overview itself only shows active accounts.
        .in("status", ["active", "archived"])
        .order("created_at", { ascending: true }),
      // Newest first: the overview needs each account's latest reading, and
      // an ascending capped read would freeze on the oldest rows.
      admin
        .from("social_account_snapshots")
        .select(SNAPSHOT_COLUMNS)
        .eq("user_id", userId)
        .order("measured_at", { ascending: false })
        .limit(LATEST_SNAPSHOT_LIMIT),
      admin
        .from("growth_portfolio_goals")
        .select("id,period_type,period_start,period_end,metric,target_value,status")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("social_connections")
        .select("id,connector_id")
        .eq("user_id", userId)
        .eq("status", "connected")
    ]);

    const error = accountsResult.error ?? snapshotsResult.error ?? goalResult.error ?? connectionsResult.error;
    if (error) {
      if (isMissingOverviewSchema(error)) {
        logError("growth_overview_schema_missing", { userId }, { code: String((error as { code?: unknown }).code ?? "") });
        return NextResponse.json(
          { error: apiError(request.headers, "增长总览暂时不可用，请稍后再试。", "Growth overview is temporarily unavailable. Please try again later.") },
          { status: 503 }
        );
      }
      throw error;
    }

    const now = new Date();
    const accountRows = (accountsResult.data ?? []) as ManagedSocialAccountRow[];
    const goalRow = (goalResult.data ?? null) as GrowthPortfolioGoalRow | null;
    const snapshotsById = new Map<string, SocialAccountSnapshotRow>();
    for (const row of (snapshotsResult.data ?? []) as SocialAccountSnapshotRow[]) snapshotsById.set(row.id, row);

    // Period baselines (this month, and the goal period) need the earliest
    // readings inside the period, which the newest-first page may not reach.
    const monthStart = shanghaiMonthStart(now);
    const baselineStart = goalRow && goalRow.period_start < monthStart ? goalRow.period_start : monthStart;
    const { data: baselineRows, error: baselineError } = await admin
      .from("social_account_snapshots")
      .select(SNAPSHOT_COLUMNS)
      .eq("user_id", userId)
      .gte("measured_at", new Date(`${baselineStart}T00:00:00+08:00`).toISOString())
      .order("measured_at", { ascending: true })
      .limit(BASELINE_SNAPSHOT_LIMIT);
    if (baselineError) throw baselineError;
    for (const row of (baselineRows ?? []) as SocialAccountSnapshotRow[]) snapshotsById.set(row.id, row);

    // An account that has not been updated for a long time can fall outside
    // the newest-first page; fetch its latest reading directly.
    const accountsWithSnapshots = new Set([...snapshotsById.values()].map((row) => row.account_id));
    const staleAccountIds = accountRows
      .filter((account) => account.status === "active" && !accountsWithSnapshots.has(account.id))
      .map((account) => account.id);
    if (staleAccountIds.length > 0 && (snapshotsResult.data ?? []).length >= LATEST_SNAPSHOT_LIMIT) {
      const staleResults = await Promise.all(staleAccountIds.map((accountId) => admin
        .from("social_account_snapshots")
        .select(SNAPSHOT_COLUMNS)
        .eq("user_id", userId)
        .eq("account_id", accountId)
        .order("measured_at", { ascending: false })
        .limit(1)));
      for (const result of staleResults) {
        if (result.error) throw result.error;
        for (const row of (result.data ?? []) as SocialAccountSnapshotRow[]) snapshotsById.set(row.id, row);
      }
    }

    const connections = (connectionsResult.data ?? []) as Array<{ id: string; connector_id: string }>;
    const connectorByConnection = new Map(connections.map((connection) => [connection.id, connection.connector_id]));
    let connectedAccounts: ConnectedSocialAccountRow[] = [];
    if (connections.length > 0) {
      const { data: connectionAccounts, error: connectionAccountsError } = await admin
        .from("social_connection_accounts")
        .select("id,connection_id,display_name,handle,avatar_url")
        .in("connection_id", connections.map((connection) => connection.id));
      if (connectionAccountsError) throw connectionAccountsError;
      connectedAccounts = ((connectionAccounts ?? []) as Array<{ id: string; connection_id: string; display_name: string | null; handle: string | null; avatar_url: string | null }>)
        .map((account) => ({
          id: account.id,
          connector_id: connectorByConnection.get(account.connection_id) ?? "",
          display_name: account.display_name,
          handle: account.handle,
          avatar_url: account.avatar_url
        }));
    }

    const overview = buildGrowthPortfolioOverview(
      accountRows,
      [...snapshotsById.values()],
      goalRow,
      now,
      connections,
      connectedAccounts
    );
    return NextResponse.json({ overview, persisted: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: apiError(request.headers, "登录后才能查看增长总览。", "Please log in to load your growth overview.") }, { status: 401 });
    }
    logError("growth_overview_failed", {}, { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: apiError(request.headers, "暂时无法加载增长总览，请稍后再试。", "Failed to load the growth overview. Please try again later.") },
      { status: 400 }
    );
  }
}
