"use client";

import { Loader2 } from "@/components/ui/icons";
import { useLocale } from "@/hooks/useLocale";

export default function WorkspaceLoading() {
  const locale = useLocale();
  return <div role="status" aria-label={locale === "en" ? "Loading page" : "正在加载页面"} className="workspace-page-loading">
    <Loader2 className="h-6 w-6 animate-spin text-fg-muted" aria-hidden="true" />
    <span className="sr-only">{locale === "en" ? "Loading page" : "正在加载页面"}</span>
  </div>;
}
