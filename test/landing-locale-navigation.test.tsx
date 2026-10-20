import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarUserPanel } from "@/components/app-shell/SidebarUserPanel";
import { AuthenticatedRedirect } from "@/components/landing/AuthenticatedRedirect";
import { LocaleToggle } from "@/components/theme/LocaleToggle";
import { LOCALE_STORAGE_KEY } from "@/lib/theme";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  authUser: {
    ready: true,
    user: {
      id: "user-1",
      email: "founder@example.com",
      avatarUrl: null,
      plan: "free",
      locale: "zh"
    } as {
      id: string;
      email: string;
      avatarUrl: null;
      plan: string;
      locale: string | null;
    } | null
  }
}));

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({ replace: mocks.replace, push: mocks.push })
}));
vi.mock("@/components/auth/AuthUserProvider", () => ({
  useAuthUser: () => ({ ...mocks.authUser, refresh: mocks.refresh })
}));
vi.mock("@/hooks/useLocale", () => ({ useLocale: () => "en" }));
vi.mock("@/components/ui/UserAvatar", () => ({ UserAvatar: () => null }));

const storageValues = new Map<string, string>();
const storage = {
  get length() { return storageValues.size; },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => { storageValues.delete(key); },
  setItem: (key: string, value: string) => { storageValues.set(key, value); }
} satisfies Storage;

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  document.cookie = `${LOCALE_STORAGE_KEY}=; path=/; max-age=0`;
  document.documentElement.lang = "zh-CN";
  window.history.replaceState({}, "", "/");
  mocks.authUser.ready = true;
  mocks.authUser.user = {
    id: "user-1",
    email: "founder@example.com",
    avatarUrl: null,
    plan: "free",
    locale: "zh"
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("landing language navigation", () => {
  it.each(["/", "/en"])("keeps a signed-out English browser on its requested canonical URL %s", (path) => {
    window.history.replaceState({}, "", path);
    mocks.authUser.user = null;
    const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    try {
      render(<AuthenticatedRedirect />);
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    } finally {
      languages.mockRestore();
    }
  });

  it("keeps the stay marker in both landing-page language directions", () => {
    const chinesePage = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
    const englishPage = readFileSync(join(process.cwd(), "app/en/page.tsx"), "utf8");

    expect(chinesePage).toContain('localeHref="/en#stay"');
    expect(englishPage).toContain('localeHref="/#stay"');
  });

  it("marks a language change as an explicit request to stay on the landing page", async () => {
    const user = userEvent.setup();
    render(<LocaleToggle href="/en#stay" targetLocale="en" />);

    await user.click(screen.getByRole("button", { name: "语言" }));
    const englishLink = screen.getByRole("menuitem", { name: "English" });
    expect(englishLink).toHaveAttribute("href", "/en#stay");

    englishLink.addEventListener("click", (event) => event.preventDefault());
    await user.click(englishLink);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("refreshes the menu after the page's language changes during navigation", async () => {
    const user = userEvent.setup();
    render(<LocaleToggle />);
    const toggle = screen.getByRole("button", { name: "语言" });

    document.cookie = `${LOCALE_STORAGE_KEY}=en; path=/`;
    document.documentElement.lang = "en";
    await user.click(toggle);

    expect(screen.getByRole("menuitem", { name: "English" })).toHaveClass("font-semibold");
    await user.click(screen.getByRole("menuitem", { name: "简体中文" }));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh");
    expect(document.documentElement).toHaveAttribute("lang", "zh-CN");
  });

  it("saves an explicit language choice even when it matches the inferred language", async () => {
    const user = userEvent.setup();
    render(<LocaleToggle />);
    await user.click(screen.getByRole("button", { name: "语言" }));
    await user.click(screen.getByRole("menuitem", { name: "简体中文" }));

    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh");
  });

  it("does not redirect a signed-in visitor when the landing URL carries the stay marker", async () => {
    window.history.replaceState({}, "", "/en#stay");
    render(<AuthenticatedRedirect />);

    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.pathname).toBe("/en");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("keeps a signed-in visitor on the landing section they linked to", async () => {
    window.history.replaceState({}, "", "/#pricing");
    render(<AuthenticatedRedirect />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.hash).toBe("#pricing");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("keeps the normal signed-in landing redirect when there is no deliberate stay marker", async () => {
    window.history.replaceState({}, "", "/en");
    render(<AuthenticatedRedirect />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("does not let a stale profile locale overwrite the visitor's explicit browser choice", async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    render(<SidebarUserPanel />);

    await waitFor(() => expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en"));
  });

  it("uses the profile locale on a browser that has no explicit preference", async () => {
    if (mocks.authUser.user) mocks.authUser.user.locale = "en";
    render(<SidebarUserPanel />);

    await waitFor(() => expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en"));
  });
});


describe("sidebar account actions", () => {
  function openAccount() {
    render(<SidebarUserPanel compact />);
    const summary = screen.getByLabelText("Account");
    const account = summary.closest("details")!;
    account.open = true;
    summary.focus();
    return { account, summary };
  }

  it.each(["Plan", "Settings"])("keeps %s clickable when a browser blurs the trigger without focusing the link", (name) => {
    const { account, summary } = openAccount();
    const action = screen.getByRole("link", { name });
    let clicked = false;
    action.addEventListener("click", (event) => { event.preventDefault(); clicked = true; });
    fireEvent.pointerDown(action);
    fireEvent.blur(summary, { relatedTarget: null });
    expect(account.open).toBe(true);
    fireEvent.click(action);
    expect(clicked).toBe(true);
    expect(action).toHaveAttribute("href", name === "Plan" ? "/billing" : "/settings");
    expect(account.open).toBe(false);
  });

  it("keeps keyboard focus within the account actions and closes when focus leaves", () => {
    const { account } = openAccount();
    screen.getByRole("link", { name: "Plan" }).focus();
    expect(account.open).toBe(true);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(account.open).toBe(false);
    outside.remove();
  });

  it("closes on an outside pointer press even when the target cannot receive focus", () => {
    const { account } = openAccount();
    fireEvent.pointerDown(document.body);
    expect(account.open).toBe(false);
  });

  it("closes on Escape and returns focus to the account trigger", () => {
    const { account, summary } = openAccount();
    const action = screen.getByRole("link", { name: "Settings" });
    action.focus();
    fireEvent.keyDown(action, { key: "Escape" });
    expect(account.open).toBe(false);
    expect(summary).toHaveFocus();
  });
});
