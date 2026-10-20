"use client";

import React, { startTransition } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceStatusPage } from "@/components/app-shell/WorkspaceStatusPage";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  // reset() alone re-renders the cached server payload, which fails again for
  // server-component errors; refresh() refetches it first.
  const retry = () => startTransition(() => {
    router.refresh();
    reset();
  });
  return <WorkspaceStatusPage kind="error" retry={retry} embedded />;
}
