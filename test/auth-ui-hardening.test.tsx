import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  locale: "zh" as "zh" | "en",
  authUser: null as null | { id: string; email: string; avatarUrl: string | null; hasPassword?: boolean }
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/invite"
}));
vi.mock("@/hooks/useLocale", () => ({ useLocale: () => mocks.locale }));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn(), identifyAnalyticsUser: vi.fn() }));
vi.mock("motion/react", () => ({ motion: new Proxy({}, { get: (_target, tag) => tag }) }));
vi.mock("@/components/app-shell/FishLogo", () => ({ FishLogo: () => null }));
vi.mock("@/components/ui/BorderBeam", () => ({ BorderBeam: () => null }));
vi.mock("@/components/theme/LocaleToggle", () => ({ LocaleToggle: () => null }));
vi.mock("@/components/theme/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/settings/CompletionSoundCard", () => ({ CompletionSoundCard: () => null }));
vi.mock("@/components/auth/AuthUserProvider", () => ({
  useAuthUser: () => ({ ready: true, user: mocks.authUser, refresh: vi.fn() })
}));

import { AuthSplit } from "@/components/app-shell/AuthSplit";
import { AccountSecurityTab } from "@/components/settings/AccountSecurityTab";
import { ReferralDashboard } from "@/components/referrals/ReferralDashboard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.locale = "zh";
  mocks.authUser = null;
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: () => null,
      get length() { return values.size; }
    }
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AuthSplit hardening", () => {
  it("sends one login request when Enter is pressed repeatedly", async () => {
    const pending = deferred<unknown>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthSplit mode="login" returnTo="/dashboard" />);
    fireEvent.change(screen.getByTestId("auth-email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByTestId("auth-password"), { target: { value: "secret-123" } });

    fireEvent.keyDown(screen.getByTestId("auth-password"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("auth-password"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("auth-email"), { key: "Enter" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ ok: false, status: 401, json: async () => ({ error: "邮箱或密码不正确，请检查后重试。" }) });
    });
    expect(await screen.findByTestId("auth-status")).toHaveAttribute("data-tone", "error");
  });

  it("offers sign-in and password reset in the confirmation state without revealing whether the email exists", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { id: "obfuscated" }, session: null, needsConfirmation: true })
    }));
    render(<AuthSplit mode="signup" returnTo="/workbench" />);
    await user.type(screen.getByTestId("auth-email"), "maybe@example.com");
    await user.type(screen.getByTestId("auth-password"), "Growth123!");
    await user.click(screen.getByTestId("auth-submit"));

    const status = await screen.findByTestId("auth-status");
    expect(status).toHaveAttribute("data-tone", "success");
    expect(status.textContent).not.toContain("注册成功");
    const hint = screen.getByTestId("auth-existing-account-hint");
    expect(hint).toHaveTextContent("如果此邮箱已注册，请直接登录或找回密码");
    expect(within(hint).getByRole("link", { name: "直接登录" })).toHaveAttribute("href", "/login?next=%2Fworkbench");
    expect(within(hint).getByRole("link", { name: "找回密码" })).toHaveAttribute("href", "/forgot-password?next=%2Fworkbench");
  });

  it("shows the resend cooldown as neutral information, not an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "确认邮件发送过于频繁，请等待几分钟后重试。", code: "confirmation_email_rate_limited", retryAfter: 60 })
    }));
    render(<AuthSplit mode="signup" returnTo="/dashboard" />);
    fireEvent.change(screen.getByTestId("auth-email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByTestId("auth-password"), { target: { value: "Growth123!" } });
    fireEvent.keyDown(screen.getByTestId("auth-password"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("auth-status")).toHaveAttribute("data-tone", "error"));

    fireEvent.keyDown(screen.getByTestId("auth-password"), { key: "Enter" });
    expect(screen.getByTestId("auth-status")).toHaveAttribute("data-tone", "info");
  });

  it("sends a new account without a target to the guided first task, but keeps explicit targets and returning logins", async () => {
    const respond = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    const signedUp = { user: { id: "user-new" }, session: { access_token: "t" }, needsConfirmation: false };
    const cases: Array<[mode: "signup" | "login", returnTo: string, expected: string]> = [
      ["signup", "/dashboard", "/workbench?start=1"],
      ["signup", "/billing?plan=starter", "/billing?plan=starter"],
      ["login", "/dashboard", "/dashboard"]
    ];
    for (const [mode, returnTo, expected] of cases) {
      mocks.push.mockClear();
      vi.stubGlobal("fetch", respond(mode === "signup" ? signedUp : { user: { id: "user-old" } }));
      const view = render(<AuthSplit mode={mode} returnTo={returnTo} />);
      fireEvent.change(screen.getByTestId("auth-email"), { target: { value: "a@example.com" } });
      fireEvent.change(screen.getByTestId("auth-password"), { target: { value: "Growth123!" } });
      fireEvent.keyDown(screen.getByTestId("auth-password"), { key: "Enter" });
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(expected));
      if (mode === "signup") {
        // The signup funnel compares this with the page the new account actually reaches.
        expect(JSON.parse(window.localStorage.getItem("finfold-signup-flow-v1") ?? "{}").returnTo).toBe(expected);
      }
      view.unmount();
    }
  });

  it("tells users an already-used confirmation link probably verified the email", () => {
    render(<AuthSplit mode="login" returnTo="/dashboard" initialError="email_confirm" />);
    expect(screen.getByTestId("auth-initial-error")).toHaveTextContent("邮箱可能已验证，请直接登录");
  });
});

