/**
 * Work planning for the unattended performance poller (POST
 * /api/performance/poll). The poller runs serially inside a Worker request
 * capped at 60 seconds, so it only looks at recently published outputs and
 * takes a bounded batch, least-recently-measured first, so every output gets
 * its turn instead of the same head of the table every run.
 */
export const PERFORMANCE_POLL_WINDOW_DAYS = 30;
export const PERFORMANCE_POLL_BATCH_SIZE = 40;
/** Stop starting new polls after this long; leaves headroom under the 60s Worker timeout. */
export const PERFORMANCE_POLL_TIME_BUDGET_MS = 40_000;

export function performancePollCutoff(now = new Date()): string {
  return new Date(now.getTime() - PERFORMANCE_POLL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** PostgREST filter: published inside the window (falls back to updated_at for rows without published_at). */
export function performancePollRecencyFilter(cutoff: string): string {
  return `published_at.gte.${cutoff},and(published_at.is.null,updated_at.gte.${cutoff})`;
}

export function planPerformancePollBatch<T extends { kit_id: string; platform: string }>(
  rows: T[],
  lastMeasuredAt: Map<string, string>,
  batchSize = PERFORMANCE_POLL_BATCH_SIZE
): T[] {
  const measuredTime = (row: T) => {
    const value = lastMeasuredAt.get(`${row.kit_id}:${row.platform}`);
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  return [...rows].sort((a, b) => measuredTime(a) - measuredTime(b)).slice(0, batchSize);
}
