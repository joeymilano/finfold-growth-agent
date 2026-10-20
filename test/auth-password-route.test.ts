import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  verifierSignIn: vi.fn(),
  verifierSignOut: vi.fn(),
  updateUserById: vi.fn(async () => ({ error: null }))
}));

vi.mock("@/lib/supabase", () => ({
  hasSupabaseConfig: () => true,
  createSupabaseAdminClient: () => ({ auth: { admin: { updateUserById: mocks.updateUserById } } }),
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser, updateUser: mocks.updateUser, signOut: mocks.signOut }
  }))
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { signInWithPassword: mocks.verifierSignIn, signOut: mocks.verifierSignOut }
  }))
}));

import { POST } from "@/app/api/auth/password/route";
import { createRecoveryGrant, RECOVERY_GRANT_COOKIE } from "@/lib/auth-recovery-grant";

const emailUser = {
  id: "user-1",
  email: "person@example.com",
  app_metadata: { provider: "email", providers: ["email"] },
  identities: [{ provider: "email" }]
};

function request(body: Record<string, unknown>, cookie = "finfold-locale=zh") {
  return new Request("https://www.finfold.app/api/auth/password", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-0123456789";
  mocks.getUser.mockResolvedValue({ data: { user: emailUser } });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.verifierSignIn.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
  mocks.verifierSignOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("POST /api/auth/password", () => {
  it("requires the current password for an email-password account", async () => {
    const response = await POST(request({ password: "crimson-harbor-77" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "current_password_required", error: "请输入当前密码。" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a wrong current password without changing anything", async () => {
    mocks.verifierSignIn.mockResolvedValue({ data: { session: null }, error: { message: "Invalid login credentials" } });
    const response = await POST(request({ password: "crimson-harbor-77", currentPassword: "wrong" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "current_password_invalid" });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("changes the password with the right current password and signs out other sessions", async () => {
    const response = await POST(request({ password: "crimson-harbor-77", currentPassword: "old-pass-123" }));
    expect(response.status).toBe(200);
    expect(mocks.verifierSignIn).toHaveBeenCalledWith({ email: "person@example.com", password: "old-pass-123" });
    expect(mocks.verifierSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "crimson-harbor-77" });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("lets a recovery-email session reset without the current password", async () => {
    const grant = await createRecoveryGrant("user-1");
    const response = await POST(request({ password: "crimson-harbor-77" }, `${RECOVERY_GRANT_COOKIE}=${grant}`));
    expect(response.status).toBe(200);
    expect(mocks.verifierSignIn).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(response.headers.get("set-cookie")).toContain(`${RECOVERY_GRANT_COOKIE}=;`);
  });

  it("does not accept another user's recovery grant", async () => {
    const grant = await createRecoveryGrant("someone-else");
    const response = await POST(request({ password: "crimson-harbor-77" }, `${RECOVERY_GRANT_COOKIE}=${grant}`));
    expect(response.status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("lets an OAuth-only account set its first password", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-2", email: "g@example.com", app_metadata: { provider: "google", providers: ["google"] }, identities: [{ provider: "google" }] } }
    });
    const response = await POST(request({ password: "crimson-harbor-77" }));
    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalled();
    expect(mocks.updateUserById).toHaveBeenCalledWith("user-2", { app_metadata: { password_set: true } });
  });

  it("requires the current password once an OAuth account has set one", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-2", email: "g@example.com", app_metadata: { provider: "google", providers: ["google"], password_set: true }, identities: [{ provider: "google" }] } }
    });
    const response = await POST(request({ password: "crimson-harbor-77" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("current_password_required");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("localizes the provider's same-password error", async () => {
    mocks.updateUser.mockResolvedValue({ error: { code: "same_password", message: "New password should be different from the old password." } });
    const response = await POST(request({ password: "crimson-harbor-77", currentPassword: "crimson-harbor-77" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("新密码不能与当前密码相同。");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
