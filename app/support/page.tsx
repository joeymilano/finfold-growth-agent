import { isCnDeployment, CN_OPERATOR, CN_PRODUCT_NAME } from "@/lib/site-policy";
import type { Metadata } from "next";
import React from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { detectLocaleFromHeaders, type Locale } from "@/lib/i18n";
import { PublicSiteHeader } from "@/components/marketing/PublicSiteHeader";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { brand } from "@/lib/brand";

const supportEmail = brand.legal.contactEmail;

/**
 * The global page stays English by default (crawlers and app reviewers send no
 * language signal), and switches to Chinese only when the visitor's saved
 * language or browser language explicitly asks for it.
 */
async function resolveSupportLocale(): Promise<Locale> {
  const h = await headers();
  const hasSignal = /(?:^|;\s*)finfold-locale=(?:zh|en)/.test(h.get("cookie") ?? "") || Boolean(h.get("accept-language")?.trim());
  return hasSignal ? detectLocaleFromHeaders(h) : "en";
}

const supportCopy = {
  en: {
    metaTitle: "Support — Finfold",
    metaDescription: "Get help with Finfold accounts, content kits, billing, privacy, and the Finfold plugin for ChatGPT and Codex.",
    eyebrow: "Finfold support",
    title: "Tell us what stopped you",
    intro: "We help with accounts, saved content kits, billing, privacy requests, and the Finfold plugin for ChatGPT and Codex. We normally respond within two business days.",
    emailSubject: "Finfold support request",
    emailCta: `Email ${supportEmail}`,
    includeTitle: "Include in your message",
    include: ["The action you were trying to complete.", "The approximate time and the error message shown.", "Your browser or ChatGPT/Codex surface."],
    secretsTitle: "Keep secrets private",
    secretsBody: "Never email passwords, API keys, OAuth tokens, recovery codes, or private customer content. We will never ask for them.",
    assistantTitle: "Connected-assistant help",
    assistantBody: "If a Finfold connection stops working, revoke the connection in Finfold Settings and reconnect it from ChatGPT or Codex. Creating a content kit saves a private draft; it never publishes to a social account.",
    privacy: "Privacy Policy",
    terms: "Terms of Service"
  },
  zh: {
    metaTitle: "联系与支持 — Finfold",
    metaDescription: "Finfold 账户、内容包、账单、隐私请求，以及 ChatGPT 与 Codex 连接问题的支持渠道。",
    eyebrow: "Finfold 支持",
    title: "告诉我们哪里卡住了",
    intro: "我们可以协助处理账户、内容包、账单、隐私请求，以及 Finfold 在 ChatGPT 和 Codex 中的连接问题，通常会在两个工作日内回复。",
    emailSubject: "Finfold 支持请求",
    emailCta: `发送邮件：${supportEmail}`,
    includeTitle: "邮件里请写上",
    include: ["你当时想完成的操作。", "大致时间和页面上的报错提示。", "你使用的浏览器，或 ChatGPT / Codex 的哪个入口。"],
    secretsTitle: "不要发送敏感信息",
    secretsBody: "请不要在邮件里发送密码、API 密钥、OAuth 令牌、恢复码或客户的私密内容，我们也绝不会向你索要。",
    assistantTitle: "AI 助手连接问题",
    assistantBody: "如果 Finfold 连接失效，请在 Finfold 设置里撤销该连接，再从 ChatGPT 或 Codex 重新连接。创建内容包只会保存一份私密草稿，不会发布到任何社交账号。",
    privacy: "隐私政策",
    terms: "服务条款"
  }
} as const;

export async function generateMetadata(): Promise<Metadata> {
  if (isCnDeployment) {
    return {
      title: "联系与支持｜Finfold 内容助手",
      description: "账户、内容创作及隐私问题，请联系 Finfold 内容助手运营团队。",
      alternates: { canonical: "/support" }
    };
  }
  const c = supportCopy[await resolveSupportLocale()];
  return { title: c.metaTitle, description: c.metaDescription, alternates: { canonical: "/support" } };
}

export default async function SupportPage() {
  if (isCnDeployment) return (
    <div data-landing-style="almanac" data-workspace-theme data-workspace-canvas className="workspace-public flex min-h-screen flex-col">
      <PublicSiteHeader locale="zh" sticky />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:py-16">
        <p className="text-sm text-brand">{CN_PRODUCT_NAME}</p>
        <h1 className="mt-3 text-3xl font-bold">联系与支持</h1>
        <p className="mt-5 leading-7 text-fg-muted">账户、草稿编辑、账单或隐私方面的问题，可以通过邮件联系我们。请说明遇到的问题、发生时间及页面提示，便于排查。</p>
        <p className="mt-4 text-fg-muted">运营主体：{CN_OPERATOR}</p>
        <a href={`mailto:${supportEmail}?subject=${encodeURIComponent("Finfold 内容助手支持请求")}`} className="btn-primary focus-ring mt-8">发送邮件：{supportEmail}</a>
        <nav className="mt-10 flex gap-6 text-brand"><Link href="/privacy">隐私政策</Link><Link href="/terms">服务条款</Link></nav>
      </main>
      <SiteFooter locale="zh" />
    </div>
  );
  const locale = await resolveSupportLocale();
  const c = supportCopy[locale];
  const supportHref = `mailto:${supportEmail}?subject=${encodeURIComponent(c.emailSubject)}`;
  return (
    <div data-landing-style="almanac" data-workspace-theme data-workspace-canvas className="workspace-public flex min-h-screen flex-col">
      <PublicSiteHeader locale={locale} sticky hideLocaleToggle />

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          {c.eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          {c.title}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-muted sm:text-base">
          {c.intro}
        </p>

        <a
          href={supportHref}
          className="focus-ring mt-8 inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-bold text-on-brand transition hover:brightness-105"
        >
          {c.emailCta}
        </a>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          <section className="rounded-2xl border border-hairline bg-surface-raised p-5">
            <h2 className="text-base font-bold text-fg">{c.includeTitle}</h2>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-fg-muted">
              {c.include.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          </section>
          <section className="rounded-2xl border border-hairline bg-surface-raised p-5">
            <h2 className="text-base font-bold text-fg">{c.secretsTitle}</h2>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">{c.secretsBody}</p>
          </section>
        </div>

        <section className="mt-10 border-t border-hairline pt-8">
          <h2 className="text-base font-bold text-fg">{c.assistantTitle}</h2>
          <p className="mt-3 text-sm leading-relaxed text-fg-muted">{c.assistantBody}</p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            <Link href="/privacy" className="focus-ring rounded text-brand hover:underline">
              {c.privacy}
            </Link>
            <Link href="/terms" className="focus-ring rounded text-brand hover:underline">
              {c.terms}
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter locale={locale} />
    </div>
  );
}
