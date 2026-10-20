import { describe, expect, it } from "vitest";
import {
  performancePollCutoff,
  performancePollRecencyFilter,
  planPerformancePollBatch
} from "@/lib/performance-poll-queue";

describe("performance poll queue", () => {
  it("polls never-measured and least-recently-measured outputs first, in a bounded batch", () => {
    const rows = [
      { id: "fresh", kit_id: "k1", platform: "reddit" },
      { id: "stale", kit_id: "k2", platform: "reddit" },
      { id: "never", kit_id: "k3", platform: "hacker-news" }
    ];
    const measured = new Map([
      ["k1:reddit", "2026-10-18T10:00:00.000Z"],
      ["k2:reddit", "2026-10-10T10:00:00.000Z"]
    ]);
    expect(planPerformancePollBatch(rows, measured).map((row) => row.id)).toEqual(["never", "stale", "fresh"]);
    expect(planPerformancePollBatch(rows, measured, 2).map((row) => row.id)).toEqual(["never", "stale"]);
  });

  it("limits the sweep to recently published outputs", () => {
    const cutoff = performancePollCutoff(new Date("2026-10-18T00:00:00.000Z"));
    expect(cutoff).toBe("2026-09-18T00:00:00.000Z");
    expect(performancePollRecencyFilter(cutoff)).toBe(
      "published_at.gte.2026-09-18T00:00:00.000Z,and(published_at.is.null,updated_at.gte.2026-09-18T00:00:00.000Z)"
    );
  });
});
