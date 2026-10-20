/** Deployment policy, baked identically into server and client bundles. */
export const isCnDeployment = /^https?:\/\/(www\.)?finfold\.cn(?::\d+)?\/?$/.test(
  process.env.NEXT_PUBLIC_APP_URL ?? ""
);
export const isCnPublicOnly = isCnDeployment && process.env.NEXT_PUBLIC_CN_PUBLIC_ONLY === "true";
export function isCnPublicPath(path: string): boolean {
  return path === "/" || /^\/(?:blog|use-cases)(?:\/|$)/.test(path)
    || /^\/(?:guide|privacy|terms|refund|support)\/?$/.test(path);
}
/** Public CN pages keep their own URLs; product actions use the existing app. */
export function publicSiteHref(href: string): string {
  if (!isCnPublicOnly || !href.startsWith("/") || href.startsWith("//")) return href;
  return isCnPublicPath(href.split(/[?#]/)[0]) ? href : `https://www.finfold.app${href}`;
}
export const CN_SITE_ICP = "沪ICP备2026051039号-1";
export const CN_OPERATOR = "上海光有序科技有限公司";
export const CN_PRODUCT_NAME = "Finfold 内容助手";
export const CN_DESCRIPTION = "面向内容创作者与小团队的内容创作工具：整理选题、准备和编辑公众号等平台的草稿，由用户检查确认后使用。";
export function siteLanguages<T extends Record<string, string>>(languages: T): Record<string, string> {
  return isCnDeployment ? { "zh-CN": languages["zh-CN"], "x-default": languages["zh-CN"] } : languages;
}
