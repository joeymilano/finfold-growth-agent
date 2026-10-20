import { z } from "zod";
import type { BrandBrain } from "@/lib/brand-brain";
import { mapBrandBrainFromRow, type BrandBrainRow } from "@/lib/brand-brain-persistence";

const versionRowSchema = z.object({
  id: z.string().uuid(),
  snapshot: z.unknown(),
  created_at: z.string().datetime({ offset: true })
});

export type BrandMemoryVersion = {
  id: string;
  brain: BrandBrain;
  createdAt: string;
};

export function mapBrandMemoryVersion(value: unknown): BrandMemoryVersion {
  const row = versionRowSchema.parse(value);
  return {
    id: row.id,
    brain: mapBrandBrainFromRow(snapshotRow(row.snapshot)),
    createdAt: row.created_at
  };
}

/** Converts a database-row snapshot into the same durable BrandBrain shape
 * every reader already uses. Unknown historic fields are intentionally ignored. */
function snapshotRow(value: unknown): BrandBrainRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as BrandBrainRow
    : {};
}

export function summarizeBrandMemoryVersion(brain: BrandBrain, emptyLabel = "Empty Brand Memory"): string {
  const parts = [brain.brandName, brain.positioningStatement, brain.targetAudience]
    .map((value) => value.trim())
    .filter(Boolean);
  return parts.join(" · ").slice(0, 180) || emptyLabel;
}

export function parseBrandMemoryVersionSnapshot(value: unknown): BrandBrain {
  return mapBrandBrainFromRow(snapshotRow(value));
}
/** Restoring a version brings back only what the user authored. Memory the
 * system learned (edit habits, avoided patterns, adopted performance rules,
 * approved examples, published-visual preferences) stays as it is now, so an
 * old snapshot cannot resurrect rules the user explicitly asked to forget. */
export function buildRestoredBrandBrain(snapshot: BrandBrain, current: BrandBrain): BrandBrain {
  return {
    ...snapshot,
    approvedExamples: current.approvedExamples,
    learnedStyle: current.learnedStyle,
    learnedNegative: current.learnedNegative,
    performanceRules: current.performanceRules,
    visualIdentity: {
      ...snapshot.visualIdentity,
      learnedPreferences: current.visualIdentity.learnedPreferences
    }
  };
}
