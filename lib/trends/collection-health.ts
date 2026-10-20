import type { OpportunityRadarResponse } from "@/lib/trends/types";

/** Partial upstream outages leave the successfully collected results usable. */
export function hasPartialSourceFailure(data: OpportunityRadarResponse): boolean {
  const sources = data.collectionSources?.filter((source) => source.enabled !== false) ?? [];
  return data.collectionStatus === "degraded" && data.collectionFailureStage === "source"
    && sources.some((source) => source.status === "source_failed")
    && sources.some((source) => source.status === "ready" || source.status === "unchanged");
}

export function shouldBootstrapCollection(data: OpportunityRadarResponse): boolean {
  return !hasPartialSourceFailure(data) && (data.collectionStatus === "not_started"
    || data.collectionStatus === "failed" || Boolean(data.collectionFailureStage));
}
