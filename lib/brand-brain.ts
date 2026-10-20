import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Brand Memory schema                                               */
/* ------------------------------------------------------------------ */

export const identityTypeSchema = z.enum(["personal", "brand", "hybrid"]);
export const socialPlatformSchema = z.enum([
  "xiaohongshu",
  "zhihu",
  "douyin",
  "wechat",
  "weibo",
  "bilibili",
  "linkedin",
  "x",
  "instagram",
  "youtube",
  "other"
]);
export const socialProfileSchema = z.object({
  id: z.string().max(100),
  platform: socialPlatformSchema,
  url: z.string().url(),
  handle: z.string().max(80).default(""),
  importedAt: z.string().optional()
});

const hexColorSchema = z.string().regex(/^$|^#[0-9a-f]{6}$/i, "Use a six-digit hex color.");
export const visualIdentitySchema = z.object({
  preferredTheme: z.enum(["auto", "editorial", "signal", "field-notes"]).default("auto"),
  styleKeywords: z.array(z.string().max(32)).max(8).default([]),
  avoidStyles: z.array(z.string().max(40)).max(8).default([]),
  palette: z.object({
    primary: hexColorSchema.default(""),
    accent: hexColorSchema.default(""),
    background: hexColorSchema.default("")
  }).default({ primary: "", accent: "", background: "" }),
  referenceImageUrls: z.array(z.string().url()).max(4).default([]),
  learnedPreferences: z.array(z.object({
    platform: z.string().max(40),
    theme: z.enum(["editorial", "signal", "field-notes"]),
    sampleSize: z.number().int().min(4).max(10000),
    liftPercent: z.number().int().min(25).max(10000),
    updatedAt: z.string()
  })).max(14).default([])
});
export type VisualIdentity = z.infer<typeof visualIdentitySchema>;

export const platformMemorySchema = z.object({
  id: z.string().min(1).max(100),
  platform: z.enum(["xiaohongshu", "wechat", "x"]),
  kind: z.enum(["fact", "preference", "inference"]),
  value: z.string().min(1).max(200),
  source: z.enum(["manual", "performance", "agent"]),
  confidence: z.enum(["high", "medium", "low"]),
  createdAt: z.string().datetime()
});
export type PlatformMemory = z.infer<typeof platformMemorySchema>;

export const brandBrainSchema = z.object({
  /** Whose identity this memory represents. Internal field names stay stable
   * so existing prompts, agents, and database rows remain backward compatible. */
  identityType: identityTypeSchema.default("personal"),
  brandName: z.string().max(60).default(""),
  productDescription: z.string().max(500).default(""),
  targetAudience: z.string().max(300).default(""),
  toneKeywords: z.array(z.string().max(20)).max(10).default([]),
  bannedPhrases: z.array(z.string().max(40)).max(20).default([]),
  approvedExamples: z.array(z.string().max(500)).max(5).default([]),
  competitors: z.array(z.string().max(40)).max(10).default([]),
  positioningStatement: z.string().max(300).default(""),
  /** Optional website this memory was auto-extracted from, if any. */
  sourceUrl: z.string().url().optional().or(z.literal("")),
  /** Optional public social profiles. These are reference sources, not OAuth
   * bindings, so users can remove them without affecting their accounts. */
  socialProfiles: z.array(socialProfileSchema).max(8).default([]),
  /** Optional visual system shared by cover, carousel, and article-image
   * planners. `auto` keeps onboarding zero-config for existing users. */
  visualIdentity: visualIdentitySchema.default({}),
  /** Explicit platform differences. Lower-confidence Agent suggestions require
   * separate user confirmation before becoming persistent memory. */
  platformMemory: z.array(platformMemorySchema).max(12).default([]),
  autoExtracted: z.boolean().default(false),
  enrichedAt: z.string().optional(),
  /** Persistent style rules distilled from the user's own edits over time
   * (migration 019, Growth+ feature — see plan §4 "编辑回路"). Capped at 10
   * by the distillation code in lib/style-learning.ts, not by this schema. */
  learnedStyle: z.array(z.string().max(200)).max(10).default([]),
  /** LLM-distilled "avoid this" rules mined from this user's own
   * underperforming posts (migration 025, lib/negative-learning.ts).
   * Capped at 5 by mergeNegativeRules, not by this schema. */
  learnedNegative: z.array(z.string().max(200)).max(5).default([]),
  /** Iteration-report nextActions the user explicitly adopted (migration
   * 025, app/api/iterate/adopt/route.ts). Capped at 5 by mergeLearnedStyle,
   * not by this schema. */
  performanceRules: z.array(z.string().max(200)).max(5).default([]),
});

export type BrandBrain = z.infer<typeof brandBrainSchema>;

const STORAGE_KEY = "finfold-brand-brain";

/* ------------------------------------------------------------------ */
/*  localStorage CRUD                                                 */
/* ------------------------------------------------------------------ */

export function getBrandBrain(): BrandBrain {
  if (typeof window === "undefined") return brandBrainSchema.parse({});
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return brandBrainSchema.parse(JSON.parse(raw));
  } catch {
    /* corrupted storage — fall through */
  }
  return brandBrainSchema.parse({});
}

