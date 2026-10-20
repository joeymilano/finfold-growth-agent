import type { DiscoveryCandidate, DiscoveryScore } from "./types";

// Browse-discovery bookkeeping, same plain-data discipline as autopilot.ts so
// the whole policy (dedupe, author cooldown, daily cap) is unit-testable
// without a browser. The panel owns one DiscoveryLedger, persists it in
// chrome.storage.local, and consults it before scoring a candidate batch.

export type DiscoveryTier = DiscoveryScore["tier"];
export type DiscoveryLedger = {
  // Local calendar day (YYYY-MM-DD); counters reset when it rolls over.
  day: string;
  // Posts sent to scoring today — the local cap sits under the server's
  // hourly batch limit, so the server never sees an unbounded scroll.
  scoredToday: number;
  // Permalink → { tier, at }: never score the same post twice.
  scored: Record<string, { tier: DiscoveryTier; at: number }>;
  // Author handle → last draft request time: after drafting for an author,
  // leave their other posts alone for the cooldown window.
  draftedAuthors: Record<string, number>;
};

export const DISCOVERY_DAY_LIMIT = 60;
export const DISCOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const DISCOVERY_AUTHOR_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;
export const DISCOVERY_LEDGER_KEY = "finfoldDiscoveryLedger";
export const DISCOVERY_SWITCH_KEY = "finfoldDiscovery";

export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function emptyDiscoveryLedger(now = new Date()): DiscoveryLedger {
  return { day: localDay(now), scoredToday: 0, scored: {}, draftedAuthors: {} };
}

export function rollDiscoveryLedger(ledger: DiscoveryLedger, now = new Date()): DiscoveryLedger {
  const day = localDay(now);
  if (ledger.day === day) return ledger;
  const cutoff = now.getTime() - DISCOVERY_TTL_MS;
  const scored: DiscoveryLedger["scored"] = {};
  for (const [id, entry] of Object.entries(ledger.scored)) if (entry.at >= cutoff) scored[id] = entry;
  const draftedAuthors: DiscoveryLedger["draftedAuthors"] = {};
  for (const [author, at] of Object.entries(ledger.draftedAuthors)) if (at >= cutoff) draftedAuthors[author] = at;
  return { day, scoredToday: 0, scored, draftedAuthors };
}

/** Restores a persisted ledger, discarding corrupted shapes instead of crashing. */
export function restoreDiscoveryLedger(value: unknown, now = new Date()): DiscoveryLedger {
  if (!value || typeof value !== "object") return emptyDiscoveryLedger(now);
  const raw = value as Partial<DiscoveryLedger>;
  if (typeof raw.day !== "string" || typeof raw.scoredToday !== "number") return emptyDiscoveryLedger(now);
  const tiers = new Set(["high", "medium", "low"]);
  const scored = raw.scored && typeof raw.scored === "object"
    ? Object.fromEntries(Object.entries(raw.scored).filter(([, entry]) =>
      entry && typeof entry === "object" && typeof (entry as { at?: unknown }).at === "number"
      && tiers.has((entry as { tier?: unknown }).tier as string)))
    : {};
  const draftedAuthors = raw.draftedAuthors && typeof raw.draftedAuthors === "object"
    ? Object.fromEntries(Object.entries(raw.draftedAuthors).filter(([, at]) => typeof at === "number"))
    : {};
  return rollDiscoveryLedger({ day: raw.day, scoredToday: raw.scoredToday, scored, draftedAuthors }, now);
}

/** Drops already-scored posts, cooled-down authors, and the overflow past the daily cap. */
export function filterDiscoveryCandidates(ledger: DiscoveryLedger, candidates: DiscoveryCandidate[], now = Date.now()): DiscoveryCandidate[] {
  const fresh: DiscoveryCandidate[] = [];
  for (const candidate of candidates) {
    if (ledger.scored[candidate.id]) continue;
    const lastDraftAt = ledger.draftedAuthors[candidate.author];
    if (lastDraftAt !== undefined && now - lastDraftAt < DISCOVERY_AUTHOR_COOLDOWN_MS) continue;
    if (ledger.scoredToday + fresh.length >= DISCOVERY_DAY_LIMIT) break;
    fresh.push(candidate);
  }
  return fresh;
}

export function markDiscoveryScored(ledger: DiscoveryLedger, scores: DiscoveryScore[], now = Date.now()): void {
  for (const score of scores) {
    ledger.scored[score.id] = { tier: score.tier, at: now };
    ledger.scoredToday += 1;
  }
}

export function markDiscoveryDrafted(ledger: DiscoveryLedger, author: string, now = Date.now()): void {
  if (author) ledger.draftedAuthors[author] = now;
}

/** Today's panel status line: how many scored, how many landed at each tier. */
export function discoveryStats(ledger: DiscoveryLedger, now = Date.now()): { scoredToday: number; high: number; medium: number } {
  let high = 0;
  let medium = 0;
  for (const entry of Object.values(ledger.scored)) {
    if (now - entry.at >= DISCOVERY_TTL_MS) continue;
    if (entry.tier === "high") high += 1;
    else if (entry.tier === "medium") medium += 1;
  }
  return { scoredToday: ledger.scoredToday, high, medium };
}
