import { describe, expect, it } from "vitest";
import { fillLast14Days } from "@/components/lead-tools/LeadToolWorkspace";

describe("lead tool 14-day chart", () => {
  it("zero-fills missing days on the Beijing-time calendar", () => {
    const days = fillLast14Days(
      [{ day: "2026-10-15", opens: 3, completions: 1, ctaClicks: 0 }],
      new Date("2026-10-17T18:00:00.000Z") // 2026-10-18 02:00 in Beijing
    );
    expect(days).toHaveLength(14);
    expect(days[0].day).toBe("2026-10-05");
    expect(days[13]).toEqual({ day: "2026-10-18", opens: 0, completions: 0, ctaClicks: 0 });
    expect(days.find((item) => item.day === "2026-10-15")?.opens).toBe(3);
  });
});
