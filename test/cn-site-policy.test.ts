import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/supabase", () => ({ hasSupabaseConfig: vi.fn(() => true), createSupabaseAdminClient: vi.fn(), createSupabaseServerClient: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
async function domestic() {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.finfold.cn");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.resetModules();
}
describe("domestic deployment policy", () => {
  it("ignores saved English without overwriting the preference", async () => {
    await domestic();
    const store = { getItem: () => 'en', setItem: vi.fn() };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: store });
    const { getStoredLocale, applyLocale } = await import('@/lib/theme');
    expect(getStoredLocale()).toBe('zh');
    applyLocale('en');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(store.setItem).not.toHaveBeenCalled();
    const { POST } = await import('@/app/api/settings/locale/route');
    expect((await POST(new Request('https://www.finfold.cn/api/settings/locale', { method: 'POST', body: JSON.stringify({ locale: 'en' }) }))).status).toBe(200);
    const { createSupabaseAdminClient } = await import('@/lib/supabase');
    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
  });
  it("keeps English browsers Chinese, redirects mirrors, returns 404 for English-only content", async () => {
    await domestic();
    const { middleware } = await import('@/middleware');
    const root = await middleware(new NextRequest('https://www.finfold.cn/', { headers: { 'accept-language': 'en-US' } }));
    expect(root.headers.get('location')).toBeNull();
    expect(root.headers.get('content-language')).toBe('zh-CN');
    const mirror = await middleware(new NextRequest('https://www.finfold.cn/en/blog/example?x=1'));
    expect(mirror.status).toBe(308);
    expect(mirror.headers.get('location')).toBe('https://www.finfold.cn/blog/example?x=1');
    const englishOnly = await middleware(new NextRequest('https://www.finfold.cn/en/compare/example'));
    expect(englishOnly.status).toBe(404);
    expect(await englishOnly.text()).toContain('页面不存在');
  });
  it("emits accurate branding and only Chinese sitemap URLs/alternates", async () => {
    await domestic();
    const { brand } = await import('@/lib/brand');
    const { default: sitemap } = await import('@/app/sitemap');
    const { CN_SITE_ICP } = await import('@/lib/site-policy');
    expect(brand.name).toBe('Finfold 内容助手');
    expect(brand.legal.entity).toBe('上海光有序科技有限公司');
    expect(CN_SITE_ICP).toBe('沪ICP备2026051039号-1');
    const map = sitemap();
    expect(map.length).toBeGreaterThan(5);
    expect(JSON.stringify(map)).not.toContain('finfold.cn/en');
    expect(map.every((e) => e.url.startsWith('https://www.finfold.cn/'))).toBe(true);
  });
  it("preserves global branding and English negotiation on .app", async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL','https://www.finfold.app'); vi.resetModules();
    const { brand } = await import('@/lib/brand');
    expect(brand.name).toBe('Finfold');
    const { middleware } = await import('@/middleware');
    expect((await middleware(new NextRequest('https://www.finfold.app/', { headers: { 'accept-language':'en-US' } }))).headers.get('location')).toBe('https://www.finfold.app/en');
  });
  it("keeps the public launch on Chinese content and sends product actions to the existing app", async () => {
    await domestic();
    vi.stubEnv('NEXT_PUBLIC_CN_PUBLIC_ONLY','true'); vi.resetModules();
    const { publicSiteHref } = await import('@/lib/site-policy');
    expect(publicSiteHref('/workbench?start=1')).toBe('https://www.finfold.app/workbench?start=1');
    expect(publicSiteHref('/billing?plan=creator')).toBe('https://www.finfold.app/billing?plan=creator');
    expect(publicSiteHref('/tools')).toBe('https://www.finfold.app/tools');
    expect(publicSiteHref('/privacy')).toBe('/privacy');
    expect(publicSiteHref('/blog/example')).toBe('/blog/example');
    expect(publicSiteHref('#pricing')).toBe('#pricing');
    const { default: sitemap } = await import('@/app/sitemap');
    expect(sitemap().some(e=>e.url.includes('/tools')||e.url.includes('/extension'))).toBe(false);
  });
});
