"use client";

import Link from "next/link";
import { isCnDeployment, publicSiteHref, CN_PRODUCT_NAME, CN_DESCRIPTION, CN_OPERATOR } from "@/lib/site-policy";
import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ClipboardPaste, Image as ImageIcon, Radar, RefreshCcw, Rocket, ShieldCheck } from "@/components/ui/icons";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { LandingHeroVideo } from "@/components/landing/LandingHeroVideo";
import { CurrentOpsCostCalculator } from "@/components/landing/CurrentOpsCostCalculator";
import { PublicSiteHeader } from "@/components/marketing/PublicSiteHeader";
import { MarketingResourceLink } from "@/components/marketing/MarketingResourceLink";
import { TrackedCtaLink, rememberPublicLocale } from "@/components/marketing/TrackedCtaLink";
import { PlatformGlyph } from "@/components/workbench/PlatformBrandIcon";
import { ENTERPRISE_SECTION, PLAN_SCENARIOS, PRICING_PLAN_ORDER, PRICING_PLANS, buildEnterpriseContactHref, formatPlanPrice, getLocalizedPlanCopy, marketForLocale } from "@/lib/pricing";
import { platforms, getLocalizedPlatformLabel } from "@/lib/platforms";
import { getStoredLocale } from "@/lib/theme";
import type { Locale } from "@/lib/i18n";
import { captureEvent } from "@/lib/posthog";
import { toolPages } from "@/lib/tool-pages";
import { getLandingFeaturedBlogPosts } from "@/lib/blog-posts";
import { PLAN_CREDITS } from "@/lib/payment/types";
import { usePublicAuthUser } from "@/components/marketing/LandingUserAvatar";
import { buildAuthHref } from "@/lib/auth-return";
import { buildPlanApplicationHref, getBillingPlanAcquisition } from "@/lib/billing-plan-acquisition";

const APP_ENTRY_HREF = "/workbench?start=1";
const ACCOUNT_HEALTH_HREF = "/operations/account-health";
const copy = {
  zh: {
    hero: {
      kicker: "你的第一位 AI 增长运营员工",
      titleA: "它盯住你的增长",
      titleEm: "每一步都经你确认",
      sub: "一段更新，变成两份发布稿。\n贴入内容，选择平台，检查后即可使用。",
      valuePoints: ["机会自动发现", "内容一次备好", "评论即时回复", "结果自动记录"],
      primaryCta: "试做两份发布稿",
      secondaryCta: "诊断我的账号"
    },
    productTitle: "把下一步，准备好",
    productBody: "内容、品牌和结果，在同一个工作台。",
    features: [
      ["发现机会", "围绕你的业务，找到值得回应的内容信号。"],
      ["准备内容", "一份材料，生成适合不同平台的文案和图片。"],
      ["记住品牌", "保存语气、受众和规则，减少重复交代。"],
      ["跟进结果", "记录发布数据，继续优化下一轮内容。"]
    ],
    flowTitle: "从一段更新开始",
    flow: [
      ["贴上材料", "产品更新、文章、反馈，或一个想法。"],
      ["选择平台", "生成各个平台适合的文案和图片。"],
      ["检查，再发布", "直接编辑草稿，确认后导出或交接。"]
    ],
    healthTitle: "流量变少，先查清楚",
    healthBody: "结合账号数据、内容与平台规则，区分风险和已有证据。",
    healthCta: "打开账号诊断",
    toolsTitle: "选个平台，试一次",
    notesTitle: "增长笔记",
    pricingTitle: "从免费开始",
    pricingSub: "每月 50 创作点数，需要更多时再升级。",
    finalTitle: "你的下一条更新，准备好了吗？"
  },
  en: {
    hero: {
      kicker: "YOUR FIRST AI MARKETING EMPLOYEE",
      titleA: "It watches your growth",
      titleEm: "You approve every step",
      sub: "One update. Two drafts ready to review.\nBring your content, choose your channels, and make it yours.",
      valuePoints: ["Opportunities surfaced", "Drafts ready to ship", "Comments answered", "Results recorded"],
      primaryCta: "Create two drafts",
      secondaryCta: "Diagnose my account"
    },
    productTitle: "Your next step, ready",
    productBody: "Content, brand context, and results in one workspace.",
    features: [
      ["Find opportunities", "Discover content signals that matter to your business."],
      ["Prepare content", "Turn one source into native copy and visuals for each channel."],
      ["Remember your brand", "Save your voice, audience, and rules once."],
      ["Follow the results", "Record performance and improve the next round."]
    ],
    flowTitle: "Start with one update",
    flow: [
      ["Bring your source", "A product update, article, customer note, or idea."],
      ["Choose channels", "Prepare copy and visuals for each platform."],
      ["Review, then publish", "Edit the drafts, then export or hand them off."]
    ],
    healthTitle: "Less reach? Find out why",
    healthBody: "Review account data, content, and platform rules. Separate risks from evidence.",
    healthCta: "Open account diagnosis",
    toolsTitle: "Choose a channel — try it",
    notesTitle: "Growth field notes",
    pricingTitle: "Start free",
    pricingSub: "50 Credits a month. Upgrade when you need more.",
    finalTitle: "Ready for your next update?"
  }
} as const;
const featureIcons = [Radar, ImageIcon, ShieldCheck, RefreshCcw];
const flowIcons = [ClipboardPaste, ImageIcon, Rocket];

