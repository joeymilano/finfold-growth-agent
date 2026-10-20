// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

let runtime: Miniflare;

describe("WeChat transport in the actual Workers runtime", () => {
  beforeAll(async () => {
    const result = await build({
      stdin: {
        contents: `import { wechatApiFetch } from "./lib/wechat-api-fetch";
          export default { async fetch(request, env) {
            try {
              const response = await wechatApiFetch(
                "https://api.weixin.qq.com/cgi-bin/component/api_component_token",
                { method: "POST", headers: { "content-type": new URL(request.url).pathname === "/redirect" ? "text/plain" : "application/json" }, body: "{}" },
                env.RELAY.fetch.bind(env.RELAY),
                { WECHAT_API_EGRESS_URL: "https://relay.example/egress", WECHAT_API_EGRESS_TOKEN: "runtime-test-token" }
              );
              return response;
            } catch (error) { return Response.json({ error: error.message }, { status: 502 }); }
          } };`,
        resolveDir: process.cwd(), sourcefile: "wechat-runtime-probe.ts", loader: "ts"
      },
      bundle: true, write: false, format: "esm", platform: "neutral",
      external: ["node:*"], tsconfig: "tsconfig.json"
    });
    runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: result.outputFiles[0].text,
      compatibilityDate: "2026-07-29", compatibilityFlags: ["nodejs_compat"],
      serviceBindings: {
        RELAY: async request => request.headers.get("content-type") === "application/json"
          ? Response.json({ ok: true, body: await request.text() })
          : new Response(null, { status: 302, headers: { location: "https://other.example/" } })
      }
    }));
  }, 20_000);

  afterAll(async () => { await runtime?.dispose(); });

  it("accepts the real Workers redirect option and preserves the JSON request", async () => {
    const response = await runtime.dispatchFetch("https://finfold.example/probe");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, body: "{}" });
  });

  it("rejects a relay redirect in Workers without following its location", async () => {
    const response = await runtime.dispatchFetch("https://finfold.example/redirect");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "WeChat fixed-IP egress redirect rejected." });
  });
});
