import { z } from "zod";
import { goalIdSchema, personaIdSchema, platformIdSchema, mediaAssetSchema, sourceAttachmentSchema } from "@/lib/content-schema";
import { sourceImageAssetSchema } from "@/lib/source-image";
import { MAX_PLATFORMS_PER_GENERATION } from "@/lib/platforms";
import { toolHandoffSchema } from "@/lib/tool-handoff-attribution";

export const WORKBENCH_AUTH_DRAFT_KEY = "finfold-workbench-auth-draft-v1";
export const WORKBENCH_AUTH_RETURN_EVENT = "finfold-workbench-auth-return";
export type WorkbenchAuthReturnRequest = { returnTo: string; failed: boolean };

/** Let a sibling login entry preserve the mounted Studio before navigating. */
export function requestWorkbenchAuthReturnTo(returnTo: string): string | null {
  const detail: WorkbenchAuthReturnRequest = { returnTo, failed: false };
  window.dispatchEvent(new CustomEvent(WORKBENCH_AUTH_RETURN_EVENT, { detail }));
  return detail.failed ? null : detail.returnTo;
}
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const schema = z.object({
  id: z.string().uuid(), savedAt: z.number().finite(), locale: z.enum(["zh", "en"]),
  toolAttribution: toolHandoffSchema.optional(),
  ideaText: z.string().max(12_000), goal: goalIdSchema, persona: personaIdSchema,
  platforms: z.array(platformIdSchema).min(1).max(MAX_PLATFORMS_PER_GENERATION),
  visualMode: z.enum(["source_first", "none", "ai_generate"]),
  visualSource: sourceImageAssetSchema.nullable(),
  mediaAssets: z.array(mediaAssetSchema).refine(items => items.every(item => !item.url?.startsWith("blob:"))),
  sourceAttachments: z.array(sourceAttachmentSchema).max(6),
  growthMissionId: z.string().uuid().nullable(), researchMissionId: z.string().uuid().nullable(),
  xhsWorkflowId: z.string().uuid().nullable(), artifactVersionIds: z.array(z.string().uuid()).max(12)
});
export type WorkbenchAuthDraft = z.infer<typeof schema>;

export function saveWorkbenchAuthDraft(draft: WorkbenchAuthDraft): boolean {
  try {
    window.localStorage.setItem(WORKBENCH_AUTH_DRAFT_KEY, JSON.stringify(schema.parse(draft)));
    return true;
  } catch { return false; }
}

export function readWorkbenchAuthDraft(id: string | null, now = Date.now()): WorkbenchAuthDraft | null {
  if (!id) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(window.localStorage.getItem(WORKBENCH_AUTH_DRAFT_KEY) ?? "null"));
    if (!parsed.success || parsed.data.id !== id || now < parsed.data.savedAt || now - parsed.data.savedAt > MAX_AGE) return null;
    return parsed.data;
  } catch { return null; }
}

/** Only the opaque identifier crosses the auth boundary, never source text. */
export function workbenchAuthDraftHref(id: string) {
  return `/workbench?authDraft=${encodeURIComponent(id)}`;
}

export function currentToolAttribution(sourceText?: string) {
  if (typeof window === "undefined" || window.location.pathname !== "/workbench") return undefined;
  const draft = readWorkbenchAuthDraft(new URLSearchParams(window.location.search).get("authDraft"));
  const attribution = draft?.toolAttribution;
  if (!attribution) return undefined;
  return { ...attribution, source_origin: attribution.source_origin === "sample" && sourceText !== undefined && sourceText.trim() !== draft?.ideaText.trim() ? "edited_sample" as const : attribution.source_origin };
}

/** Freeze sample-vs-edited status at the explicit generation boundary. */
export function persistCurrentToolAttribution(sourceText: string) {
  const attribution = currentToolAttribution(sourceText);
  if (!attribution) return undefined;
  const draft = readWorkbenchAuthDraft(new URLSearchParams(window.location.search).get("authDraft"));
  if (draft) saveWorkbenchAuthDraft({ ...draft, toolAttribution: attribution });
  return attribution;
}

/** An auth click during initial canvas loading must keep the incoming draft. */
export function pendingWorkbenchAuthDraftHref(returnTo: string, restoredDraftId: string | null): string | null {
  const id = new URL(returnTo, "https://finfold.internal").searchParams.get("authDraft");
  if (!id || id === restoredDraftId) return null;
  const saved = readWorkbenchAuthDraft(id);
  return saved ? workbenchAuthDraftHref(saved.id) : null;
}
