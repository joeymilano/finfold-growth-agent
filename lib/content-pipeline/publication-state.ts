/**
 * A daily-pipeline article is marked draft_sent as soon as its WeChat
 * publication job is created, but the job itself finishes later in the
 * background. What the console shows (and whether 「重试」 is allowed) is
 * derived from that job's status, not from draft_sent alone.
 */
export type DraftPublicationPhase = "pending" | "done" | "failed" | "attention";

const DONE_STATUSES = new Set(["draft_ready", "submitted", "publishing", "published"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "blocked", "removed"]);
// Terminal failures with no active job left: a fresh draft job may be created.
const RETRYABLE_STATUSES = new Set(["failed", "cancelled", "blocked"]);

export function draftPublicationPhase(status: string | null | undefined): DraftPublicationPhase {
  if (!status) return "pending";
  if (DONE_STATUSES.has(status)) return "done";
  if (FAILED_STATUSES.has(status)) return "failed";
  if (status === "attention_required" || status === "needs_reapproval") return "attention";
  return "pending";
}

export function canRetryDraftPublication(status: string | null | undefined): boolean {
  return Boolean(status && RETRYABLE_STATUSES.has(status));
}
