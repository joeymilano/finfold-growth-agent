"use client";

import Link from "next/link";
import { FishLogo } from "@/components/app-shell/FishLogo";
import { LocaleToggle } from "@/components/theme/LocaleToggle";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useLocale } from "@/hooks/useLocale";

export function WorkspaceAuthHeader() {
  const locale = useLocale();
  return (
    <header className="workspace-auth-header">
      <Link href={locale === "en" ? "/en" : "/"} aria-label="Finfold" className="focus-ring workspace-brand">
        <span className="workspace-brand-mark relative h-8 w-8 shrink-0"><FishLogo variant="app-icon" className="h-8 w-8 rounded-[10px]" /></span>
        <span className="text-[15px] font-semibold tracking-tight">Finfold</span>
      </Link>
      <div className="workspace-preferences"><LocaleToggle /><ThemeToggle /></div>
    </header>
  );
}
