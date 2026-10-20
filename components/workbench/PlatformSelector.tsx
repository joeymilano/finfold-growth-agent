"use client";
import React, { useState } from "react";
import { Check, ChevronDown } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n";
import { MAX_PLATFORMS_PER_GENERATION, platforms, type PlatformId } from "@/lib/platforms";
import { PlatformBrandIcon } from "./PlatformBrandIcon";

type PlatformSelectorProps = {
  value: PlatformId[]; onChange: (value: PlatformId[]) => void; locale: Locale;
  disabled?: boolean; maxSelection?: number;
};
const englishPlatformLabels: Record<PlatformId, string> = {
  wechat: "WeChat Official Account",
  xiaohongshu: "Xiaohongshu / RED",
  zhihu: "Zhihu",
  moments: "WeChat Moments",
  x: "X / Twitter",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  reddit: "Reddit",
  "product-hunt": "Product Hunt",
  threads: "Threads",
  "hacker-news": "Hacker News",
  "indie-hackers": "Indie Hackers",
  "medium-substack": "Newsletter / Substack"
};


export function PlatformSelector({ value, onChange, locale, disabled = false, maxSelection = MAX_PLATFORMS_PER_GENERATION }: PlatformSelectorProps) {
  const [expanded, setExpanded] = useState(false);
  const recommended: PlatformId[] = locale === "en"
    ? ["x", "linkedin", "instagram", "reddit", "xiaohongshu", "zhihu"]
    : ["xiaohongshu", "wechat", "moments", "zhihu", "x", "linkedin"];
  const ids = [...new Set([...value, ...recommended, ...platforms.map((platform) => platform.id)])];
  const visible = expanded ? ids : ids.slice(0, Math.max(6, value.length));
  const limitLabel = locale === "en" ? `Up to ${maxSelection} platforms` : `最多选择 ${maxSelection} 个平台`;
  return (
    <section className="workspace-platforms" aria-label={locale === "en" ? "Platforms" : "发布平台"}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{locale === "en" ? "Where to publish?" : "发到哪里？"}</h2>
        <span className="text-[11px] tabular-nums text-fg-muted" aria-live="polite" title={limitLabel}>{value.length} / {maxSelection}</span>
      </div>
      <div className="workspace-platform-options">
        {visible.map((id) => {
          const platform = platforms.find((item) => item.id === id)!;
          const selected = value.includes(id);
          const blocked = !selected && value.length >= maxSelection;
          const title = locale === "zh" ? platform.label : englishPlatformLabels[id];
          return <button type="button" key={id} data-testid={`platform-${id}`} data-platform={id}
            className="focus-ring workspace-platform-option" aria-pressed={selected} aria-label={title}
            disabled={disabled || blocked} title={blocked ? limitLabel : title}
            onClick={() => onChange(selected ? value.filter((item) => item !== id) : [...value, id])}>
            <PlatformBrandIcon platform={id} className="h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{locale === "en" && id === "xiaohongshu" ? "Xiaohongshu" : title}</span>
            {selected ? <Check className="h-3 w-3 shrink-0 text-action" /> : null}
          </button>;
        })}
      </div>
      <button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}
        className="focus-ring mt-2 flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[11px] text-fg-muted hover:bg-surface-2">
        {expanded ? (locale === "en" ? "Show less" : "收起") : (locale === "en" ? "More platforms" : "更多平台")}
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
    </section>
  );
}
