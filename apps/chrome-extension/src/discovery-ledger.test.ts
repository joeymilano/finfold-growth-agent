import { describe, expect, it } from "vitest";
import type { DiscoveryCandidate, DiscoveryScore } from "./types";
import {
  DISCOVERY_AUTHOR_COOLDOWN_MS, DISCOVERY_DAY_LIMIT, discoveryStats, emptyDiscoveryLedger,
  filterDiscoveryCandidates, markDiscoveryDrafted, markDiscoveryScored, restoreDiscoveryLedger, rollDiscoveryLedger
} from "./discovery-ledger";

const candidate = (id: string, author = "somebody"): DiscoveryCandidate =>
  ({ id, author, text: "Any tool for scheduling client calls?", postedAt: new Date().toISOString(), replyCount: 2 });
const score = (id: string, tier: DiscoveryScore["tier"]): DiscoveryScore =>
  ({ id, tier, audienceType: "potential_customer", worthReplying: 0.9 });

describe("discovery ledger", () => {
  it("drops already-scored posts and cooled-down authors", () => {
    const ledger = emptyDiscoveryLedger();
    markDiscoveryScored(ledger, [score("/a/status/1", "high")]);
    markDiscoveryDrafted(ledger, "busy", Date.now());
    const fresh = filterDiscoveryCandidates(ledger, [
      candidate("/a/status/1"),
      candidate("/a/status/2", "busy"),
      candidate("/b/status/3", "other")
    ]);
    expect(fresh.map((item) => item.id)).toEqual(["/b/status/3"]);
  });

  it("lets an author back in after the cooldown window", () => {
    const ledger = emptyDiscoveryLedger();
    const draftedAt = Date.now() - DISCOVERY_AUTHOR_COOLDOWN_MS - 1;
    markDiscoveryDrafted(ledger, "somebody", draftedAt);
    expect(filterDiscoveryCandidates(ledger, [candidate("/a/status/1")], draftedAt + DISCOVERY_AUTHOR_COOLDOWN_MS + 1)).toHaveLength(1);
  });

  it("stops at the daily cap", () => {
    const ledger = emptyDiscoveryLedger();
    ledger.scoredToday = DISCOVERY_DAY_LIMIT;
    expect(filterDiscoveryCandidates(ledger, [candidate("/a/status/1")])).toHaveLength(0);
  });

  it("rolls the day and prunes week-old entries", () => {
    const now = new Date("2026-10-07T12:00:00");
    const nextDay = new Date("2026-10-08T12:00:00");
    const ledger = emptyDiscoveryLedger(now);
    ledger.scoredToday = 5;
    markDiscoveryScored(ledger, [score("/a/status/1", "high")], now.getTime() - 8 * 24 * 3_600_000);
    markDiscoveryScored(ledger, [score("/b/status/2", "medium")], now.getTime() - 3_600_000);
    const rolled = rollDiscoveryLedger(ledger, nextDay);
    expect(rolled.scoredToday).toBe(0);
    expect(Object.keys(rolled.scored)).toEqual(["/b/status/2"]);
    expect(discoveryStats(rolled, nextDay.getTime())).toEqual({ scoredToday: 0, high: 0, medium: 1 });
  });

  it("discards corrupted persisted shapes instead of crashing", () => {
    expect(restoreDiscoveryLedger(null).scoredToday).toBe(0);
    expect(restoreDiscoveryLedger({ day: "x" }).scoredToday).toBe(0);
    expect(restoreDiscoveryLedger({ day: "2026-10-07", scoredToday: 3, scored: { junk: { tier: "weird" } }, draftedAuthors: { a: "not-a-number" } }).scoredToday).toBe(3);
  });
});
