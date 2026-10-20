import Link from "next/link";
import React from "react";
import { marketingExampleSource, marketingExampleOutputs } from "@/lib/marketing-example";

export function SourceToDraftExample({ locale, platforms }: {
  locale: "zh" | "en";
  platforms: Array<keyof typeof marketingExampleOutputs>;
}) {
  const en = locale === "en";
  return <details className="rounded-2xl border border-hairline bg-surface p-5 sm:p-7">
    <summary className="focus-ring cursor-pointer text-sm font-semibold text-fg">{en ? "See a real source and example drafts" : "先看一份真实材料与改写示范"}</summary>
    <p className="mt-4 text-xs leading-6 text-fg-muted">{en ? "Finfold product facts, with manually prepared editorial examples. These are not a customer testimonial or a live generation. Opening this example uses no Credits and does not fill your draft." : "材料来自 Finfold 已有的草稿保存功能，输出为人工编写的改写示范，不代表客户案例或本次 AI 生成。查看不扣点，也不会填入你的草稿。"}</p>
    <div className="mt-5 border-l-2 border-brand pl-4"><h3 className="text-sm font-semibold">{en ? "Source" : "原材料"}</h3><p className="mt-2 text-sm leading-7 text-fg-muted">{marketingExampleSource[locale]}</p></div>
    <div className="mt-5 grid gap-5 sm:grid-cols-2">{platforms.map(platform => {
      const example = marketingExampleOutputs[platform];
      return <article key={platform} className="rounded-xl border border-hairline p-4"><p className="eyebrow-mono text-brand">{platform}</p><h3 className="mt-3 text-sm font-semibold">{example.title}</h3><p className="mt-3 whitespace-pre-line text-sm leading-7 text-fg-muted">{example.body}</p><p className="mt-4 text-xs leading-6 text-fg-muted">{en ? example.noteEn : example.noteZh}</p></article>;
    })}</div>
    <p className="mt-5 text-xs leading-6 text-fg-muted">{en ? "Review facts, language, platform rules, and permissions before copying a draft. Nothing publishes automatically. " : "复制使用前，核对事实、语言、平台规则与素材权限。内容不会自动发布。"}<Link href={en ? "/en/guide" : "/guide"} className="underline underline-offset-4">{en ? "Read the product guide" : "查看使用手册"}</Link></p>
  </details>;
}
