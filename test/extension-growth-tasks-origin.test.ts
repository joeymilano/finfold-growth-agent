import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/extension/auth", () => ({ authenticateExtensionRequest: vi.fn(async () => null) }));
vi.mock("@/lib/extension/usage", () => ({ extensionAuthEnabled: () => true }));
vi.mock("@/lib/growth-loop/contracts", () => ({ growthLoopEnabled: () => false }));
vi.mock("@/lib/extension/growth-tasks", () => ({ listExtensionGrowthTasks: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createSupabaseAdminClient: vi.fn() }));
import { GET } from "@/app/api/extension/v1/growth-tasks/route";
import { authenticateExtensionRequest } from "@/lib/extension/auth";

// The publish-assistant card broke in the wild (2026-10-06): Chrome omitted
// Origin on host-permitted side-panel fetches and only the session route had
// the originless exemption, so this GET answered a string-error 403 that the
// panel could only render as HTTP_403. These cases pin the shared gate.
const approved = "chrome-extension://gebbcemokglolnbocggbefmkjkfkcfhe";
const url = "https://www.finfold.app/api/extension/v1/growth-tasks";
describe("extension growth-tasks GET origin handling", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("FINFOLD_EXTENSION_ORIGINS", approved); });
  it("lets an origin-less request reach authentication instead of 403", async () => {
    const response = await GET(new Request(url));
    expect(response.status).toBe(401);
    expect(((await response.json()) as Record<string, unknown>).code).toBe("UNAUTHENTICATED");
    expect(authenticateExtensionRequest).toHaveBeenCalledOnce();
  });
  it("rejects an explicit unapproved origin with a coded error", async () => {
    const response = await GET(new Request(url, { headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "ORIGIN_NOT_ALLOWED" } });
    expect(authenticateExtensionRequest).not.toHaveBeenCalled();
  });
  it("lets Chrome 153+'s opaque null origin reach authentication", async () => {
    const response = await GET(new Request(url, { headers: { origin: "null" } }));
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("null");
  });
  it("keeps approved-origin CORS and authentication", async () => {
    const response = await GET(new Request(url, { headers: { origin: approved } }));
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(approved);
  });
});
