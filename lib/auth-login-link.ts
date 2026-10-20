import type { MouseEvent } from "react";
import { buildAuthHref } from "@/lib/auth-return";
import { requestWorkbenchAuthReturnTo } from "@/lib/workbench-auth-draft";

/** The page the visitor is on right now, as an internal return path. */
export function currentReturnTo(): string {
  if (typeof window === "undefined") return "/dashboard";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** Login URL that brings the visitor back to the current page afterwards. */
export function loginHrefForCurrentPage(): string {
  return buildAuthHref("/login", currentReturnTo());
}

/**
 * Click handler for "log in" links in shared chrome (sidebar, top bar, invite
 * page). The mounted Studio may swap the return path for a saved-draft
 * hand-off (same contract as the agent rail); when it cannot save the draft it
 * shows its own warning and we stay put instead of losing the work.
 * Modified clicks (new tab / window) keep the plain href.
 */
export function navigateToLoginPreservingReturn(
  event: MouseEvent<HTMLAnchorElement>,
  navigate: (href: string) => void
): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const returnTo = requestWorkbenchAuthReturnTo(currentReturnTo());
  if (returnTo) navigate(buildAuthHref("/login", returnTo));
}