export function saveBrandBrain(brain: BrandBrain): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(brain));
  } catch {
    /* storage unavailable (private mode / quota) — the account copy still applies */
  }
}

/** Why a Brand Memory load/save did not reach the account. The page maps each
 * kind to its own message instead of claiming every failure was "saved locally". */
export type BrandMemorySyncErrorKind = "validation" | "conflict" | "unauthorized" | "server" | "offline";

export class BrandMemorySyncError extends Error {
  constructor(
    readonly kind: BrandMemorySyncErrorKind,
    message: string,
    /** First invalid top-level field for `validation` errors. */
    readonly field?: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "BrandMemorySyncError";
  }
}

export type PersistedBrandBrain = {
  brain: BrandBrain;
  persisted: boolean;
  /** Server row version (brand_brains.updated_at). Sent back on save so a
   * stale page cannot overwrite memory learned or edited elsewhere. */
  updatedAt: string | null;
};

/** Returns the first top-level field that fails the schema, or null. */
export function findInvalidBrandBrainField(brain: unknown): string | null {
  const result = brandBrainSchema.safeParse(brain);
  if (result.success) return null;
  return String(result.error.issues[0]?.path[0] ?? "brain");
}

async function fetchBrandBrain(init?: RequestInit): Promise<Response> {
  try {
    return await fetch("/api/brand-brain", init);
  } catch {
    throw new BrandMemorySyncError("offline", "Network unavailable.");
  }
}

function errorFromResponse(response: Response, data: { error?: string }): BrandMemorySyncError {
  const kind: BrandMemorySyncErrorKind = response.status === 409
    ? "conflict"
    : response.status === 401
      ? "unauthorized"
      : "server";
  return new BrandMemorySyncError(kind, data.error ?? "Brand Memory is not available.", undefined, response.status);
}

export async function loadPersistedBrandBrain(): Promise<PersistedBrandBrain> {
  const response = await fetchBrandBrain({ cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as { brain?: BrandBrain; persisted?: boolean; updatedAt?: string | null; error?: string };
  if (!response.ok) throw errorFromResponse(response, data);
  const brain = brandBrainSchema.parse(data.brain ?? {});
  saveBrandBrain(brain);
  return { brain, persisted: Boolean(data.persisted), updatedAt: data.updatedAt ?? null };
}

export async function savePersistedBrandBrain(
  brain: BrandBrain,
  options: { expectedUpdatedAt?: string | null } = {}
): Promise<PersistedBrandBrain> {
  const result = brandBrainSchema.safeParse(brain);
  if (!result.success) {
    const field = String(result.error.issues[0]?.path[0] ?? "brain");
    throw new BrandMemorySyncError("validation", result.error.issues[0]?.message ?? "Invalid Brand Memory.", field);
  }
  const parsed = result.data;

  let response: Response;
  try {
    response = await fetchBrandBrain({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        options.expectedUpdatedAt !== undefined ? { ...parsed, expectedUpdatedAt: options.expectedUpdatedAt } : parsed
      )
    });
  } catch (error) {
    // Offline: keep a local draft so the edits survive a reload, but the
    // caller tells the user it has NOT reached their account.
    saveBrandBrain(parsed);
    throw error;
  }
  const data = (await response.json().catch(() => ({}))) as { brain?: BrandBrain; persisted?: boolean; updatedAt?: string | null; error?: string };
  if (!response.ok) throw errorFromResponse(response, data);

  const saved = brandBrainSchema.parse(data.brain ?? parsed);
  saveBrandBrain(saved);
  return { brain: saved, persisted: Boolean(data.persisted), updatedAt: data.updatedAt ?? null };
}

/** Fields written only by the system (edit distillation, performance
 * adoption, published-visual learning). Used to merge server responses into
 * a form without disturbing the user's unsaved edits. */
export function withoutLearnedBrandFields(brain: BrandBrain): Omit<BrandBrain, "learnedStyle" | "learnedNegative" | "performanceRules"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { learnedStyle, learnedNegative, performanceRules, ...rest } = brain;
  return { ...rest, visualIdentity: { ...rest.visualIdentity, learnedPreferences: [] } };
}

/* ------------------------------------------------------------------ */
/*  Completeness score                                                */
/* ------------------------------------------------------------------ */

