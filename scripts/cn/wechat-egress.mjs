import http from "node:http";
import https from "node:https";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

export const WECHAT_API_PATHS = new Set([
  "/cgi-bin/component/api_component_token", "/cgi-bin/component/api_create_preauthcode",
  "/cgi-bin/component/api_query_auth", "/cgi-bin/component/api_authorizer_token",
  "/cgi-bin/component/api_get_authorizer_info", "/cgi-bin/media/uploadimg",
  "/cgi-bin/material/add_material", "/cgi-bin/draft/add", "/cgi-bin/draft/batchget",
  "/cgi-bin/freepublish/submit", "/cgi-bin/freepublish/get",
  "/datacube/getusersummary", "/datacube/getusercumulate"
]);
const MAX_BODY = 12 * 1024 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;

export function createWechatEgressServer({ token, upstream = https.request }) {
  if (!/^[a-f0-9]{64}$/.test(token ?? "")) throw new Error("Configure a 32-byte hex WeChat egress token.");
  return http.createServer((req, res) => {
    const reply = (status, message) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ error: message }));
    };
    const supplied = req.headers["x-finfold-wechat-egress-token"];
    if (typeof supplied !== "string" || Buffer.byteLength(supplied) !== Buffer.byteLength(token)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return reply(401, "Unauthorized");
    let url;
    try { url = new URL(req.url, "http://localhost"); }
    catch { return reply(400, "Invalid target"); }
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.method !== "POST" || !WECHAT_API_PATHS.has(url.pathname)
      || url.origin !== "http://localhost" || req.url.startsWith("//")) return reply(404, "Not found");
    if ([...url.searchParams.keys()].some(key => !["access_token", "component_access_token", "type"].includes(key))) {
      return reply(400, "Invalid parameters");
    }
    const length = Number(req.headers["content-length"]);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY || req.headers["transfer-encoding"]) {
      return reply(413, "Invalid body size");
    }
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) { reply(413, "Body too large"); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      if (size !== length) return reply(400, "Invalid body size");
      const target = new URL(url.pathname + url.search, "https://api.weixin.qq.com");
      const headers = { "Content-Length": size, Accept: "application/json" };
      if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
      const outgoing = upstream(target, { method: "POST", headers, timeout: 30_000, family: 4 }, response => {
        // Never follow redirects carrying access tokens to another destination.
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume(); return reply(502, "Upstream redirect rejected");
        }
        const parts = [];
        let responseSize = 0;
        response.on("data", chunk => {
          responseSize += chunk.length;
          if (responseSize > MAX_RESPONSE) { response.destroy(); return reply(502, "Upstream response too large"); }
          parts.push(chunk);
        });
        response.on("error", () => reply(502, "Upstream unavailable"));
        response.on("end", () => {
          if (res.writableEnded) return;
          res.writeHead(response.statusCode ?? 502, {
            "Content-Type": "application/json", "Cache-Control": "no-store"
          });
          res.end(Buffer.concat(parts));
        });
      });
      outgoing.on("timeout", () => outgoing.destroy());
      outgoing.on("error", () => reply(502, "Upstream unavailable"));
      res.on("close", () => { if (!res.writableEnded) outgoing.destroy(); });
      outgoing.end(Buffer.concat(chunks));
    });
    req.on("error", () => reply(400, "Invalid request"));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createWechatEgressServer({ token: process.env.WECHAT_API_EGRESS_TOKEN });
  server.requestTimeout = 40_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 32;
  server.listen(8788, "127.0.0.1");
  // No request URLs, headers, provider payloads, or credentials are logged.
}
