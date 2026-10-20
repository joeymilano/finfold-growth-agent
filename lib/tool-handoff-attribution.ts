import { z } from "zod";

export const toolHandoffSchema = z.object({
  tool_slug: z.enum(["xiaohongshu-generator", "wechat-article-generator", "linkedin-post-generator", "twitter-thread-generator", "reddit-post-generator", "product-hunt-launch-copy"]),
  source_origin: z.enum(["user", "sample", "edited_sample"]),
  tool_draft_id: z.string().uuid()
});
export type ToolHandoffAttribution = z.infer<typeof toolHandoffSchema>;

/** Distinguish untouched examples from user material without sending the text. */
export function sourceOrigin(text: string, sample: string, usedSample: boolean): ToolHandoffAttribution["source_origin"] {
  return text.trim() === sample.trim() ? "sample" : usedSample ? "edited_sample" : "user";
}

const KIT_KEY = "finfold-tool-kit-attribution-v1";
const entrySchema = z.object({ kitId: z.string().uuid(), savedAt: z.number(), attribution: toolHandoffSchema });
function entries() {
  try {
    const result = z.array(entrySchema).safeParse(JSON.parse(window.localStorage.getItem(KIT_KEY) ?? "[]"));
    return result.success ? result.data.filter(item => item.savedAt <= Date.now() && Date.now() - item.savedAt < 7 * 86400000) : [];
  } catch { return []; }
}
export function rememberToolKit(kitId: string, attribution: ToolHandoffAttribution) {
  try {
    const entry = entrySchema.parse({ kitId, attribution, savedAt: Date.now() });
    window.localStorage.setItem(KIT_KEY, JSON.stringify([...entries().filter(item => item.kitId !== kitId), entry].slice(-20)));
  } catch { /* Analytics must never block the result. */ }
}
export function toolKitAttribution(kitId: string): ToolHandoffAttribution | undefined {
  return entries().find(item => item.kitId === kitId)?.attribution;
}
