import { createCipheriv, createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/wechat-publication-jobs", () => ({ applyWechatPublicationCallback: vi.fn() }));

import { GET } from "@/app/api/integrations/wechat/authorizer-events/[authorizerAppId]/route";

const authorizerAppId = "wx1234567890abcdef";
const aesKey = Buffer.alloc(32, 7);
const token = "test-callback-token";

function challenge(recipient = authorizerAppId, invalidSignature = false) {
  const echo = "wechat-url-verification";
  const length = Buffer.alloc(4);
  length.writeUInt32BE(Buffer.byteLength(echo));
  const message = Buffer.concat([Buffer.alloc(16, 1), length, Buffer.from(echo), Buffer.from(recipient)]);
  const padding = 32 - (message.length % 32);
  const cipher = createCipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([message, Buffer.alloc(padding, padding)])), cipher.final()]).toString("base64");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "test-nonce";
  const signature = createHash("sha1").update([token, timestamp, nonce, encrypted].sort().join("")).digest("hex");
  const query = new URLSearchParams({ timestamp, nonce, echostr: encrypted, msg_signature: invalidSignature ? "0".repeat(40) : signature });
  return new Request(`https://finfold.example/api/integrations/wechat/authorizer-events/${authorizerAppId}?${query}`);
}

describe("publication callback URL verification", () => {
  beforeEach(() => {
    vi.stubEnv("WECHAT_COMPONENT_ENABLED", "true");
    vi.stubEnv("WECHAT_COMPONENT_APP_ID", "wx_component_test");
    vi.stubEnv("WECHAT_COMPONENT_APP_SECRET", "test-secret");
    vi.stubEnv("WECHAT_COMPONENT_TOKEN", token);
    vi.stubEnv("WECHAT_COMPONENT_ENCODING_AES_KEY", aesKey.toString("base64").replace(/=$/, ""));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns the decrypted echo on the publication callback path", async () => {
    const response = await GET(challenge(), { params: Promise.resolve({ authorizerAppId }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("wechat-url-verification");
  });

  it("verifies the original signature when a query adapter decodes base64 plus signs as spaces", async () => {
    const url = new URL(challenge().url);
    const encrypted = url.searchParams.get("echostr")!;
    expect(encrypted).toContain("+");
    url.searchParams.set("echostr", encrypted.replaceAll("+", " "));
    const response = await GET(new Request(url), { params: Promise.resolve({ authorizerAppId }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("wechat-url-verification");
    url.searchParams.set("msg_signature", "0".repeat(40));
    const invalid = await GET(new Request(url), { params: Promise.resolve({ authorizerAppId }) });
    expect(invalid.status).toBe(401);
  });

  it.each([
    [authorizerAppId, true],
    ["wxfedcba0987654321", false]
  ] as const)("rejects an invalid signature or a different recipient (%s, %s)", async (recipient, invalidSignature) => {
    const response = await GET(challenge(recipient, invalidSignature), { params: Promise.resolve({ authorizerAppId }) });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid signature");
  });

  it("keeps verification unavailable before activation", async () => {
    vi.stubEnv("WECHAT_COMPONENT_ENABLED", "false");
    const response = await GET(challenge(), { params: Promise.resolve({ authorizerAppId }) });
    expect(response.status).toBe(404);
  });
});
