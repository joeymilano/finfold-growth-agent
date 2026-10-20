// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readWechatPublicationImage } from "@/lib/wechat-publication-image";

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => { throw new Error("Not in Workers"); } }));
const png = readFileSync("public/brand/app-icon.png");
const imageResponse = () => new Response(png, { headers: { "content-type": "image/png" } });
const binding = (fetch: ReturnType<typeof vi.fn>) => ({ fetch }) as unknown as CloudflareEnv["ASSETS"];
afterEach(() => vi.unstubAllGlobals());

describe("WeChat publication image transport", () => {
  it("reads the real bundled logo through ASSETS without a public self-fetch", async () => {
    const publicFetch = vi.fn(); vi.stubGlobal("fetch", publicFetch);
    const assetFetch = vi.fn(imageResponse);
    const result = await readWechatPublicationImage("https://www.finfold.app/brand/app-icon.png", 2_000_000, binding(assetFetch));
    expect(result.bytes.byteLength).toBe(png.byteLength);
    expect(result.contentType).toBe("image/png");
    expect(assetFetch).toHaveBeenCalledOnce();
    expect(publicFetch).not.toHaveBeenCalled();
  });
  it.each(["https://cdn.example.com/brand/a.png", "https://www.finfold.app/api/image.png"])('keeps external safety policy for %s', async (url) => {
    const publicFetch = vi.fn(imageResponse); vi.stubGlobal("fetch", publicFetch);
    const assetFetch = vi.fn();
    await readWechatPublicationImage(url, 2_000_000, binding(assetFetch));
    expect(assetFetch).not.toHaveBeenCalled();
    expect(publicFetch).toHaveBeenCalledOnce();
  });
  it("retains byte limits and image validation for internal assets", async () => {
    const url = "https://www.finfold.app/brand/app-icon.png";
    await expect(readWechatPublicationImage(url, 10, binding(vi.fn(imageResponse)))).rejects.toThrow();
    await expect(readWechatPublicationImage(url, 1000, binding(vi.fn(() => new Response("not png", { headers: { "content-type": "image/png" } }))))).rejects.toThrow("valid static JPEG or PNG");
    await expect(readWechatPublicationImage(url, 1000, binding(vi.fn(() => new Response("error", { headers: { "content-type": "text/html" } }))))).rejects.toThrow("valid static JPEG or PNG");
  });
});
