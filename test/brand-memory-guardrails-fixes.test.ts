import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeApprovedExample, mergeApprovedExamples } from "@/lib/output-feedback";
import { sameRowVersion } from "@/lib/brand-brain-persistence";
import { buildRestoredBrandBrain } from "@/lib/brand-memory-versions";
import { BrandExtractionOutputError, parseExtractedBrandFields } from "@/lib/brand-extraction";
import { ensureGuardrailRuleIds, GuardrailsSyncError, loadServerGuardrailContext, savePersistedCustomGuardrails } from "@/lib/guardrails";
import { brandBrainSchema, BrandMemorySyncError, findInvalidBrandBrainField, savePersistedBrandBrain } from "@/lib/brand-brain";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("approved example ordering", () => {
  it("keeps newest last and only the five most recent examples", () => {
    const existing = ["a", "b", "c", "d", "e"];
    expect(mergeApprovedExample(existing, "f")).toEqual(["b", "c", "d", "e", "f"]);
    expect(mergeApprovedExamples(existing, ["B"])).toEqual(["a", "c", "d", "e", "B"]);
    expect(mergeApprovedExamples(["a"], ["b", "c"], 2)).toEqual(["b", "c"]);
    expect(mergeApprovedExamples(["a"], undefined)).toEqual(["a"]);
  });
});

describe("optimistic concurrency version check", () => {
  it("matches identical instants written with different offsets and rejects stale ones", () => {
    expect(sameRowVersion("2026-10-18T10:00:00.123+00:00", "2026-10-18T10:00:00.123Z")).toBe(true);
    expect(sameRowVersion("2026-10-18T10:00:01Z", "2026-10-18T10:00:00Z")).toBe(false);
    expect(sameRowVersion(null, null)).toBe(true);
    expect(sameRowVersion("2026-10-18T10:00:00Z", null)).toBe(false);
    expect(sameRowVersion(null, "2026-10-18T10:00:00Z")).toBe(false);
  });
});

describe("restoring a Brand Memory version", () => {
  it("restores user-authored fields but keeps what the system currently remembers", () => {
    const snapshot = brandBrainSchema.parse({
      brandName: "Old name",
      toneKeywords: ["old"],
      approvedExamples: ["forgotten example"],
      learnedStyle: ["forgotten rule"],
      learnedNegative: ["forgotten anti-pattern"],
      visualIdentity: { styleKeywords: ["editorial"] }
    });
    const current = brandBrainSchema.parse({
      brandName: "New name",
      approvedExamples: ["kept example"],
      learnedStyle: [],
      performanceRules: ["adopted"],
      visualIdentity: {
        learnedPreferences: [{ platform: "xiaohongshu", theme: "signal", sampleSize: 8, liftPercent: 30, updatedAt: "2026-10-01" }]
      }
    });
    const restored = buildRestoredBrandBrain(snapshot, current);
    expect(restored.brandName).toBe("Old name");
    expect(restored.toneKeywords).toEqual(["old"]);
    expect(restored.visualIdentity.styleKeywords).toEqual(["editorial"]);
    expect(restored.approvedExamples).toEqual(["kept example"]);
    expect(restored.learnedStyle).toEqual([]);
    expect(restored.learnedNegative).toEqual([]);
    expect(restored.performanceRules).toEqual(["adopted"]);
    expect(restored.visualIdentity.learnedPreferences).toHaveLength(1);
  });
});

