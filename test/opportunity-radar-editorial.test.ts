import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadTrendSuggestionCandidates, selectWindowedTrendSuggestions, trendEvidenceMetadata } from "@/lib/trends/service";

describe("editorial candidate recall", () => {
  it("serializes JSONB evidence containment as JSON rather than a PostgreSQL array", async () => {
    const urls: URL[] = [];
    const admin = createClient("https://example.supabase.co", "test-key", {
      auth: { persistSession: false },
      global: { fetch: async (input) => {
        urls.push(new URL(String(input)));
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      } }
    });
    await loadTrendSuggestionCandidates(admin as never, "user-1", "2026-10-15T00:00:00Z");
    const filter = urls.find(url => url.searchParams.has("evidence_snapshot"))!.searchParams.get("evidence_snapshot")!;
    expect(filter.startsWith("cs.")).toBe(true);
    expect(JSON.parse(filter.slice(3))).toEqual([{ contentKind: "industry_post" }]);
    expect(urls.some(url => url.searchParams.get("evidence_snapshot") === 'cs.[{"source":"aihot"}]')).toBe(true);
  });

  it("keeps industry evidence in a candidate pool saturated with popular trends", async () => {
    const popular = Array.from({ length: 80 }, (_, i) => ({ id: `popular-${i}` }));
    const admin = { from: vi.fn(() => {
      let filter = "";
      const query = { select: vi.fn(() => query), or: vi.fn(() => query), gte: vi.fn(() => query),
        order: vi.fn(() => query), contains: vi.fn((_column, value) => { filter = value; return query; }),
        limit: vi.fn(async () => ({ data: filter.includes("aihot") ? [{ id: "curated" }] : filter ? [{ id: "industry" }, popular[0]] : popular, error: null })) };
      return query;
    }) };
    const result = await loadTrendSuggestionCandidates(admin as never, "user-1", "2026-10-15T00:00:00Z");
    expect(result).toHaveLength(82);
    expect(result.some((row) => row.id === "curated")).toBe(true);
    expect(result.some((row) => row.id === "industry")).toBe(true);
  });

  it("carries curated rationale and provenance while rejecting unsafe attribution links", () => {
    expect(trendEvidenceMetadata({ provider: "aihot_public_api", contentKind: "industry_post", reason: "明确的新功能与可核验原文",
      aihotScore: 83, sourceName: "Original publisher", attributionUrl: "https://aihot.news/items/test" }))
      .toMatchObject({ curationReason: "明确的新功能与可核验原文", curationScore: 83,
        originalSource: "Original publisher", attributionUrl: "https://aihot.news/items/test" });
    expect(trendEvidenceMetadata({ provider: "aihot_public_api", attributionUrl: "javascript:alert(1)" }).attributionUrl).toBeUndefined();
    expect(trendEvidenceMetadata({ provider: "other", reason: "Not an editorial review" }).curationReason).toBeUndefined();
  });
});


it("keeps a curated selection visible even when ordinary posts rank above it", () => {
  const ordinary = { id: "ordinary", contentKind: "industry_post", evidence: [{ source: "rss", sourceLabel: "RSS" }] };
  const curated = { id: "curated", contentKind: "industry_post", evidence: [{ source: "aihot", sourceLabel: "AIHOT", curationReason: "可核验的新能力" }] };
  for (const window of ["4h", "24h", "7d"] as const) {
    expect(selectWindowedTrendSuggestions([ordinary, curated] as never, window, 1).map(item => item.id)).toEqual(["curated"]);
  }
});
