import { describe, expect, it } from "vitest";
import { getGenerateDisabledReason, insufficientGenerationCredits } from "@/lib/workbench-gating";
import { computeKitCost } from "@/lib/payment/types";

describe("workbench generate gating", () => {
  it("uses the server text cost and allows the exact balance without inventing an unavailable balance", () => {
    const cost = computeKitCost(2);
    expect(insufficientGenerationCredits(cost, 2, "en")).toBeNull();
    expect(insufficientGenerationCredits(cost - 1, 2, "en")).toContain(`${cost - 1} available`);
    expect(insufficientGenerationCredits(0, 2, "zh")).toContain(`需要 ${cost} 点，当前可用 0 点`);
    expect(insufficientGenerationCredits(null, 2, "en")).toBeNull();
    expect(insufficientGenerationCredits(undefined, 2, "en")).toBeNull();
  });
  it("explains when product context is too short", () => {
    expect(getGenerateDisabledReason({
      ideaText: "好想做爱呀",
      selectedPlatformCount: 3,
      isLoading: false,
      authenticated: true,
      trialUsed: false,
      locale: "zh"
    })).toBe("请至少输入 20 个字的产品资产说明，或上传一份源文件；当前 5 个字。");
  });

  it("allows an uploaded source file to replace the text minimum", () => {
    expect(getGenerateDisabledReason({
      ideaText: "",
      sourceAttachmentCount: 1,
      selectedPlatformCount: 2,
      isLoading: false,
      authenticated: true,
      trialUsed: false,
      locale: "zh"
    })).toBeNull();
  });

  it("explains when no platform is selected", () => {
    expect(getGenerateDisabledReason({
      ideaText: "This is a fully described product idea for testing.",
      selectedPlatformCount: 0,
      isLoading: false,
      authenticated: true,
      trialUsed: false,
      locale: "en"
    })).toBe("Select at least 1 platform to generate for.");
  });

  it("explains when guest trial is exhausted", () => {
    expect(getGenerateDisabledReason({
      ideaText: "This is a fully described product idea for testing.",
      selectedPlatformCount: 2,
      isLoading: false,
      authenticated: false,
      trialUsed: true,
      locale: "zh"
    })).toBe("试玩次数已用完，请先登录后继续生成。");
  });

  it("returns null when generation is allowed", () => {
    expect(getGenerateDisabledReason({
      ideaText: "This is a fully described product idea for testing.",
      selectedPlatformCount: 2,
      isLoading: false,
      authenticated: true,
      trialUsed: false,
      locale: "en"
    })).toBeNull();
  });

  it("explains the six-platform operational limit separately from plan upgrades", () => {
    expect(getGenerateDisabledReason({
      ideaText: "This is a fully described product idea for testing.",
      selectedPlatformCount: 7,
      isLoading: false,
      authenticated: true,
      trialUsed: false,
      locale: "zh",
      platformLimit: 14,
      maxPlatformsPerGeneration: 6
    })).toBe("为保证生成速度和稳定性，单次最多选择 6 个平台。");
  });

  it("blocks sources over 12,000 characters with a clear reason", () => {
    const base = {
      selectedPlatformCount: 2,
      isLoading: false,
      authenticated: true,
      trialUsed: false
    };
    expect(getGenerateDisabledReason({ ...base, ideaText: "a".repeat(12_000), locale: "zh" })).toBeNull();
    expect(getGenerateDisabledReason({ ...base, ideaText: "a".repeat(12_050), locale: "zh" }))
      .toBe("源素材最多 12,000 字，还需删减 50 字才能生成。");
    expect(getGenerateDisabledReason({ ...base, ideaText: "a".repeat(12_001), locale: "en" }))
      .toContain("up to 12,000 characters");
  });
});
