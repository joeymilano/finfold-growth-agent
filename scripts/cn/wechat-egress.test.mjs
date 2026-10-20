import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createWechatEgressServer } from "./wechat-egress.mjs";

const token = "a".repeat(64);
test("relay authenticates, confines upstream requests, preserves multipart bytes and rejects redirects", async () => {
  const calls = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      calls.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.url.includes("redirect")) { res.writeHead(302, { Location: "https://example.com/" }); res.end(); }
      else { res.writeHead(200); res.end('{"media_id":"test-media"}'); }
    });
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const port = upstream.address().port;
  const relay = createWechatEgressServer({ token, upstream: (url, options, callback) => {
    assert.equal(url.origin, "https://api.weixin.qq.com");
    return http.request({ ...options, hostname: "127.0.0.1", port, path: url.pathname + url.search }, callback);
  } });
  await new Promise(resolve => relay.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${relay.address().port}`;
  const headers = { "x-finfold-wechat-egress-token": token, "content-type": "multipart/form-data; boundary=sample" };
  try {
    assert.equal((await fetch(origin + "/health")).status, 401);
    assert.equal((await fetch(origin + "/health", { headers })).status, 200);
    assert.equal((await fetch(origin + "/not-allowed", { method: "POST", headers, body: "{}" })).status, 404);
    assert.equal((await fetch(origin + "/cgi-bin/draft/add?url=https://example.com", { method: "POST", headers, body: "{}" })).status, 400);
    assert.equal(calls.length, 0);
    const response = await fetch(origin + "/cgi-bin/material/add_material?type=image&access_token=test", {
      method: "POST", headers: { ...headers, authorization: "private", cookie: "private" }, body: "--sample\r\nimage-bytes\r\n--sample--"
    });
    assert.deepEqual(await response.json(), { media_id: "test-media" });
    assert.equal(calls[0].body, "--sample\r\nimage-bytes\r\n--sample--");
    assert.equal(calls[0].headers["content-type"], headers["content-type"]);
    for (const name of ["x-finfold-wechat-egress-token", "authorization", "cookie"]) assert.equal(calls[0].headers[name], undefined);
    assert.equal((await fetch(origin + "/cgi-bin/draft/add?access_token=redirect", { method: "POST", headers, body: "{}" })).status, 502);
    const oversized = await new Promise(resolve => {
      const request = http.request(origin + "/cgi-bin/draft/add", { method: "POST", headers: { ...headers, "Content-Length": 13 * 1024 * 1024 } }, response => {
        response.resume(); resolve(response.statusCode);
      });
      request.end();
    });
    assert.equal(oversized, 413);
  } finally {
    relay.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => relay.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});
