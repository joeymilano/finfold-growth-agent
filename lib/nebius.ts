import type { LLMProvider, LLMTaskPurpose } from "@/lib/llm-providers";

/**
 * Nebius Token Factory / Nebius AI Studio provider, front of the direct-LLM
 * failover chain whenever NEBIUS_API_KEY is set.
 *
 * The NVIDIA Nemotron 3 Super checkpoint (120B hybrid MoE, ~12B active
 * parameters) runs on Nebius Token Factory, so one OpenAI-compatible
 * endpoint serves every tier with interactive latency. Set
 * NEBIUS_API_BASE to the AI Studio endpoint instead if that is where your
 * key lives — the wire protocol is the same.
 */
const NEBIUS_DEFAULT_API_BASE = "https://api.tokenfactory.nebius.com/v1";
const NEBIUS_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";

export function getNebiusProvider(_purpose: LLMTaskPurpose): LLMProvider | null {
  const apiKey = process.env.NEBIUS_API_KEY?.trim();
  if (!apiKey) return null;

  const apiBase = (
    process.env.NEBIUS_API_BASE?.trim() || NEBIUS_DEFAULT_API_BASE
  ).replace(/\/+$/, "");
  // Fail closed on non-HTTPS or malformed bases rather than leaking the key
  // to a typo. Unlike the Zhipu allowlist we accept any Nebius host because
  // Token Factory and AI Studio both serve the same protocol and either may
  // hold the credential.
  let url: URL;
  try {
    url = new URL(apiBase);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    return null;
  }

  const nemotron = process.env.NEBIUS_MODEL?.trim() || NEBIUS_DEFAULT_MODEL;
  const strong =
    process.env.NEBIUS_MODEL_STRONG?.trim()
    || process.env.NEBIUS_MODEL_SONNET?.trim()
    || nemotron;
  const heaviest =
    process.env.NEBIUS_MODEL_OPUS?.trim() || strong;
  const visionModel = process.env.NEBIUS_VISION_MODEL?.trim() || undefined;

  return {
    name: "nebius",
    apiBase,
    apiKey,
    models: { haiku: nemotron, sonnet: strong, opus: heaviest },
    visionModel,
    // Only opt in after live-testing a vision-capable Nemotron checkpoint.
    supportsVideo: false,
    jsonMode: "none",
    // Token Factory credits are prepaid; never let anonymous free-pool
    // extension traffic spend them.
    costClass: "paid",
    failureGroup: "nebius"
  };
}
