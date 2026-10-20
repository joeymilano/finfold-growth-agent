import { z } from "zod";
import { toolHandoffSchema } from "@/lib/tool-handoff-attribution";

export const generationAnalyticsSchema = z.object({
  traffic_class: z.enum(["production", "qa", "unknown"]),
  first_task_id: z.string().uuid().optional(),
  tool_slug: toolHandoffSchema.shape.tool_slug.optional(),
  source_origin: toolHandoffSchema.shape.source_origin.optional(),
  tool_draft_id: toolHandoffSchema.shape.tool_draft_id.optional(),
  entry_point: z.enum(["first_task", "workbench", "other"]).default("other")
});
export type GenerationAnalyticsContext = z.infer<typeof generationAnalyticsSchema>;

export function normalizeGenerationAnalytics(value: unknown): GenerationAnalyticsContext {
  const result = generationAnalyticsSchema.safeParse(value);
  return result.success ? result.data : { traffic_class: "unknown", entry_point: "other" };
}
