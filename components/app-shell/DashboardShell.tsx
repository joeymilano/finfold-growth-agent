"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import React, { useLayoutEffect, useState } from "react";
import { ArrowLeft, Brain, BriefcaseBusiness, ChevronDown, FileStack, Gauge, MessageSquare, ShieldCheck, Target, WandSparkles } from "@/components/ui/icons";
import { BugReportButton } from "@/components/app-shell/BugReportButton";
import { BeianNotice } from "@/components/BeianNotice";
import { GlobalAgentRail } from "@/components/app-shell/GlobalAgentRail";
import { FishLogo } from "@/components/app-shell/FishLogo";
import { MobileHeader } from "@/components/app-shell/MobileHeader";
import { MobileTabBar } from "@/components/app-shell/MobileTabBar";
import { NavLink } from "@/components/app-shell/NavLink";
import { SidebarUserPanel } from "@/components/app-shell/SidebarUserPanel";
import { LocaleToggle } from "@/components/theme/LocaleToggle";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useLocale } from "@/hooks/useLocale";

const primaryNavItemDefs = [
  { href: "/dashboard", zh: "智能体", en: "Agent", icon: MessageSquare },
  { href: "/overview", zh: "总览", en: "Overview", icon: Gauge },
  { href: "/operations", zh: "任务", en: "Tasks", icon: Target },
  { href: "/workbench", zh: "创作台", en: "Studio", icon: WandSparkles },
  { href: "/packages", zh: "内容库", en: "Library", icon: FileStack },
];
const advancedNavItemDefs = [
  { href: "/brand-memory", zh: "品牌记忆", en: "Brand memory", icon: Brain },
  { href: "/guardrails", zh: "品牌规则", en: "Brand rules", icon: ShieldCheck },
];
const SIDEBAR_KEY = "finfold-sidebar-collapsed";
const SIDEBAR_AUTO_COLLAPSE_QUERY = "(max-width: 1279px)";

function readSidebarPreference(): boolean {
  let saved: string | null = null;
  try { saved = localStorage.getItem(SIDEBAR_KEY); } catch { /* optional preference */ }
  return saved === "true" ? true : saved === "false" ? false : window.matchMedia(SIDEBAR_AUTO_COLLAPSE_QUERY).matches;
}

/**
 * Runs while the server HTML is parsed, before first paint and hydration, so
 * a collapsed preference never flashes the expanded sidebar. Mirrors
 * readSidebarPreference(); React takes over the attribute after mount.
 */
const SIDEBAR_INIT_SCRIPT = `(function(){try{var e=document.currentScript&&document.currentScript.parentElement;if(!e)return;var s=null;try{s=localStorage.getItem(${JSON.stringify(SIDEBAR_KEY)})}catch(_){}var c=s==="true"?true:s==="false"?false:window.matchMedia(${JSON.stringify(SIDEBAR_AUTO_COLLAPSE_QUERY)}).matches;e.setAttribute("data-sidebar-collapsed",String(c))}catch(_){}})()`;

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const core = pathname === "/dashboard" || (pathname === "/workbench" && searchParams.get("start") !== "1");

  // Layout effect: on client-side mounts (no init script run) the preference
  // is applied before the browser paints.
  useLayoutEffect(() => {
    setCollapsed(readSidebarPreference());
  }, []);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* usable without storage */ }
  }

  const nav = (items: typeof primaryNavItemDefs) => items.map((item) => (
    <NavLink key={item.href} href={item.href} label={locale === "en" ? item.en : item.zh} icon={item.icon} />
  ));

  if (pathname === "/workbench" && searchParams.get("start") === "1") {
    return <div data-product-shell data-workspace-theme data-workspace-canvas className="min-h-screen bg-bg text-fg">
      <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-hairline px-5 py-4">
        <Link href={locale === "en" ? "/en#stay" : "/#stay"} className="flex items-center gap-2.5 text-sm font-bold"><FishLogo variant="app-icon" className="h-8 w-8" />Finfold</Link>
        <div className="flex items-center gap-2"><LocaleToggle /><ThemeToggle /></div>
      </header>
      <main className="mx-auto max-w-5xl px-5">{children}</main>
    </div>;
  }

  return (
    <div data-product-shell data-workspace-theme data-workspace-canvas data-workspace-page={pathname} data-core-workspace={core || undefined}
      data-sidebar-collapsed={collapsed ?? undefined}
      suppressHydrationWarning
      className="workspace-shell min-h-screen w-full bg-bg text-fg lg:h-screen lg:min-h-0 lg:overflow-hidden">
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT_SCRIPT }} />
      <div data-workspace-theme><MobileHeader /><MobileTabBar /></div>
      <GlobalAgentRail hideLauncher={pathname === "/workbench"} />
      <div className="workspace-layout lg:grid lg:h-screen">
        <aside hidden data-workspace-theme className="workspace-sidebar relative flex-col lg:flex lg:h-full lg:min-h-0">
          <div className="workspace-brand-row">
            <Link href={locale === "en" ? "/en#stay" : "/#stay"} aria-label="Finfold" className="focus-ring workspace-brand">
              <span className="workspace-brand-mark relative h-8 w-8 shrink-0"><FishLogo variant="app-icon" className="h-8 w-8 rounded-[10px]" /></span>
              <span className="workspace-sidebar-label text-[15px] font-semibold tracking-tight">Finfold</span>
            </Link>
          </div>
          <div className="workspace-preferences"><LocaleToggle /><ThemeToggle /><BugReportButton inline /></div>
          <nav aria-label={locale === "en" ? "Main navigation" : "主导航"} className="workspace-nav grid min-h-0 flex-1 content-start gap-1">
            {nav(primaryNavItemDefs)}
            <details className="workspace-advanced group" open={pathname === "/brand-memory" || pathname === "/guardrails" || undefined}>
              <summary className="focus-ring workspace-nav-link list-none [&::-webkit-details-marker]:hidden" aria-label={locale === "en" ? "Brand tools" : "品牌工具"}>
                <BriefcaseBusiness className="h-[18px] w-[18px] shrink-0" />
                <span className="workspace-sidebar-label flex-1">{locale === "en" ? "Brand tools" : "品牌工具"}</span>
                <ChevronDown className="workspace-sidebar-label h-3 w-3 transition-transform group-open:rotate-180" />
                <span className="workspace-nav-tooltip" aria-hidden="true">{locale === "en" ? "Brand tools" : "品牌工具"}</span>
              </summary>
              <div className="workspace-advanced-items">{nav(advancedNavItemDefs)}</div>
            </details>
          </nav>
          <div className="workspace-sidebar-footer">
            <SidebarUserPanel compact />
            <button type="button" className="focus-ring workspace-collapse" onClick={toggleSidebar} aria-expanded={!collapsed}
              aria-label={collapsed ? (locale === "en" ? "Expand sidebar" : "展开侧栏") : (locale === "en" ? "Collapse sidebar" : "收起侧栏")}>
              <ArrowLeft className="h-4 w-4" /><span className="workspace-sidebar-label">{locale === "en" ? "Collapse" : "收起侧栏"}</span>
            </button>
            <BeianNotice className="workspace-sidebar-label px-2 pt-2 text-[10px] text-fg-muted" />
          </div>
        </aside>
        <main className="workspace-main w-full min-w-0 overflow-x-hidden px-3 pb-24 pt-16 sm:px-5 lg:h-screen lg:overflow-y-auto lg:overscroll-contain lg:p-6">{children}</main>
      </div>
    </div>
  );
}
