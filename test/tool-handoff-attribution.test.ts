import { beforeEach, describe, expect, it } from "vitest";
import { currentToolAttribution, persistCurrentToolAttribution, readWorkbenchAuthDraft, saveWorkbenchAuthDraft, type WorkbenchAuthDraft } from "@/lib/workbench-auth-draft";
import { normalizeGenerationAnalytics } from "@/lib/generation-analytics-context";
import { rememberToolKit, sourceOrigin, toolKitAttribution } from "@/lib/tool-handoff-attribution";

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
});
describe("tool to authenticated generation and result attribution", () => {
  it("retains an opaque original tool draft ID through auth, durable analytics, and later result use", () => {
    const id = crypto.randomUUID();
    const attribution = { tool_slug: "linkedin-post-generator" as const, source_origin: "sample" as const, tool_draft_id: id };
    const draft: WorkbenchAuthDraft = { id, savedAt: Date.now(), locale: "en", ideaText: "Private source remains only in the draft", goal: "lead-gen", persona: "ai-saas", platforms: ["linkedin"], visualMode: "none", visualSource: null, mediaAssets: [], sourceAttachments: [], growthMissionId: null, researchMissionId: null, xhsWorkflowId: null, artifactVersionIds: [], toolAttribution: attribution };
    saveWorkbenchAuthDraft(draft);
    window.history.replaceState({}, "", `/workbench?authDraft=${id}`);
    const edited = persistCurrentToolAttribution("An edited source for this generation");
    expect(edited).toEqual({ ...attribution, source_origin: "edited_sample" });
    expect(readWorkbenchAuthDraft(id)?.toolAttribution).toEqual(edited);
    const newId = crypto.randomUUID();
    saveWorkbenchAuthDraft({ ...draft, id: newId, toolAttribution: edited });
    window.history.replaceState({}, "", `/workbench?authDraft=${newId}`);
    expect(currentToolAttribution()).toEqual(edited);
    const analytics = normalizeGenerationAnalytics({ traffic_class: "production", entry_point: "workbench", ...edited, ideaText: draft.ideaText });
    expect(analytics).toMatchObject(edited!);
    expect(JSON.stringify(analytics)).not.toContain(draft.ideaText);
    const kitId = crypto.randomUUID();
    rememberToolKit(kitId, edited!);
    window.history.replaceState({}, "", `/kits/${kitId}`);
    expect(currentToolAttribution()).toBeUndefined();
    expect(toolKitAttribution(kitId)).toEqual(edited);
    expect(toolKitAttribution(crypto.randomUUID())).toBeUndefined();
    window.history.replaceState({}, "", "/workbench");
    expect(currentToolAttribution()).toBeUndefined();
  });
  it("distinguishes untouched, edited, and original material", () => {
    expect(sourceOrigin("same", "same", false)).toBe("sample");
    expect(sourceOrigin("edited", "same", true)).toBe("edited_sample");
    expect(sourceOrigin("own update", "same", false)).toBe("user");
  });
  it("expires kit attribution and fails harmlessly when storage is unavailable", () => {
    const kitId = crypto.randomUUID();
    window.localStorage.setItem("finfold-tool-kit-attribution-v1", JSON.stringify([{ kitId, savedAt: Date.now() - 8 * 86400000, attribution: { tool_slug: "linkedin-post-generator", source_origin: "user", tool_draft_id: crypto.randomUUID() } }]));
    expect(toolKitAttribution(kitId)).toBeUndefined();
    window.localStorage.setItem = () => { throw new Error("unavailable"); };
    expect(() => rememberToolKit(kitId, { tool_slug: "linkedin-post-generator", source_origin: "user", tool_draft_id: crypto.randomUUID() })).not.toThrow();
  });
});
