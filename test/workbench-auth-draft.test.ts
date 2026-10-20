import { beforeEach, describe, expect, it } from "vitest";
import { pendingWorkbenchAuthDraftHref, readWorkbenchAuthDraft, saveWorkbenchAuthDraft, workbenchAuthDraftHref, WORKBENCH_AUTH_DRAFT_KEY, type WorkbenchAuthDraft } from "@/lib/workbench-auth-draft";

const draft: WorkbenchAuthDraft = {
  id: "73d5a01b-57f0-4568-b558-f3db7013155c", savedAt: 1000, locale: "en",
  ideaText: "My real product update survives a complete authentication redirect.",
  goal: "lead-gen", persona: "ai-saas", platforms: ["linkedin"], visualMode: "none",
  visualSource: null, mediaAssets: [], sourceAttachments: [], growthMissionId: null,
  researchMissionId: null, xhsWorkflowId: null, artifactVersionIds: []
};
beforeEach(() => {
  const values = new Map<string,string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string,value:string) => values.set(key,value)
  } });
});
describe("explicit workbench authentication handoff", () => {
  it("keeps the incoming draft while the canvas is loading, then permits saving edits after restore", () => {
    const incoming = { ...draft, savedAt: Date.now() };
    saveWorkbenchAuthDraft(incoming);
    const returnTo = workbenchAuthDraftHref(incoming.id);
    expect(pendingWorkbenchAuthDraftHref(returnTo, null)).toBe(returnTo);
    expect(readWorkbenchAuthDraft(incoming.id)?.ideaText).toBe(incoming.ideaText);
    expect(pendingWorkbenchAuthDraftHref(returnTo, incoming.id)).toBeNull();
    expect(pendingWorkbenchAuthDraftHref("/workbench", null)).toBeNull();
    expect(pendingWorkbenchAuthDraftHref(workbenchAuthDraftHref(crypto.randomUUID()), null)).toBeNull();
  });
  it("round trips source, locale and selections while keeping text out of the return URL", () => {
    expect(saveWorkbenchAuthDraft(draft)).toBe(true);
    expect(readWorkbenchAuthDraft(draft.id, 1001)).toEqual(draft);
    expect(workbenchAuthDraftHref(draft.id)).not.toContain("product");
    expect(new URL(workbenchAuthDraftHref(draft.id), "https://www.finfold.app").searchParams.get("authDraft")).toBe(draft.id);
  });
  it("does not restore a different, expired, future-dated or corrupted draft", () => {
    saveWorkbenchAuthDraft(draft);
    expect(readWorkbenchAuthDraft(null,1001)).toBeNull();
    expect(readWorkbenchAuthDraft(crypto.randomUUID(),1001)).toBeNull();
    expect(readWorkbenchAuthDraft(draft.id,0)).toBeNull();
    expect(readWorkbenchAuthDraft(draft.id,1001+7*86400000)).toBeNull();
    window.localStorage.setItem(WORKBENCH_AUTH_DRAFT_KEY, "broken");
    expect(readWorkbenchAuthDraft(draft.id,1001)).toBeNull();
  });
  it("fails closed for unavailable storage and temporary images that cannot survive navigation", () => {
    expect(saveWorkbenchAuthDraft({...draft,mediaAssets:[{id:"image",name:"photo",type:"image",size:1,url:"blob:temporary"}]})).toBe(false);
    window.localStorage.setItem = () => { throw new Error("quota"); };
    expect(saveWorkbenchAuthDraft(draft)).toBe(false);
  });
});
