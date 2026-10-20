"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useRef, useState } from "react";
import { useAuthUser } from "@/components/auth/AuthUserProvider";
import { CreditCard, LogIn, LogOut, Settings, User } from "@/components/ui/icons";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useLocale } from "@/hooks/useLocale";
import { entitlementPlanName } from "@/lib/pricing";
import { applyLocale, getExplicitLocalePreference } from "@/lib/theme";
import { loginHrefForCurrentPage, navigateToLoginPreservingReturn } from "@/lib/auth-login-link";

/**
 * SidebarUserPanel — shows the current user's avatar, plan, and actions.
 *
 * User data comes from the root AuthUserProvider, which shares one backend
 * /api/auth/user request and one browser auth listener across the whole app.
 */
export function SidebarUserPanel({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const locale = useLocale();
  const { ready, user, refresh } = useAuthUser();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [loginHref, setLoginHref] = useState("/login");
  const accountRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!compact) return;
    // A pointer click can blur the summary without focusing the action (Safari).
    // Close only after an actual outside interaction, preserving the link click.
    function closeOutside(event: Event) {
      const account = accountRef.current;
      if (account?.open && event.target instanceof Node && !account.contains(event.target)) {
        account.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [compact]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep the plain href accurate for new-tab clicks and link previews.
  useEffect(() => {
    setLoginHref(loginHrefForCurrentPage());
  }, [pathname]);

  const goToLogin = (event: React.MouseEvent<HTMLAnchorElement>) =>
    navigateToLoginPreservingReturn(event, (href) => router.push(href));

  useEffect(() => {
    const profileLocale = user?.locale;
    if (
      (profileLocale === "en" || profileLocale === "zh")
      && !getExplicitLocalePreference()
    ) {
      applyLocale(profileLocale);
    }
  }, [user?.locale]);

  async function logout() {
    try {
      // Route through backend API to keep secret key server-side
      await fetch("/api/auth/logout", { method: "POST" });
      await refresh();
      router.push("/login");
    } catch {
      // ignore
    }
  }

  if (!mounted) return null;

  if (compact) {
    if (!ready) return <div aria-label={locale === "en" ? "Loading account" : "正在加载账户"} className="h-12 animate-pulse rounded-xl bg-surface-2" />;
    if (!user) return (
      <Link href={loginHref} onClick={goToLogin} aria-label={locale === "en" ? "Log in / Sign up" : "登录 / 注册"} className="focus-ring workspace-account-login">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2"><User className="h-4 w-4" /></span>
        <span className="workspace-sidebar-label text-xs font-medium">{locale === "en" ? "Log in / Sign up" : "登录 / 注册"}</span>
      </Link>
    );
    return (
      <details ref={accountRef} className="workspace-account" onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}>
        <summary className="focus-ring" aria-label={locale === "en" ? "Account" : "账户"}>
          <UserAvatar avatarUrl={user.avatarUrl} fallback={(user.email[0] ?? "?").toUpperCase()} alt="" className="h-8 w-8 shrink-0 text-xs" />
          <span className="workspace-sidebar-label min-w-0"><span className="block truncate text-xs font-medium">{user.email.split("@")[0]}</span><span className="mt-0.5 block text-[10px] text-fg-muted">{entitlementPlanName(user.plan, locale)}</span></span>
        </summary>
        <div className="workspace-account-menu" onClick={() => {
          if (accountRef.current) accountRef.current.open = false;
        }}>
          <Link href="/billing" className="focus-ring"><CreditCard className="h-4 w-4" />{locale === "en" ? "Plan" : "订阅"}</Link>
          <Link href="/settings" className="focus-ring"><Settings className="h-4 w-4" />{locale === "en" ? "Settings" : "设置"}</Link>
          <button type="button" className="focus-ring" onClick={() => void logout()}><LogOut className="h-4 w-4" />{locale === "en" ? "Log out" : "退出登录"}</button>
        </div>
      </details>
    );
  }

  if (!ready) {
    return (
      <div aria-label={locale === "en" ? "Loading account" : "正在加载账户"} className="mb-1 border-b border-hairline px-3 pb-4">
        <div className="h-[58px] animate-pulse rounded-xl border border-hairline bg-surface-2" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="border-b border-hairline px-3 pb-4 mb-1">
        <Link
          href={loginHref}
          onClick={goToLogin}
          className="focus-ring flex w-full items-center gap-3 rounded-xl border border-hairline bg-surface-2 px-3.5 py-3 text-sm font-semibold text-fg-muted transition-colors hover:border-action/40 hover:text-fg"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface border border-hairline text-fg-muted">
            <User className="h-4 w-4" />
          </span>
          <span className="flex-1 leading-none">
            <span className="block text-xs font-semibold text-fg">
              {locale === "en" ? "Log in / Sign up" : "登录 / 注册"}
            </span>
            <span className="mt-0.5 block text-[11px] text-fg-muted">
              {locale === "en" ? "Save kits, unlock all features" : "保存内容包、解锁完整功能"}
            </span>
          </span>
          <LogIn className="h-4 w-4 shrink-0 text-action-strong dark:text-action" />
        </Link>
      </div>
    );
  }

  const initial = (user.email[0] ?? "?").toUpperCase();
  const planName = entitlementPlanName(user.plan, locale);

  return (
    <div className="border-b border-hairline px-3 pb-4 mb-1 space-y-1">
      {/* User row */}
      <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
        <UserAvatar
          avatarUrl={user.avatarUrl}
          fallback={initial}
          alt={user.email}
          className="h-8 w-8 text-sm shadow-glow-action"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-fg">{user.email}</p>
          <p className="mt-0.5 text-[11px] font-medium text-fg-muted">
            {planName}
          </p>
        </div>
      </div>

      {/* Action row */}
      <div className="grid grid-cols-3 gap-1.5">
        <Link
          href="/billing"
          className="focus-ring flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface px-2 py-2 text-[11px] font-semibold text-fg-muted transition-colors hover:border-action/40 hover:text-fg"
        >
          <CreditCard className="h-3.5 w-3.5" />
          {locale === "en" ? "Plan" : "订阅"}
        </Link>
        <Link
          href="/settings"
          className="focus-ring flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface px-2 py-2 text-[11px] font-semibold text-fg-muted transition-colors hover:border-action/40 hover:text-fg"
        >
          <Settings className="h-3.5 w-3.5" />
          {locale === "en" ? "Settings" : "设置"}
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          className="focus-ring flex items-center justify-center gap-1.5 rounded-lg border border-hairline bg-surface px-2 py-2 text-[11px] font-semibold text-fg-muted transition-colors hover:border-risk/40 hover:text-risk"
        >
          <LogOut className="h-3.5 w-3.5" />
          {locale === "en" ? "Log out" : "退出"}
        </button>
      </div>
    </div>
  );
}