export function LandingPage({ initialLocale, localeHref }: { initialLocale?: Locale; localeHref?: string } = {}) {
  const [locale, setLocale] = useState<Locale>(initialLocale ?? "zh");
  const [scrolled, setScrolled] = useState(false);
  const pricingRef = useRef<HTMLElement>(null);
  const pricingTracked = useRef(false);
  // Private routes bounce guests to /login; send them to signup with the
  // destination (and any plan intent) carried in `next` instead.
  const { user } = usePublicAuthUser();
  const memberHref = (target: string) => user ? target : buildAuthHref("/signup", target);
  const planHref = (key: (typeof PRICING_PLAN_ORDER)[number]) => {
    if (key === "free") return APP_ENTRY_HREF;
    if (getBillingPlanAcquisition(key, locale).kind === "application") return buildPlanApplicationHref(key, locale);
    return memberHref(`/billing?plan=${key}`);
  };
  useEffect(() => {
    if (!initialLocale) setLocale(getStoredLocale());
    captureEvent("landing_view", { contentType: "landing", locale: initialLocale ?? getStoredLocale(), path: window.location.pathname });
    const onLocaleChange = (event: Event) => { if (!initialLocale) setLocale((event as CustomEvent<Locale>).detail); };
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("finfold-locale-change", onLocaleChange);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { window.removeEventListener("finfold-locale-change", onLocaleChange); window.removeEventListener("scroll", onScroll); };
  }, [initialLocale]);
  useEffect(() => {
    const node = pricingRef.current;
    if (!node || pricingTracked.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || pricingTracked.current) return;
      pricingTracked.current = true;
      captureEvent("pricing_viewed", { locale, market: marketForLocale(locale), currency: locale === "en" ? "USD" : "CNY", billing_period: "monthly", source_page: "landing", is_existing_user: false });
      observer.disconnect();
    }, { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [locale]);
  const c = isCnDeployment ? { ...copy.zh, hero: { ...copy.zh.hero, kicker: CN_PRODUCT_NAME, titleA: "把想法写成草稿", titleEm: "检查后，再发布", valuePoints: ["整理选题", "准备草稿", "编辑内容", "复制导出"] }, productTitle: CN_PRODUCT_NAME, productBody: CN_DESCRIPTION } : copy[locale];
  const en = locale === "en";
  const prefix = en ? "/en" : "";
  const market = marketForLocale(locale);

  return <>
    <main data-workspace-theme data-workspace-canvas className="workspace-public workspace-landing min-h-screen text-fg">
      <PublicSiteHeader locale={locale} localeHref={localeHref} trialEntry sticky scrolled={scrolled} />
      <section className="workspace-landing-hero text-center">
        <LandingHeroVideo locale={locale} />
        <div className="workspace-hero-content mx-auto max-w-6xl px-5">
        <p className="workspace-hero-kicker">{c.hero.kicker}</p>
        <h1 className="mt-6 text-balance">{c.hero.titleA}<br /><span className="text-fg-muted">{c.hero.titleEm}</span></h1>
        <p className="mx-auto mt-6 max-w-xl whitespace-pre-line text-base leading-7 text-fg-muted">{c.hero.sub}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <TrackedCtaLink href={APP_ENTRY_HREF} sourceType="landing" sourceSurface="hero" ctaId="landing_hero_first_task" destination="workbench" locale={locale} className="btn-primary focus-ring min-h-12 px-6">{c.hero.primaryCta}<ArrowRight className="h-4 w-4" /></TrackedCtaLink>
          <TrackedCtaLink href={memberHref(ACCOUNT_HEALTH_HREF)} sourceType="landing" sourceSurface="hero" ctaId="landing_hero_account_health" destination="account_health" locale={locale} className="btn-ghost focus-ring min-h-12 px-5">{c.hero.secondaryCta}</TrackedCtaLink>
        </div>
        <p className="mt-4 text-xs text-fg-muted">{en ? `${PLAN_CREDITS.free} free monthly Credits · No card required` : `免费账户每月 ${PLAN_CREDITS.free} 点 · 无需银行卡`}</p>
        <div className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-x-7 gap-y-3 text-xs text-fg-muted">
          {c.hero.valuePoints.map(point => <span key={point} className="inline-flex items-center gap-2"><Check className="h-3.5 w-3.5 text-action" />{point}</span>)}
        </div>
        </div>
      </section>
      <section id="product" className="workspace-public-section mx-auto max-w-6xl px-5">
        <div className="workspace-feature-stage">
          <div className="workspace-public-section-heading"><h2>{c.productTitle}</h2><p>{c.productBody}</p>{isCnDeployment ? <p>运营主体：{CN_OPERATOR}</p> : null}</div>
          {en ? <p className="mb-6 text-sm text-fg-muted"><Link href="/en/learn/what-is-an-ai-marketing-agent" className="focus-ring underline underline-offset-4">What is an AI marketing agent?</Link> See the workflow, examples, and human approval boundaries.</p> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {c.features.map(([title,body],i) => { const Icon = featureIcons[i];return <article key={title} className="workspace-feature-card"><Icon className="h-5 w-5 text-action" /><h3 className="mt-5 text-base font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-fg-muted">{body}</p></article>; })}
          </div>
          <div className="mt-7 flex flex-wrap justify-center gap-2">
            {platforms.map(platform => <span key={platform.id} className="workspace-platform-chip"><PlatformGlyph platform={platform.id} className="h-3.5 w-3.5" />{getLocalizedPlatformLabel(platform.id, locale)}</span>)}
          </div>
        </div>
      </section>
      <section className="workspace-public-section mx-auto max-w-6xl px-5">
        <div className="workspace-public-section-heading"><h2>{c.flowTitle}</h2></div>
        <div className="grid gap-4 md:grid-cols-3">
          {c.flow.map(([title,body],i) => { const Icon=flowIcons[i];return <article key={title} className="panel p-6"><div className="flex items-center justify-between"><Icon className="h-5 w-5 text-action" /><span className="text-xs tabular-nums text-fg-muted">0{i+1}</span></div><h3 className="mt-6 text-lg font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-fg-muted">{body}</p></article>; })}
        </div>
      </section>
      <CurrentOpsCostCalculator locale={locale} />
      <section id="account-health" className="workspace-public-section mx-auto max-w-6xl px-5">
        <div className="panel flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:justify-between sm:p-9">
          <div className="max-w-xl"><h2 className="text-2xl font-medium tracking-tight">{c.healthTitle}</h2><p className="mt-3 text-sm leading-6 text-fg-muted">{c.healthBody}</p></div>
          <TrackedCtaLink href={memberHref(ACCOUNT_HEALTH_HREF)} sourceType="landing" sourceSurface="account_health" ctaId="landing_account_health" destination="account_health" locale={locale} className="btn-ghost focus-ring shrink-0">{c.healthCta}<ArrowRight className="h-4 w-4" /></TrackedCtaLink>
        </div>
      </section>
      <section id="free-tools" className="workspace-public-section mx-auto max-w-6xl px-5">
        <div className="workspace-public-section-heading"><h2>{c.toolsTitle}</h2><Link href={publicSiteHref(`${prefix}/tools`)} className="text-sm text-fg-muted hover:text-fg">{en ? "All tools" : "所有工具"}<ArrowRight className="ml-2 inline h-4 w-4" /></Link></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {toolPages.slice(0,6).map(tool => <MarketingResourceLink key={tool.slug} href={`${prefix}/tools/${tool.slug}`} resourceType="tool" slug={tool.slug} surface="landing" locale={locale} className="panel focus-ring flex items-center gap-4 p-5"><PlatformGlyph platform={tool.platform} className="h-5 w-5 shrink-0 text-action" /><span className="min-w-0 flex-1 text-sm font-medium">{en ? tool.titleEn : tool.titleZh}</span><ArrowRight className="h-4 w-4 shrink-0 text-fg-muted" /></MarketingResourceLink>)}
        </div>
      </section>
      <section ref={pricingRef} id="pricing" className="workspace-public-section mx-auto max-w-[1440px] px-5">
        <div className="workspace-public-section-heading"><div><h2>{c.pricingTitle}</h2><p>{c.pricingSub}</p></div></div>
        <nav aria-label={en ? "Choose a plan" : "套餐快捷入口"} className="mb-5 flex gap-2 overflow-x-auto pb-2 xl:hidden">
          {PRICING_PLAN_ORDER.map(key => <a key={key} href={`#plan-${key}`} className="workspace-platform-chip focus-ring shrink-0 whitespace-nowrap hover:text-fg">{PRICING_PLANS[key].copy[locale].name}<span className="tabular-nums text-fg">{formatPlanPrice(PRICING_PLANS[key], market)}</span></a>)}
        </nav>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {PRICING_PLAN_ORDER.map(key => { const plan=PRICING_PLANS[key];const planCopy=getLocalizedPlanCopy(key,locale);const href=planHref(key);const ctaLabel=key !== "free" && href.startsWith("mailto:") ? getBillingPlanAcquisition(key,locale).cta : planCopy.cta;const onPlanClick=() => { captureEvent("pricing_plan_cta_clicked", {locale,market,currency:plan.currency[market],plan_key:key,billing_period:"monthly",price:plan.price[market],source_page:"landing",is_existing_user:false}); rememberPublicLocale(locale); };const planCtaClass=`focus-ring mb-2 mt-5 min-h-11 ${plan.highlighted ? "btn-primary" : "btn-ghost"}`; return <article key={key} id={`plan-${key}`} className={`panel relative flex scroll-mt-28 flex-col p-6 ${plan.highlighted ? "workspace-plan-featured" : ""}`}>
            <div className="flex min-h-8 items-center justify-between gap-2"><h3 className="text-base font-medium">{planCopy.name}</h3>{plan.highlighted ? <span className="rounded-full bg-brand px-2 py-1 text-[10px] text-on-brand">{planCopy.badge}</span> : null}</div>
            <p className="mt-5 text-3xl font-medium tracking-tight tabular-nums">{formatPlanPrice(plan,market)}<span className="ml-1 text-xs font-normal text-fg-muted">/{en ? "mo" : "月"}</span></p>
            <p className="mt-3 text-xs font-medium text-action">{planCopy.allowance}</p>
            {href.startsWith("mailto:") ? <a href={href} aria-label={`${ctaLabel} — ${planCopy.name}`} onClick={onPlanClick} className={planCtaClass}>{ctaLabel}</a> : <Link href={publicSiteHref(href)} aria-label={`${ctaLabel} — ${planCopy.name}`} onClick={onPlanClick} className={planCtaClass}>{ctaLabel}</Link>}
            <p className="mt-2 text-xs leading-5 text-fg-muted">{planCopy.description}</p>
            <ul className="my-6 grid gap-3">{planCopy.features.map(feature => <li key={feature} className="flex gap-2 text-xs leading-5 text-fg-muted"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-action" /><span>{feature}</span></li>)}</ul>
            {planCopy.exclusions?.length ? <details className="mb-5 text-xs text-fg-muted"><summary className="cursor-pointer">{en ? "Not included" : "暂不包含"}</summary><ul className="mt-3 grid gap-2">{planCopy.exclusions.map(item => <li key={item}>{item}</li>)}</ul></details> : null}
          </article>; })}
        </div>
        <details className="workspace-disclosure mt-6 rounded-2xl border border-hairline p-5">
          <summary className="cursor-pointer text-sm font-medium">{en ? "Help me choose a plan" : "帮我选一个套餐"}</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{PLAN_SCENARIOS[locale].map(item => { const href = planHref(item.plan); const body = <><p className="text-fg-muted">{item.scenario}</p><p className="mt-3 font-medium">{PRICING_PLANS[item.plan].copy[locale].name}<ArrowRight className="ml-2 inline h-3.5 w-3.5" /></p></>; return href.startsWith("mailto:") ? <a key={item.plan} href={href} className="focus-ring rounded-xl bg-surface/70 p-4 text-sm">{body}</a> : <Link key={item.plan} href={publicSiteHref(href)} onClick={() => rememberPublicLocale(locale)} className="focus-ring rounded-xl bg-surface/70 p-4 text-sm">{body}</Link>; })}</div>
        </details>
        <div id="enterprise" className="panel mt-6 flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="text-lg font-medium">{ENTERPRISE_SECTION[locale].title}</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">{ENTERPRISE_SECTION[locale].subtitle}</p><p className="mt-3 text-xs text-fg-muted">{ENTERPRISE_SECTION[locale].note}</p></div>
          <a href={buildEnterpriseContactHref(locale)} className="btn-ghost focus-ring shrink-0" onClick={() => captureEvent("pricing_plan_cta_clicked", {locale,market,plan_key:"enterprise",source_page:"landing",is_existing_user:false})}>{ENTERPRISE_SECTION[locale].cta}<ArrowRight className="h-4 w-4" /></a>
        </div>
      </section>
      <section className="workspace-public-section mx-auto max-w-6xl px-5">
        <div className="workspace-public-section-heading"><h2>{c.notesTitle}</h2><Link href={`${prefix}/blog`} className="text-sm text-fg-muted hover:text-fg">{en ? "All notes" : "所有笔记"}<ArrowRight className="ml-2 inline h-4 w-4" /></Link></div>
        <div className="grid gap-4 md:grid-cols-3">{getLandingFeaturedBlogPosts().slice(0,3).map(post => <MarketingResourceLink key={post.slug} href={`${prefix}/blog/${post.slug}`} resourceType="blog" slug={post.slug} surface="landing" locale={locale} className="panel focus-ring p-6"><p className="text-sm font-medium leading-6">{en ? post.titleEn : post.titleZh}</p><ArrowRight className="mt-5 h-4 w-4 text-fg-muted" /></MarketingResourceLink>)}</div>
      </section>
      <section className="workspace-public-section mx-auto max-w-4xl px-5 pb-24 text-center"><h2 className="text-balance text-3xl font-medium tracking-tight">{c.finalTitle}</h2><TrackedCtaLink href={APP_ENTRY_HREF} sourceType="landing" sourceSurface="final_cta" ctaId="landing_closing_primary" destination="workbench" locale={locale} className="btn-primary focus-ring mt-7 min-h-12 px-6">{c.hero.primaryCta}<ArrowRight className="h-4 w-4" /></TrackedCtaLink></section>
    </main>
    <SiteFooter locale={locale} />
  </>;
}
