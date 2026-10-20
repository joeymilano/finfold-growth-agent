"use client";

import Link from "next/link";
import { ArrowRight, CircleHelp, RefreshCcw } from "@/components/ui/icons";
import { WorkspaceAuthHeader } from "@/components/app-shell/WorkspaceAuthHeader";
import { useLocale } from "@/hooks/useLocale";

export function WorkspaceStatusPage({ kind, retry, embedded = false }: {
  kind: "not-found" | "error";
  retry?: () => void;
  embedded?: boolean;
}) {
  const en = useLocale() === "en";
  const missing = kind === "not-found";
  const content = (
    <section className={embedded ? "panel w-full max-w-md p-8 text-center" : "workspace-auth-panel text-center"}>
      <span aria-hidden className="mx-auto mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-fg-muted">
        {missing ? <CircleHelp className="h-6 w-6" /> : <RefreshCcw className="h-6 w-6" />}
      </span>
      <h1>{missing ? en ? "Page not found" : "没有找到这个页面" : en ? "Unable to open this page" : "暂时无法打开页面"}</h1>
      <p className="mt-4 text-sm leading-6 text-fg-muted">
        {missing ? en ? "The link may have changed or expired." : "链接可能已更改或失效。" : en ? "Try again in a moment." : "请稍后再试一次。"}
      </p>
      <div className="mt-7 grid gap-3">
        {retry ? <button type="button" onClick={retry} className="btn-primary focus-ring">{en ? "Try again" : "重新加载"}<RefreshCcw className="h-4 w-4" /></button> : null}
        <Link href="/workbench" className={`${retry ? "btn-ghost" : "btn-primary"} focus-ring`}>{en ? "Open workbench" : "返回创作台"}<ArrowRight className="h-4 w-4" /></Link>
      </div>
    </section>
  );
  if (embedded) return <div className="workspace-empty-state">{content}</div>;
  return (
    <main data-workspace-theme data-workspace-canvas className="workspace-auth">
      <WorkspaceAuthHeader />
      <div className="workspace-auth-content">{content}</div>
    </main>
  );
}