export function getBrainCompleteness(brain: BrandBrain): number {
  const fields = [
    brain.brandName,
    brain.productDescription,
    brain.targetAudience,
    brain.positioningStatement,
    brain.toneKeywords.length > 0 ? "filled" : "",
    brain.bannedPhrases.length > 0 ? "filled" : "",
  ];
  const filled = fields.filter((f) => f.trim().length > 0).length;
  return Math.round((filled / fields.length) * 100);
}

/* ------------------------------------------------------------------ */
/*  Prompt injection helper                                           */
/* ------------------------------------------------------------------ */

export function buildBrainPromptSection(brain: BrandBrain, targetPlatforms?: readonly string[]): string {
  const applicablePlatformMemory = targetPlatforms
    ? brain.platformMemory.filter((item) => targetPlatforms.includes(item.platform))
    : brain.platformMemory;
  if (!brain.brandName && !brain.productDescription && applicablePlatformMemory.length === 0) return "";

  const sections: string[] = [];

  const identityLabel = brain.identityType === "personal"
    ? "Personal creator / expert"
    : brain.identityType === "hybrid"
      ? "Founder-led brand / personal IP hybrid"
      : "Brand / product";
  sections.push(`Identity Type: ${identityLabel}`);

  if (brain.brandName) sections.push(`${brain.identityType === "personal" ? "Creator / IP Name" : "Brand / Identity Name"}: ${brain.brandName}`);
  if (brain.productDescription) sections.push(`${brain.identityType === "personal" ? "Expertise and Value" : "Offering / Product"}: ${brain.productDescription}`);
  if (brain.targetAudience) sections.push(`People this identity wants to reach: ${brain.targetAudience}`);
  if (brain.positioningStatement) sections.push(`Positioning: ${brain.positioningStatement}`);
  if (brain.toneKeywords.length) sections.push(`Tone Keywords: ${brain.toneKeywords.join(", ")}`);
  if (brain.bannedPhrases.length) sections.push(`User Banned Phrases: ${brain.bannedPhrases.join(", ")}`);
  if (brain.competitors.length) sections.push(`Competitors (differentiate from): ${brain.competitors.join(", ")}`);
  if (brain.socialProfiles.length) {
    sections.push(`Public social profiles (reference context only): ${brain.socialProfiles.map((profile) => `${profile.platform}: ${profile.url}`).join(", ")}`);
  }

  if (brain.approvedExamples.length > 0) {
    sections.push(
      `Approved Style Examples:\n${brain.approvedExamples.map((e, i) => `[${i + 1}]: ${e.slice(0, 300)}`).join("\n")}`,
    );
  }

  if (brain.learnedStyle.length > 0) {
    sections.push(
      `Learned Style Rules (distilled from this user's own edits — follow these as strongly as explicit instructions):\n${brain.learnedStyle.map((rule) => `- ${rule}`).join("\n")}`,
    );
  }

  if (brain.learnedNegative.length > 0) {
    sections.push(
      `Anti-patterns (distilled from this user's own posts that underperformed — actively avoid these):\n${brain.learnedNegative.map((rule) => `- ${rule}`).join("\n")}`,
    );
  }

  if (brain.performanceRules.length > 0) {
    sections.push(
      `Performance Rules (adopted by the user from data-driven iteration reports — follow strictly):\n${brain.performanceRules.map((rule) => `- ${rule}`).join("\n")}`,
    );
  }

  if (applicablePlatformMemory.length > 0) {
    sections.push(
      `Platform-specific memory (apply each rule ONLY to its named platform):\n${applicablePlatformMemory
        .map((item) => `- ${item.platform} [${item.kind}; ${item.confidence} confidence]: ${item.value}`)
        .join("\n")}`
    );
  }

  return `
=== IDENTITY MEMORY (brand or personal IP — apply consistently in every output) ===
${sections.join("\n")}
`;
}

export function buildVisualIdentityPrompt(brain: Pick<BrandBrain, "brandName" | "toneKeywords" | "visualIdentity">): string {
  const visual = brain.visualIdentity;
  const sections: string[] = [];
  if (brain.brandName) sections.push(`Brand identity: ${brain.brandName}`);
  if (visual.styleKeywords.length) sections.push(`Visual style: ${visual.styleKeywords.join(", ")}`);
  else if (brain.toneKeywords.length) sections.push(`Translate this voice into visuals: ${brain.toneKeywords.join(", ")}`);
  if (visual.avoidStyles.length) sections.push(`Avoid visual styles: ${visual.avoidStyles.join(", ")}`);
  const palette = Object.entries(visual.palette).filter(([, value]) => value).map(([role, value]) => `${role} ${value}`);
  if (palette.length) sections.push(`Brand palette: ${palette.join(", ")}`);
  if (visual.preferredTheme !== "auto") sections.push(`Preferred design system: ${visual.preferredTheme}`);
  return sections.join(". ");
}
