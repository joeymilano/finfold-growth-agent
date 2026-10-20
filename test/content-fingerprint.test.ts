import { describe, expect, it } from "vitest";
import { contentInputKey } from "@/lib/content-fingerprint";

const base = {
  ideaText: "A detailed source note for one content experiment.",
  goal: "lead-gen",
  persona: "ai-saas",
  platforms: ["xiaohongshu", "linkedin"]
};

describe("content input fingerprint", () => {
  it("keeps platform ordering stable but separates approved Research contexts", () => {
    expect(contentInputKey(base)).toBe(contentInputKey({
      ...base,
      platforms: [...base.platforms].reverse()
    }));
    expect(contentInputKey(base)).not.toBe(contentInputKey({
      ...base,
      researchMissionId: "1f34c0d0-3124-4ca7-b352-da298139cb74"
    }));
  });

  it("separates different media uploads and visual handling but keeps legacy defaults stable", () => {
    const legacyKey = contentInputKey(base);
    expect(contentInputKey({ ...base, visualMode: "source_first", mediaAssetIds: [] })).toBe(legacyKey);
    expect(contentInputKey({ ...base, mediaAssetIds: ["media-a"] })).not.toBe(legacyKey);
    expect(contentInputKey({ ...base, mediaAssetIds: ["media-a"] })).not.toBe(contentInputKey({ ...base, mediaAssetIds: ["media-b"] }));
    expect(contentInputKey({ ...base, mediaAssetIds: ["a", "b"] })).toBe(contentInputKey({ ...base, mediaAssetIds: ["b", "a"] }));
    expect(contentInputKey({ ...base, visualMode: "ai_generate" })).not.toBe(legacyKey);
    expect(contentInputKey({ ...base, visualMode: "none" })).not.toBe(contentInputKey({ ...base, visualMode: "ai_generate" }));
    expect(contentInputKey({ ...base, visualSourceId: "source-1" })).not.toBe(contentInputKey({ ...base, visualSourceId: "source-2" }));
  });
});
