"use client";
import React, { useEffect, useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, type LucideIcon } from "@/components/ui/icons";
import { useLocale } from "@/hooks/useLocale";

function NavigationFeedback({ navigating }: { navigating: React.MutableRefObject<boolean> }) {
  const { pending } = useLinkStatus();
  const pathname = usePathname();
  const locale = useLocale();
  useEffect(() => { navigating.current = pending; }, [pending, pathname, navigating]);
  if (!pending) return null;
  return <span data-nav-pending role="status" aria-label={locale === "en" ? "Opening page" : "正在打开页面"} className="workspace-nav-progress">
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
  </span>;
}

export function NavLink({ href, label, icon: Icon }: {
  href: string; label: string; description?: string; icon: LucideIcon;
}) {
  const pathname = usePathname();
  const navigating = useRef(false);
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  return (
    <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className="focus-ring workspace-nav-link"
      onNavigate={(event) => {
        // Do not restart an in-flight navigation when the same item is tapped.
        if (navigating.current) event.preventDefault();
        else navigating.current = true;
      }}>
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="workspace-sidebar-label">{label}</span>
      <span className="workspace-nav-tooltip" aria-hidden="true">{label}</span>
      <NavigationFeedback navigating={navigating} />
    </Link>
  );
}