describe("AccountSecurityTab hardening", () => {
  it("sends the current password once even when Enter is pressed twice", async () => {
    mocks.authUser = { id: "user-1", email: "person@example.com", avatarUrl: null };
    const pending = deferred<unknown>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountSecurityTab />);

    fireEvent.change(screen.getByTestId("settings-current-password"), { target: { value: "old-pass-123" } });
    fireEvent.change(screen.getByTestId("settings-new-password"), { target: { value: "crimson-harbor-77" } });
    fireEvent.change(screen.getByTestId("settings-confirm-password"), { target: { value: "crimson-harbor-77" } });
    fireEvent.keyDown(screen.getByTestId("settings-confirm-password"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("settings-confirm-password"), { key: "Enter" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/password", expect.objectContaining({
      body: JSON.stringify({ password: "crimson-harbor-77", currentPassword: "old-pass-123" })
    }));
    await act(async () => {
      pending.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    });
    expect(await screen.findByText("密码已更新，其他设备已退出登录。")).toBeInTheDocument();
  });

  it("hides the current-password field for OAuth accounts without a password", () => {
    mocks.authUser = { id: "user-2", email: "g@example.com", avatarUrl: null, hasPassword: false };
    render(<AccountSecurityTab />);
    expect(screen.queryByTestId("settings-current-password")).toBeNull();
    expect(screen.getByText(/可以在这里设置一个密码/)).toBeInTheDocument();
  });

  it("only offers still image formats the server accepts and shows no storage jargon", () => {
    mocks.authUser = { id: "user-1", email: "person@example.com", avatarUrl: null };
    const { container } = render(<AccountSecurityTab />);
    expect(container.querySelector('input[type="file"]')).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    expect(container.textContent).not.toMatch(/Supabase|Bucket/i);
  });
});

describe("ReferralDashboard copy fallback", () => {
  it("selects the link and asks for a manual copy when the webview blocks clipboard access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        inviteUrl: "https://www.finfold.app/r/ABC123",
        completedCount: 0,
        rewardLimit: 10,
        earnedCredits: 0,
        referrals: []
      })
    }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = vi.fn(() => false);
    render(<ReferralDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /复制链接/ }));
    await waitFor(() => expect(screen.getByTestId("invite-copy-feedback")).toHaveTextContent("长按即可复制"));
    expect(window.getSelection()?.toString()).toContain("https://www.finfold.app/r/ABC123");
  });

  it("keeps the current page as the return path on the sign-in link", async () => {
    window.history.replaceState(null, "", "/invite?from=menu");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "请先登录。" }) }));
    render(<ReferralDashboard />);
    expect(await screen.findByRole("link", { name: "登录后邀请好友" })).toHaveAttribute("href", "/login?next=%2Finvite%3Ffrom%3Dmenu");
  });
});

describe("shell sign-in links keep the return path", () => {
  it("links to login with the current page and hands off to the Studio draft on click", async () => {
    const { UserMenu } = await import("@/components/app-shell/UserMenu");
    const { WORKBENCH_AUTH_RETURN_EVENT } = await import("@/lib/workbench-auth-draft");
    window.history.replaceState(null, "", "/settings?tab=plan");
    render(<UserMenu />);
    const link = await screen.findByRole("link", { name: /登录/ });
    expect(link).toHaveAttribute("href", "/login?next=%2Fsettings%3Ftab%3Dplan");

    const swap = (event: Event) => {
      (event as CustomEvent<{ returnTo: string }>).detail.returnTo = "/workbench?authDraft=draft-1";
    };
    window.addEventListener(WORKBENCH_AUTH_RETURN_EVENT, swap);
    fireEvent.click(link);
    window.removeEventListener(WORKBENCH_AUTH_RETURN_EVENT, swap);
    expect(mocks.push).toHaveBeenCalledWith("/login?next=%2Fworkbench%3FauthDraft%3Ddraft-1");
  });
});
