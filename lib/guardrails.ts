import { z } from "zod";
import { industryPackIdSchema, type IndustryPackId } from "@/lib/industry-rules/pack-id";
import type { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const GUARDRAIL_TITLE_MAX = 80;
export const GUARDRAIL_DETAIL_MAX = 500;
export const GUARDRAIL_RULES_MAX = 50;

export const guardrailRuleSchema = z.object({
  /** Stable identity for edit/delete. Optional so rules stored before ids
   * existed (and rules added by the Agent) still parse; the page assigns one
   * on load and persists it with the next save. */
  id: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(80),
  titleEn: z.string().max(80).default(""),
  detail: z.string().min(1).max(500),
  detailEn: z.string().max(500).default(""),
  type: z.enum(["avoid", "required", "tone", "legal"])
});

export type GuardrailRule = z.infer<typeof guardrailRuleSchema>;

export const customGuardrailsSchema = z.array(guardrailRuleSchema).max(GUARDRAIL_RULES_MAX);

/** Gives every rule a unique id, keeping existing ones. Duplicate ids (e.g. a
 * copied rule) are re-issued so deleting one never removes the other. */
export function ensureGuardrailRuleIds(
  rules: GuardrailRule[],
  createId: () => string = () => crypto.randomUUID()
): Array<GuardrailRule & { id: string }> {
  const seen = new Set<string>();
  return rules.map((rule) => {
    let id = rule.id && !seen.has(rule.id) ? rule.id : createId();
    while (seen.has(id)) id = createId();
    seen.add(id);
    return { ...rule, id };
  });
}

export type GuardrailsSyncErrorKind = "validation" | "conflict" | "unauthorized" | "server" | "offline";

export class GuardrailsSyncError extends Error {
  constructor(readonly kind: GuardrailsSyncErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "GuardrailsSyncError";
  }
}

export const guardrailsStateSchema = z.object({
  rules: customGuardrailsSchema.default([]),
  enabledPacks: z.array(industryPackIdSchema).default([])
});

export type GuardrailsState = z.infer<typeof guardrailsStateSchema>;

const STORAGE_KEY = "finfold-custom-guardrails";
const PACKS_STORAGE_KEY = "finfold-enabled-industry-packs";

/** localStorage fallback for unauthenticated/offline use — mirrors the
 * brand-brain pattern, with the server (see app/api/guardrails/route.ts)
 * as the source of truth once the user is signed in. */
export function getStoredCustomGuardrails(): GuardrailRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return customGuardrailsSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function getStoredEnabledPacks(): IndustryPackId[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PACKS_STORAGE_KEY);
    if (!raw) return [];
    return z.array(industryPackIdSchema).parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveStoredCustomGuardrails(rules: GuardrailRule[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
}

export function saveStoredEnabledPacks(packIds: IndustryPackId[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PACKS_STORAGE_KEY, JSON.stringify(packIds));
}

type PersistedGuardrails = {
  rules: GuardrailRule[];
  enabledPacks: IndustryPackId[];
  persisted: boolean;
  /** custom_guardrails.updated_at — sent back on save for optimistic concurrency. */
  updatedAt: string | null;
};

async function fetchGuardrails(init?: RequestInit): Promise<Response> {
  try {
    return await fetch("/api/guardrails", init);
  } catch {
    throw new GuardrailsSyncError("offline", "Network unavailable.");
  }
}

function guardrailsErrorFromResponse(response: Response, data: { error?: string }): GuardrailsSyncError {
  const kind: GuardrailsSyncErrorKind = response.status === 409 ? "conflict" : response.status === 401 ? "unauthorized" : "server";
  return new GuardrailsSyncError(kind, data.error ?? "Custom guardrails are not available.", response.status);
}

export async function loadPersistedCustomGuardrails(): Promise<PersistedGuardrails> {
  const response = await fetchGuardrails({ cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as { rules?: GuardrailRule[]; enabledPacks?: IndustryPackId[]; persisted?: boolean; updatedAt?: string | null; error?: string };
  if (!response.ok) throw guardrailsErrorFromResponse(response, data);
  const rules = customGuardrailsSchema.parse(data.rules ?? []);
  const enabledPacks = z.array(industryPackIdSchema).parse(data.enabledPacks ?? []);
  saveStoredCustomGuardrails(rules);
  saveStoredEnabledPacks(enabledPacks);
  return { rules, enabledPacks, persisted: Boolean(data.persisted), updatedAt: data.updatedAt ?? null };
}

export async function savePersistedCustomGuardrails(
  rules: GuardrailRule[],
  enabledPacks?: IndustryPackId[],
  options: { expectedUpdatedAt?: string | null } = {}
): Promise<PersistedGuardrails> {
  const rulesResult = customGuardrailsSchema.safeParse(rules);
  if (!rulesResult.success) {
    throw new GuardrailsSyncError("validation", rulesResult.error.issues[0]?.message ?? "Invalid rule.");
  }
  const parsedRules = rulesResult.data;
  const parsedPacks = enabledPacks ? z.array(industryPackIdSchema).parse(enabledPacks) : getStoredEnabledPacks();

  const response = await fetchGuardrails({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rules: parsedRules,
      enabledPacks: parsedPacks,
      ...(options.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: options.expectedUpdatedAt } : {})
    })
  });
  const data = (await response.json().catch(() => ({}))) as { rules?: GuardrailRule[]; enabledPacks?: IndustryPackId[]; persisted?: boolean; updatedAt?: string | null; error?: string };
  if (!response.ok) throw guardrailsErrorFromResponse(response, data);

  const savedRules = customGuardrailsSchema.parse(data.rules ?? parsedRules);
  const savedPacks = z.array(industryPackIdSchema).parse(data.enabledPacks ?? parsedPacks);
  saveStoredCustomGuardrails(savedRules);
  saveStoredEnabledPacks(savedPacks);
  return { rules: savedRules, enabledPacks: savedPacks, persisted: Boolean(data.persisted), updatedAt: data.updatedAt ?? null };
}

/** Formats stored rules the same way the workbench sends them to /api/generate. */
export function guardrailRulesToPromptRules(rules: GuardrailRule[]): string[] {
  return rules.map((rule) => `${rule.title}: ${rule.detail}`);
}

/**
 * Server-side read of the user's custom rules and enabled industry packs, for
 * routes that rebuild a prompt without the workbench client (regenerate,
 * refine). Fails open to "no extra rules" so a lookup error never blocks the
 * edit — the same policy as /api/generate's industry-pack lookup.
 */
export async function loadServerGuardrailContext(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  userId: string
): Promise<{ customRules: string[]; industryPackIds: IndustryPackId[] }> {
  try {
    const { data, error } = await admin
      .from("custom_guardrails")
      .select("rules, enabled_packs")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    const rules = customGuardrailsSchema.catch([]).parse(data?.rules ?? []);
    const industryPackIds = z.array(industryPackIdSchema).catch([]).parse(data?.enabled_packs ?? []);
    return { customRules: guardrailRulesToPromptRules(rules), industryPackIds };
  } catch (error) {
    console.error("[guardrails] loadServerGuardrailContext failed:", error);
    return { customRules: [], industryPackIds: [] };
  }
}