describe("URL bootstrap model output", () => {
  it("trims over-long fields to the schema limits instead of failing", () => {
    const fields = parseExtractedBrandFields("```json\n" + JSON.stringify({
      brandName: "x".repeat(80),
      productDescription: "y".repeat(900),
      toneKeywords: Array.from({ length: 14 }, (_, i) => `tone-${i}-${"z".repeat(30)}`),
      positioningStatement: 42
    }) + "\n```");
    expect(fields.brandName).toHaveLength(60);
    expect(fields.productDescription).toHaveLength(500);
    expect(fields.toneKeywords).toHaveLength(10);
    expect(fields.toneKeywords.every((tone) => tone.length <= 20)).toBe(true);
    expect(fields.positioningStatement).toBe("");
  });

  it("accepts JSON wrapped in prose and rejects non-JSON output with a typed error", () => {
    expect(parseExtractedBrandFields('Here you go: {"brandName":"Finfold"} hope it helps').brandName).toBe("Finfold");
    expect(() => parseExtractedBrandFields("Sorry, I cannot read that page.")).toThrow(BrandExtractionOutputError);
    expect(() => parseExtractedBrandFields("[1,2]")).toThrow(BrandExtractionOutputError);
  });
});

describe("guardrail rule ids", () => {
  it("keeps stored ids, fills missing ones, and re-issues duplicates", () => {
    let n = 0;
    const createId = () => `gen-${++n}`;
    const rules = ensureGuardrailRuleIds([
      { id: "a", title: "Same", titleEn: "", detail: "one", detailEn: "", type: "avoid" },
      { id: "a", title: "Same", titleEn: "", detail: "two", detailEn: "", type: "avoid" },
      { title: "Legacy", titleEn: "", detail: "three", detailEn: "", type: "tone" }
    ], createId);
    expect(rules.map((rule) => rule.id)).toEqual(["a", "gen-1", "gen-2"]);
  });

  it("injects stored custom rules and enabled packs for server-side prompts", async () => {
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                rules: [{ id: "r1", title: "No hype", detail: "Avoid superlatives", type: "avoid" }],
                enabled_packs: ["medical", "not-a-pack"]
              },
              error: null
            })
          })
        })
      })
    };
    const context = await loadServerGuardrailContext(admin as never, "user-1");
    expect(context.customRules).toEqual(["No hype: Avoid superlatives"]);
    expect(context.industryPackIds).toEqual([]);

    const failing = { from: () => { throw new Error("db down"); } };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await loadServerGuardrailContext(failing as never, "user-1")).toEqual({ customRules: [], industryPackIds: [] });
  });
});

describe("Brand Memory save errors", () => {
  it("reports the invalid field before any request is sent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const brain = brandBrainSchema.parse({});
    const tooMany = { ...brain, toneKeywords: Array.from({ length: 11 }, (_, i) => `t${i}`) };
    expect(findInvalidBrandBrainField(tooMany)).toBe("toneKeywords");
    await expect(savePersistedBrandBrain(tooMany)).rejects.toMatchObject({ kind: "validation", field: "toneKeywords" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the loaded version and maps 409 / offline to distinct kinds", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "内容已在别处更新，请刷新后再保存" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const brain = brandBrainSchema.parse({ brandName: "Finfold" });
    const error = await savePersistedBrandBrain(brain, { expectedUpdatedAt: "2026-10-18T10:00:00Z" }).catch((caught) => caught);
    expect(error).toBeInstanceOf(BrandMemorySyncError);
    expect(error.kind).toBe("conflict");
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.expectedUpdatedAt).toBe("2026-10-18T10:00:00Z");

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(savePersistedBrandBrain(brain)).rejects.toMatchObject({ kind: "offline" });
  });

  it("rejects over-limit guardrail rules locally and maps guardrail conflicts", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "conflict" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(savePersistedCustomGuardrails([{ title: "x".repeat(81), titleEn: "", detail: "d", detailEn: "", type: "avoid" }], []))
      .rejects.toMatchObject({ kind: "validation" });
    expect(fetchMock).not.toHaveBeenCalled();
    const error = await savePersistedCustomGuardrails([], [], { expectedUpdatedAt: null }).catch((caught) => caught);
    expect(error).toBeInstanceOf(GuardrailsSyncError);
    expect(error.kind).toBe("conflict");
  });
});
