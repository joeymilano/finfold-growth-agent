"use client";

import Link from "next/link";
import React from "react";
import type { MouseEvent, ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { captureEvent } from "@/lib/posthog";
import { publicSiteHref } from "@/lib/site-policy";
import { applyLocale, getExplicitLocalePreference } from "@/lib/theme";

/**
 * Public pages take their language from the URL without saving it, so a
 * visitor reading /en in a Chinese browser would land in a Chinese product.
 * Carry the page language into the product on a conversion click, but never
 * override a language the visitor already chose.
 */
export function rememberPublicLocale(locale: Locale): void {
  if (getExplicitLocalePreference() === null) applyLocale(locale);
}

export type MarketingCtaSource = "landing" | "site_header" | "blog_post" | "tool" | "use_case" | "share";

export function TrackedCtaLink({
  href,
  sourceType,
  sourceSlug,
  sourceSurface = "content",
  ctaId,
  destination,
  locale,
  className,
  ariaLabel,
  audienceState,
  onClick,
  children
}: {
  href: string;
  sourceType: MarketingCtaSource;
  sourceSlug?: string;
  sourceSurface?: string;
  ctaId?: string;
  destination: string;
  locale: Locale;
  className?: string;
  ariaLabel?: string;
  audienceState?: "anonymous" | "authenticated";
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  const stableCtaId = ctaId ?? [sourceType, sourceSlug ?? "index", destination].join(":");

  return (
    <Link
      href={publicSiteHref(href)}
      className={className}
      aria-label={ariaLabel}
      onClick={(event) => {
        captureEvent("marketing_cta_clicked", {
          cta_id: stableCtaId,
          source_type: sourceType,
          ...(sourceSlug ? { source_slug: sourceSlug } : {}),
          source_surface: sourceSurface,
          destination,
          locale,
          ...(audienceState ? { audience_state: audienceState } : {})
        });
        rememberPublicLocale(locale);
        onClick?.(event);
      }}
    >
      {children}
    </Link>
  );
}
