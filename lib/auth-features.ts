/**
 * 手机号登录总开关（前端入口与 /api/auth/phone/* 共用）。
 * 当前关闭：Supabase 内置短信商对 +86 大陆号送达率不稳定，国内三网通道又需企业资质。
 * 关闭时后端短信接口返回 404，避免绕过前端直接调用产生短信费用；置 true 即整体恢复。
 */
export const PHONE_AUTH_ENABLED = false;
