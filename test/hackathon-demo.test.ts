// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/hackathon/demo/route";

const originalEnv = { NEBIUS_API_KEY: process.env.NEBIUS_API_KEY };
const originalFetch = globalThis.fetch;

function request(body: unknown, ip = "127.0.0.1") {
  return new Request("http://localhost/api/hackathon/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body)
  });
}

function nebiusReply(content: unknown, finishReason = "stop") {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: finishReason }],
      usage: { total_tokens: 123 }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeEach(() => {
  vi.stubEnv("NEBIUS_API_KEY", "synthetic-nebius-key");
  vi.stubEnv("NEBIUS_API_BASE", "");
  vi.stubGlobal("fetch", vi.fn(async () => nebiusReply('{"x_hook":"h","linkedin_opener":"o"}')));
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("hackathon demo endpoint", () => {
  it("answers with parsed hooks, model, and provider attribution", async () => {
    const response = await POST(request({ idea: "We shipped dark mode and faster exports" }, "1.1.1.1"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.x_hook).toBe("h");
    expect(payload.linkedin_opener).toBe("o");
    expect(payload.model).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(payload.served_by).toBe("Nebius Token Factory");
  });

  it("extracts JSON even when Nemotron wraps it in prose or fences", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => nebiusReply('Here you go:\n```json\n{"x_hook":"hook","linkedin_opener":"opener"}\n```'))
    );
    const response = await POST(request({ idea: "Launched team workspaces today" }, "2.2.2.2"));
    expect(response.status).toBe(200);
    expect((await response.json()).x_hook).toBe("hook");
  });

  it("fails closed with 503 when Nebius is not configured — never falls back to another provider", async () => {
    vi.stubEnv("NEBIUS_API_KEY", "");
    const response = await POST(request({ idea: "We shipped dark mode and faster exports" }, "3.3.3.3"));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/NEBIUS_API_KEY/);
  });

  it("rejects too-short ideas with 400", async () => {
    const response = await POST(request({ idea: "hi" }, "4.4.4.4"));
    expect(response.status).toBe(400);
  });

  it("caps abuse at six runs per hour per IP", async () => {
    for (let i = 0; i < 6; i += 1) {
      const response = await POST(request({ idea: "We shipped dark mode and faster exports" }, "5.5.5.5"));
      expect(response.status).toBe(200);
    }
    const seventh = await POST(request({ idea: "We shipped dark mode and faster exports" }, "5.5.5.5"));
    expect(seventh.status).toBe(429);
  });

  it("surfaces a retry hint when the reasoning budget swallows the reply", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nebiusReply(null, "length")));
    const response = await POST(request({ idea: "Launched team workspaces today" }, "6.6.6.6"));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/reasoning/i);
  });
});
