import { z } from "zod";

/** Fields the URL bootstrap asks the model for. Limits mirror brandBrainSchema. */
export const extractedBrandFieldsSchema = z.object({
  brandName: z.string().max(60).default(""),
  productDescription: z.string().max(500).default(""),
  targetAudience: z.string().max(300).default(""),
  toneKeywords: z.array(z.string().max(20)).max(10).default([]),
  positioningStatement: z.string().max(300).default("")
});

export type ExtractedBrandFields = z.infer<typeof extractedBrandFieldsSchema>;

/** Signals that the model reply could not be turned into Brand Memory fields
 * (not JSON, not an object). Distinct from a bad request URL. */
export class BrandExtractionOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandExtractionOutputError";
  }
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Parses and normalizes raw model output. A model that writes a long
 * description or eleven tone words should still yield a usable draft, so
 * fields are trimmed to the schema limits instead of failing the request.
 */
export function parseExtractedBrandFields(raw: string): ExtractedBrandFields {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    // Some models wrap the JSON object in prose; fall back to the first {...} block.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new BrandExtractionOutputError("Model output is not JSON.");
    try {
      value = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new BrandExtractionOutputError("Model output is not JSON.");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BrandExtractionOutputError("Model output is not an object.");
  }

  const record = value as Record<string, unknown>;
  const toneKeywords = Array.isArray(record.toneKeywords)
    ? [...new Set(record.toneKeywords.map((item) => text(item, 20)).filter(Boolean))].slice(0, 10)
    : [];

  const parsed = extractedBrandFieldsSchema.safeParse({
    brandName: text(record.brandName, 60),
    productDescription: text(record.productDescription, 500),
    targetAudience: text(record.targetAudience, 300),
    toneKeywords,
    positioningStatement: text(record.positioningStatement, 300)
  });
  if (!parsed.success) throw new BrandExtractionOutputError("Model output failed validation.");
  return parsed.data;
}
