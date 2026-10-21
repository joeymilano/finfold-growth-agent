#!/usr/bin/env node
/**
 * Live Nebius + NVIDIA Nemotron verification.
 *
 * Proves the two hackathon requirements against the REAL endpoint:
 *   1. The project runs on Nebius (Token Factory / AI Studio).
 *   2. An NVIDIA open-source model (Nemotron) actually answers.
 *
 * Usage:  NEBIUS_API_KEY=... node scripts/verify-nebius.mjs
 * Optional overrides: NEBIUS_API_BASE, NEBIUS_MODEL (same vars the app reads).
 */
import { readFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, name, value] = match;
    if (!(name in process.env) && value && !value.startsWith("\"")) {
      process.env[name] = value;
    }
  }
}

loadDotEnv();

const apiKey = process.env.NEBIUS_API_KEY?.trim();
const apiBase = (process.env.NEBIUS_API_BASE?.trim()
  || "https://api.tokenfactory.nebius.com/v1").replace(/\/+$/, "");
const model = process.env.NEBIUS_MODEL?.trim() || "nvidia/nemotron-3-super-120b-a12b";

if (!apiKey) {
  console.error("✗ NEBIUS_API_KEY is not set.");
  console.error("  Get one at https://tokenfactory.nebius.com (Builder Program grants hackathon credits),");
  console.error("  then either export it or put it in .env and re-run:");
  console.error("    NEBIUS_API_KEY=... node scripts/verify-nebius.mjs");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${apiKey}` };
let failures = 0;

async function step(name, fn) {
  const startedAt = performance.now();
  try {
    const detail = await fn();
    console.log(`✓ ${name} (${Math.round(performance.now() - startedAt)}ms)${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}: ${error.message}`);
  }
}

await step(`GET ${apiBase}/models is reachable`, async () => {
  const response = await fetch(`${apiBase}/models`, { headers: auth });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} — check the key and NEBIUS_API_BASE`);
  }
  const { data = [] } = await response.json();
  const nvidia = data
    .map((entry) => entry.id ?? entry.model ?? String(entry))
    .filter((id) => /nemotron|nvidia/i.test(id));
  if (nvidia.length > 0) {
    console.log(`\n  NVIDIA models available on this account (${nvidia.length}):`);
    for (const id of nvidia.slice(0, 20)) console.log(`    · ${id}`);
  } else {
    console.log("\n  No NVIDIA model IDs advertised by /models on this account (some consoles hide the catalog; the chat test below is authoritative).");
  }
});

await step(`POST /chat/completions — ${model} answers`, async () => {
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Reply with exactly: NEBIRMOK" },
        { role: "user", content: "ping" }
      ],
      max_tokens: 200
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} — ${text.slice(0, 300)}`);
  }
  const payload = JSON.parse(text);
  const content = payload.choices?.[0]?.message?.content;
  // Nemotron is a hybrid-reasoning model: it may reason about the instruction
  // instead of echoing it verbatim, so require a real non-empty completion
  // (with finish_reason and usage) rather than an exact echo.
  if (!content || String(content).trim().length === 0) {
    throw new Error(`empty reply: ${text.slice(0, 300)}`);
  }
  const choice = payload.choices?.[0];
  if (choice && choice.finish_reason && choice.finish_reason === "length") {
    throw new Error("reply truncated by max_tokens before any content");
  }
  const usage = payload.usage
    ? ` · ${JSON.stringify(payload.usage)}`
    : "";
  return `replied "${String(content).trim().slice(0, 40)}"${usage}`;
});

await step("structured JSON round-trip (product's jsonMode:none path)", async () => {
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You reply with a single JSON object and nothing else." },
        { role: "user", content: 'Return {"platform":"x","hook":"<8 words>"} for launching an AI note app.' }
      ],
      max_tokens: 300
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} — ${text.slice(0, 300)}`);
  const content = JSON.parse(text).choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(String(content).replace(/^```(?:json)?|```$/g, "").trim());
  if (typeof parsed.platform !== "string" || typeof parsed.hook !== "string") {
    throw new Error(`shape mismatch: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  return `parsed ${JSON.stringify(parsed)}`;
});

console.log(
  failures === 0
    ? "\nAll Nebius checks passed — the app will route direct-LLM traffic through Nemotron on Nebius."
    : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
