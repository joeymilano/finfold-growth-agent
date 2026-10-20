// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNebiusProvider } from "@/lib/nebius";
import { filterProvidersForPolicy, resolveLLMProviders } from "@/lib/llm-providers";

beforeEach(() => {
  vi.stubEnv("NEBIUS_API_KEY", "synthetic-nebius-key");
  vi.stubEnv("NEBIUS_API_BASE", "");
  vi.stubEnv("NEBIUS_MODEL", "");
  vi.stubEnv("NEBIUS_MODEL_STRONG", "");
  vi.stubEnv("NEBIUS_MODEL_OPUS", "");
  vi.stubEnv("NEBIUS_VISION_MODEL", "");
  vi.stubEnv("LLM_PROVIDERS", JSON.stringify([{ name: "backup", base: "https://backup.example/v1", keyEnv: "TEST_BACKUP_KEY", models: { haiku: "backup-model" } }]));
  vi.stubEnv("TEST_BACKUP_KEY", "synthetic-backup-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("Nebius front-of-chain routing", () => {
  it("fronts the chain with NVIDIA Nemotron on Token Factory when the key exists", () => {
    const providers = resolveLLMProviders();
    expect(providers.map(p => p.name)).toEqual(["nebius", "backup"]);
    expect(providers[0].apiBase).toBe("https://api.tokenfactory.nebius.com/v1");
    expect(providers[0].models.haiku).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(providers[0].models.opus).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(providers[0].jsonMode).toBe("none");
  });

  it("keeps the chain untouched without a credential", () => {
    vi.stubEnv("NEBIUS_API_KEY", "");
    expect(resolveLLMProviders().map(p => p.name)).toEqual(["backup"]);
    expect(getNebiusProvider("general")).toBeNull();
  });

  it("accepts an AI Studio base and per-tier model overrides", () => {
    vi.stubEnv("NEBIUS_API_BASE", "https://api.studio.nebius.com/v1/");
    vi.stubEnv("NEBIUS_MODEL", "nvidia/nemotron-3-nano-30b-a3b");
    vi.stubEnv("NEBIUS_MODEL_OPUS", "nvidia/nemotron-3-super-120b-a12b");
    const provider = getNebiusProvider("general");
    expect(provider?.apiBase).toBe("https://api.studio.nebius.com/v1");
    expect(provider?.models.haiku).toBe("nvidia/nemotron-3-nano-30b-a3b");
    expect(provider?.models.opus).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it.each([
    "http://api.tokenfactory.nebius.com/v1",
    "not a url",
    "https://user:pass@api.tokenfactory.nebius.com/v1",
    "https://api.tokenfactory.nebius.com/v1?x=1"
  ])("fails closed on a malformed base (%s)", base => {
    vi.stubEnv("NEBIUS_API_BASE", base);
    expect(getNebiusProvider("general")).toBeNull();
    expect(resolveLLMProviders().map(p => p.name)).toEqual(["backup"]);
  });

  it("is paid-tier so anonymous free-only extension traffic can never spend Token Factory credits", () => {
    const providers = resolveLLMProviders();
    expect(filterProvidersForPolicy(providers, "free_only").map(p => p.name)).toEqual([]);
    expect(filterProvidersForPolicy(providers, "all").map(p => p.name)).toEqual(["nebius", "backup"]);
  });
});
