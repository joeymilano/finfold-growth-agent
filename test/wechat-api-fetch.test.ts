// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { wechatApiFetch } from "@/lib/wechat-api-fetch";

const environment = {
  WECHAT_API_EGRESS_URL: "https://www.finfold.cn/__finfold/wechat-egress",
  WECHAT_API_EGRESS_TOKEN: "test-relay-token"
};

describe("WeChat fixed-IP transport", () => {
  it("preserves JSON, token query, and upstream response without forwarding unrelated headers", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"component_access_token":"test"}'));
    const response = await wechatApiFetch("https://api.weixin.qq.com/cgi-bin/component/api_create_preauthcode?component_access_token=access", {
      method: "POST", headers: { "content-type": "application/json", cookie: "private-cookie", authorization: "private-auth" },
      body: '{"component_appid":"wx_test"}'
    }, fetcher, environment);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://www.finfold.cn/__finfold/wechat-egress/cgi-bin/component/api_create_preauthcode?component_access_token=access");
    expect(init.redirect).toBe("manual");
    expect(init.headers.get("x-finfold-wechat-egress-token")).toBe("test-relay-token");
    expect(init.headers.has("cookie")).toBe(false);
    expect(init.headers.has("authorization")).toBe(false);
    expect(new TextDecoder().decode(init.body)).toBe('{"component_appid":"wx_test"}');
    expect(await response.json()).toEqual({ component_access_token: "test" });
  });

  it("serializes multipart image uploads while preserving their boundary", async () => {
    const form = new FormData();
    form.append("media", new Blob([Uint8Array.from([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "cover.jpg");
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    await wechatApiFetch("https://api.weixin.qq.com/cgi-bin/material/add_material?type=image&access_token=token", {
      method: "POST", body: form
    }, fetcher, environment);
    const init = fetcher.mock.calls[0][1];
    expect(init.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(new TextDecoder().decode(init.body)).toContain('filename="cover.jpg"');
  });

  it.each([301, 302, 303, 307, 308])("rejects relay redirects (%s) without following them or exposing their location", async status => {
    const fetcher = vi.fn().mockImplementation(async (_input, init) => {
      if (init.redirect !== "manual") throw new Error("Unsupported Worker redirect mode");
      return new Response("redirect body", { status, headers: { location: "https://other.example/private-token" } });
    });
    await expect(wechatApiFetch("https://api.weixin.qq.com/cgi-bin/draft/add", {
      method: "POST", body: "{}"
    }, fetcher, environment)).rejects.toThrow("WeChat fixed-IP egress redirect rejected.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed for a missing relay credential or an unexpected target", async () => {
    const fetcher = vi.fn();
    await expect(wechatApiFetch("https://api.weixin.qq.com/cgi-bin/draft/add", { method: "POST" }, fetcher, {
      WECHAT_API_EGRESS_URL: environment.WECHAT_API_EGRESS_URL
    })).rejects.toThrow(/credentials/);
    for (const url of ["https://example.com/", "http://api.weixin.qq.com/", "https://api.weixin.qq.com.evil.example/"]) {
      await expect(wechatApiFetch(url, { method: "POST" }, fetcher, environment)).rejects.toThrow(/target/);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps direct transport until relay activation", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    const options = { method: "POST", body: "{}" };
    await wechatApiFetch("https://api.weixin.qq.com/cgi-bin/draft/add", options, fetcher, {});
    expect(fetcher).toHaveBeenCalledWith("https://api.weixin.qq.com/cgi-bin/draft/add", options);
  });
});
