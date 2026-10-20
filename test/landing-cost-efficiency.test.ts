import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("landing cost-and-efficiency story", () => {
  const landing = readFileSync(join(process.cwd(), "components/landing/LandingPage.tsx"), "utf8");

  it("keeps the AI employee brand while leading with the employee loop and human confirmation", () => {
    expect(landing).toContain('kicker: "你的第一位 AI 增长运营员工"');
    expect(landing).toContain('titleA: "增长骇客，"');
    expect(landing).toContain('titleEm: "为你打工。"');
    expect(landing).toContain('valuePoints: ["机会自动发现", "内容一次备好", "评论即时回复", "结果自动记录"]');
    expect(landing).toContain('primaryCta: "试做两份发布稿"');
    expect(landing).toContain('secondaryCta: "诊断我的账号"');
    expect(landing).toContain('const ACCOUNT_HEALTH_HREF = "/operations/account-health"');
    // Guests reach the private diagnosis route through signup, not the login wall.
    expect(landing).toContain('const memberHref = (target: string) => user ? target : buildAuthHref("/signup", target)');
    expect(landing).toContain('href={memberHref(ACCOUNT_HEALTH_HREF)}');
    expect(landing).toContain('ctaId="landing_hero_account_health" destination="account_health"');
  });

  it("sends guests to signup for paid plans and English applications straight to the application email", () => {
    expect(landing).toContain('return memberHref(`/billing?plan=${key}`)');
    expect(landing).toContain('getBillingPlanAcquisition(key, locale).kind === "application") return buildPlanApplicationHref(key, locale)');
    expect(landing).not.toContain('`/billing?plan=${item.plan}`');
  });

  it("never renders an empty self-link in blog workflow resources", () => {
    const blogView = readFileSync(join(process.cwd(), "components/blog/BlogPostView.tsx"), "utf8");
    expect(blogView).not.toContain('path: ""');
    expect(blogView).toContain('.filter((resource) => resource.path.startsWith("/"))');
  });

  it("places the current-cost calculator before the existing account-health story", () => {
    expect(landing.indexOf("<CurrentOpsCostCalculator")).toBeGreaterThan(-1);
    expect(landing.indexOf("<CurrentOpsCostCalculator")).toBeLessThan(
      landing.indexOf('id="account-health"')
    );
  });

  it("does not add an unsupported saving rate or change the pricing source", () => {
    const calculator = readFileSync(join(process.cwd(), "components/landing/CurrentOpsCostCalculator.tsx"), "utf8");
    const pricing = readFileSync(join(process.cwd(), "lib/pricing.ts"), "utf8");

    expect(calculator).not.toMatch(/efficiencySavingRate|65%|roiMultiple/i);
    expect(calculator).not.toContain("根据你提供的当前工作方式计算");
    expect(calculator).not.toContain("。");
    expect(calculator).toContain("可由 Finfold 替代的机构 / 小红书陪跑月费");
    expect(calculator).toContain("Finfold 每个月预计帮你省下");
    expect(calculator).toContain("你自己的时间");
    expect(pricing).toContain('price: { cn: 79, global: 12 }');
    expect(pricing).toContain('price: { cn: 199, global: 29 }');
    expect(pricing).toContain('price: { cn: 999, global: 149 }');
    expect(pricing).toContain('price: { cn: 2_999, global: 399 }');
  });
});
