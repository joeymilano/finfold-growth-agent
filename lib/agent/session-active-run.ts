import type { createSupabaseAdminClient } from "@/lib/supabase";
import { logWarn } from "@/lib/observability";

/**
 * Server-side "a run is in progress" marker on agent_sessions
 * (migration 128). The in-tab registry (lib/agent/active-runs) only covers
 * the tab that started the run; this marker lets another tab or device see
 * the run too, and lets the chat route refuse a second concurrent run on the
 * same session instead of charging for two.
 *
 * A run that dies without clearing its marker (worker evicted mid-stream)
 * would otherwise block the session forever, so a marker older than
 * AGENT_ACTIVE_RUN_STALE_MS is ignored. Live runs refresh their marker every
 * AGENT_ACTIVE_RUN_HEARTBEAT_MS, so a long run never looks stale.
 */
export const AGENT_ACTIVE_RUN_STALE_MS = 15 * 60_000;
export const AGENT_ACTIVE_RUN_HEARTBEAT_MS = 2 * 60_000;

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type PostgrestErrorLike = { code?: string; message?: string } | null | undefined;

export type AgentSessionActiveRun = { id: string; startedAt: string };

export type ClaimAgentSessionRunResult =
  /** This run now owns the session marker. */
  | "claimed"
  /** Another fresh run owns the marker. */
  | "busy"
  /** No session with this id belongs to the user. */
  | "missing"
  /** The marker could not be written (column not migrated yet, transient
   *  error). The run proceeds without one, exactly as before the marker. */
  | "skipped";

/** 42703: undefined column (Postgres). PGRST204: column not in the schema cache. */
export function isMissingActiveRunColumn(error: PostgrestErrorLike): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? "";
  return error.code === "42703"
    || error.code === "PGRST204"
    || (message.includes("active_run") && message.includes("column"));
}

export function isFreshAgentActiveRun(
  startedAt: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!startedAt) return false;
  const started = Date.parse(startedAt);
  return Number.isFinite(started) && nowMs - started < AGENT_ACTIVE_RUN_STALE_MS;
}

/** The fresh marker on a session row, or null when there is none. */
export function freshAgentActiveRun(
  row: { active_run_id?: unknown; active_run_started_at?: unknown } | null | undefined,
  nowMs: number = Date.now()
): AgentSessionActiveRun | null {
  const id = typeof row?.active_run_id === "string" ? row.active_run_id : null;
  const startedAt = typeof row?.active_run_started_at === "string" ? row.active_run_started_at : null;
  if (!id || !isFreshAgentActiveRun(startedAt, nowMs)) return null;
  return { id, startedAt: startedAt! };
}

function warn(event: string, error: PostgrestErrorLike, sessionId: string) {
  logWarn(event, undefined, {
    sessionId,
    missingColumn: isMissingActiveRunColumn(error),
    errorCode: error?.code ?? "unknown",
    errorMessage: (error?.message ?? "").slice(0, 300)
  });
}

/**
 * Atomically takes the session marker for `runId`: one conditional UPDATE
 * that only matches when no fresh run holds it.
 */
export async function claimAgentSessionRun(
  admin: AdminClient,
  input: { sessionId: string; userId: string; runId: string; nowMs?: number }
): Promise<ClaimAgentSessionRunResult> {
  const nowMs = input.nowMs ?? Date.now();
  const staleBefore = new Date(nowMs - AGENT_ACTIVE_RUN_STALE_MS).toISOString();
  try {
    const { data, error } = await admin
      .from("agent_sessions")
      .update({ active_run_id: input.runId, active_run_started_at: new Date(nowMs).toISOString() })
      .eq("id", input.sessionId)
      .eq("user_id", input.userId)
      .or(`active_run_id.is.null,active_run_started_at.is.null,active_run_started_at.lt.${staleBefore}`)
      .select("id");
    if (error) {
      warn("agent_session_run_claim_failed", error, input.sessionId);
      return "skipped";
    }
    if (Array.isArray(data) && data.length > 0) return "claimed";

    // Nothing matched: either another fresh run holds the marker, or the
    // session is not this user's.
    const { data: session, error: readError } = await admin
      .from("agent_sessions")
      .select("id, active_run_id, active_run_started_at")
      .eq("id", input.sessionId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (readError) {
      warn("agent_session_run_claim_failed", readError, input.sessionId);
      return "skipped";
    }
    if (!session) return "missing";
    // The holder finished between the two reads: the run may proceed
    // without a marker rather than fail.
    return freshAgentActiveRun(session as Record<string, unknown>, nowMs) ? "busy" : "skipped";
  } catch (error) {
    warn("agent_session_run_claim_failed", { message: error instanceof Error ? error.message : String(error) }, input.sessionId);
    return "skipped";
  }
}

/** Keeps a long run's marker fresh. Only touches the caller's own marker. */
export async function refreshAgentSessionRun(
  admin: AdminClient,
  input: { sessionId: string; runId: string }
): Promise<void> {
  try {
    const { error } = await admin
      .from("agent_sessions")
      .update({ active_run_started_at: new Date().toISOString() })
      .eq("id", input.sessionId)
      .eq("active_run_id", input.runId);
    if (error) warn("agent_session_run_refresh_failed", error, input.sessionId);
  } catch (error) {
    warn("agent_session_run_refresh_failed", { message: error instanceof Error ? error.message : String(error) }, input.sessionId);
  }
}

/**
 * Compare-and-clear: removes the marker only while it still names `runId`,
 * so a run that ends late never wipes a newer run's marker.
 */
export async function releaseAgentSessionRun(
  admin: AdminClient,
  input: { sessionId: string; runId: string }
): Promise<void> {
  try {
    const { error } = await admin
      .from("agent_sessions")
      .update({ active_run_id: null, active_run_started_at: null })
      .eq("id", input.sessionId)
      .eq("active_run_id", input.runId);
    if (error) warn("agent_session_run_release_failed", error, input.sessionId);
  } catch (error) {
    warn("agent_session_run_release_failed", { message: error instanceof Error ? error.message : String(error) }, input.sessionId);
  }
}
