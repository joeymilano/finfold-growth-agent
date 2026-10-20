"use client";

import Link from "next/link";
import React from "react";
import { usePathname } from "next/navigation";
import { Activity, AtSign, CalendarDays, ClipboardList, FlaskConical, Radar, ShieldCheck, WandSparkles } from "@/components/ui/icons";
import { useLocale } from "@/hooks/useLocale";

export function OperationsSectionNav({
  growthLoop = false,
  xPipeline = false,
  dailyPipeline = false
}: {
  growthLoop?: boolean;
  xPipeline?: boolean;
  dailyPipeline?: boolean;
}) {
  const pathname = usePathname();
  const locale = useLocale();
  const items: {
    href: string;
    zh: string;
    en: string;
    icon: typeof ClipboardList;
    gated?: "growth" | "x" | "daily";
  }[] = [
    { href: "/operations", zh: "运营目标", en: "Operating brief", icon: ClipboardList },
    { href: "/operations/growth", zh: "增长闭环", en: "Growth Loop", icon: FlaskConical, gated: "growth" as const },
    { href: "/operations/x-pipeline", zh: "X 流水线", en: "X Pipeline", icon: AtSign, gated: "x" as const },
    { href: "/operations/daily-pipeline", zh: "日更流水线", en: "Daily Pipeline", icon: CalendarDays, gated: "daily" as const },
    { href: "/operations/opportunities", zh: "机会雷达", en: "Opportunity Radar", icon: Radar },
    { href: "/operations/account-health", zh: "账号体检", en: "Account Health", icon: ShieldCheck },
    { href: "/operations/xiaohongshu", zh: "小红书陪跑", en: "XHS Coaching", icon: Activity },
    { href: "/operations/lead-tools", zh: "获客搭子", en: "Lead Tools", icon: WandSparkles }
  ].filter((item) => !item.gated || (item.gated === "growth" && growthLoop) || (item.gated === "x" && xPipeline) || (item.gated === "daily" && dailyPipeline));
  return <nav aria-label={locale === "en" ? "Operations" : "运营系统"} className="workspace-section-tabs mx-auto max-w-[1240px] xl:max-w-[1440px] 2xl:max-w-[1640px]">
    {items.map(({ href, zh, en, icon: Icon }) => {
      const active = pathname === href || (href !== "/operations" && pathname.startsWith(`${href}/`));
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} className="focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap"><Icon className="h-4 w-4 shrink-0" /><span className="truncate">{locale === "en" ? en : zh}</span></Link>;
    })}
  </nav>;
}
