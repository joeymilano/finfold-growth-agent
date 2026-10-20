/* eslint-disable @typescript-eslint/no-explicit-any -- VM page fixtures intentionally execute the untyped WeChat runtime. */
// @vitest-environment node
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { publicOpportunitySnapshot } from "@/lib/weapp/sharing";

function loadTs(file: string, globals: Record<string, unknown>) {
  const context = createContext({ exports: {}, console, setTimeout, clearTimeout, ...globals });
  runInContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 } }).outputText, context);
  return context;
}
function client(respond: (data: any) => unknown) {
  const storage = new Map<string, string>();
  const call = vi.fn(({ data, success }: any) => queueMicrotask(() => success({ result: respond(data) })));
  const context = loadTs("apps/weapp/miniprogram/utils/api.ts", {
    wx: { cloud: { callFunction: call }, getStorageSync: (k: string) => storage.get(k), setStorageSync: (k: string, v: string) => storage.set(k, v), removeStorageSync: (k: string) => storage.delete(k) }
  });
  return { api: context.exports.api, call, storage };
}
function page(file: string, api: any = {}) {
  let definition: any;
  const app = { globalData: { pendingDraft: null as any, profileDirty: false } };
  const wx = { hideShareMenu: vi.fn(), showShareMenu: vi.fn(), showToast: vi.fn(), navigateBack: vi.fn(), switchTab: vi.fn(), vibrateShort: vi.fn() };
  loadTs(file, {
    Page: (value: unknown) => { definition = value; }, wx,
    require: (name: string) => name.endsWith('/api') ? { api } : name.endsWith('/global-data') ? { getFinfoldApp: () => app } : { platformLabel: (p: string) => p, timeAgo: () => '', lifecycleLabel: () => '', lifecycleClass: () => '', truncate: (s: string) => s }
  });
  definition.setData = (next: any) => Object.assign(definition.data, next);
  return { definition, app, wx };
}

describe("actual mini program client contract", () => {
  it("keeps edits made during profile loading and allows clearing the optional audience", async () => {
    let resolveMe: (data: any) => void = () => {};
    const api = { getMe: () => new Promise(r=>{resolveMe=r;}), patchMe: vi.fn(async (body: any)=>{ void body; return {ok:true}; }) };
    const { definition:p }=page('apps/weapp/miniprogram/pages/me/index.ts',api);
    const loading=p.loadMe();
    p.onBusinessInput({detail:{value:'新的业务介绍'}});
    resolveMe({credits:200,business:'旧的业务介绍',audience:'旧受众',platform:'wechat'});
    await loading;
    expect(p.data.business).toBe('新的业务介绍');
    p.data.audience='';
    await p.saveProfile();
    expect(api.patchMe.mock.calls[0][0]).toMatchObject({business:'新的业务介绍',audience:''});
  });
  it("unwraps a successful flat bridge response and shares concurrent login", async () => {
    const { api, call } = client((d) => d.op === 'login' ? { ok: true, status: 200, data: { token: 't' } } : { ok: true, status: 200, data: { credits: 197 } });
    const responses = await Promise.all([api.getMe(), api.getMe()]);
    expect(responses).toEqual([{ credits: 197 }, { credits: 197 }]);
    expect(call.mock.calls.filter(([c]) => c.data.op === 'login')).toHaveLength(1);
  });
  it("refreshes an expired token once, including concurrent 401s", async () => {
    const { api, call, storage } = client((d) => d.op === 'login' ? { ok: true, data: { token: 'fresh' } } : d.token === 'stale' ? { ok: false, status: 401, data: { error: 'unauthorized' } } : { ok: true, status: 200, data: { credits: 42 } });
    storage.set('ff_weapp_token', 'stale');
    expect(await Promise.all([api.getMe(), api.getMe()])).toEqual([{ credits: 42 }, { credits: 42 }]);
    expect(call.mock.calls.filter(([c]) => c.data.op === 'login')).toHaveLength(1);
  });
  it("retains upstream failure text and does not loop on 401", async () => {
    const { api, call } = client((d) => d.op === 'login' ? { ok: true, data: { token: 't' } } : { ok: false, status: 401, data: { error: '登录已失效' } });
    await expect(api.getMe()).rejects.toMatchObject({ message: '登录已失效', status: 401 });
    expect(call.mock.calls).toHaveLength(4);
  });
  it("retains selected angle/keywords and ignores late polling after hiding", async () => {
    let resolveDraft: (d: any) => void = () => {};
    const api = { getMe: async () => ({ credits: 197 }), createDraft: vi.fn(async (body: any) => { void body; return { id: 'draft', available: 197 }; }), getDraft: () => new Promise((r) => { resolveDraft = r; }) };
    const { definition: p, app } = page('apps/weapp/miniprogram/pages/draft/index.ts', api);
    app.globalData.pendingDraft = { source: 'opportunity', opportunityId: 'opp', platform: 'moments', topic: { title: '选题标题', fact: '事实', angle: '独立开发者的角度', keywords: ['AI'] } };
    p.consumePendingDraft();
    vi.useFakeTimers();
    try {
      await p.generate();
      expect(api.createDraft.mock.calls[0][0].topic).toMatchObject({ angle: '独立开发者的角度', keywords: ['AI'] });
      await vi.advanceTimersByTimeAsync(2500);
      p.onHide();
      resolveDraft({ status: 'ready', content: '旧返回' });
      await Promise.resolve();
      expect(p.data.currentDraft).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("accepts a short QR scene without leaking a sender ID into generation", async () => {
    const token = 'abcdefghijklmnopqrstuv';
    const api = { getShare: vi.fn(async () => ({ title: '公开选题', fact: '公开事实', evidence: [], lastSeenAt: '' })) };
    const { definition: p, app } = page('apps/weapp/miniprogram/pages/radar/detail.ts', api);
    p.onLoad({ scene: encodeURIComponent(`s=${token}`) });
    await vi.waitFor(() => expect(p.data.loaded).toBe(true));
    expect(api.getShare).toHaveBeenCalledWith(token);
    p.goDraft();
    expect(app.globalData.pendingDraft.source).toBe('free');
    expect(app.globalData.pendingDraft.opportunityId).toBeUndefined();
    expect(p.onShareAppMessage().path).toContain(`?s=${token}`);
    expect(p.onShareAppMessage().imageUrl).toBe('/assets/share.png');
  });
  it("does not share personalized fields", () => {
    const shared = publicOpportunitySnapshot({ title: '公开标题', fact: '事实', whyYou: '客户秘密', mainAngle: '品牌策略', matchScore: 99, keywords: ['内部品牌'], evidence: [], lastSeenAt: '' } as any);
    expect(Object.keys(shared).sort()).toEqual(['evidence','fact','lastSeenAt','title']);
    expect(JSON.stringify(shared)).not.toMatch(/客户秘密|品牌策略|内部品牌|99/);
  });
});

function bridge() {
  const urls: string[] = [];
  const cloud = { init: vi.fn(), getWXContext: () => ({ OPENID: 'openid' }), openapi: { wxacode: { getUnlimited: vi.fn() } } };
  const https = { request: (options: any, callback: any) => {
    urls.push(options.path);
    const req = { on: () => req, write: () => {}, end: () => {
      const handlers: any = {};
      callback({ statusCode: 200, on: (event: string, cb: any) => { handlers[event] = cb; } });
      handlers.data(Buffer.from(JSON.stringify(options.path.endsWith('/session') ? { token: 't' } : { opportunities: [] })));
      handlers.end();
    } };
    return req;
  } };
  const context = createContext({ exports: {}, URL, Buffer, process: { env: { FINFOLD_API_BASE: 'https://www.finfold.app', WEAPP_BRIDGE_SECRET: 'test' } }, require: (name: string) => name === 'https' ? https : cloud });
  runInContext(readFileSync('apps/weapp/cloudfunctions/bridge/index.js', 'utf8'), context);
  return { main: context.exports.main, urls, cloud };
}
describe("actual cloud bridge forwarding", () => {
  it("allows radar query params and forwards AI skill window", async () => {
    const b = bridge();
    expect((await b.main({ op: 'call', path: '/api/weapp/v1/opportunities?window=7d&limit=8' })).ok).toBe(true);
    expect((await b.main({ op: 'skillCall', path: '/api/weapp/v1/opportunities', query: { window: '7d', limit: 5 } })).ok).toBe(true);
    expect(b.urls).toEqual(['/api/weapp/v1/opportunities?window=7d&limit=8','/api/weapp/v1/session','/api/weapp/v1/opportunities?window=7d&limit=5']);
  });
  it.each(['https://evil.test/api/weapp/v1/me','//evil.test/api/weapp/v1/me','/api/weapp/v1/../../admin','/api/weapp/v1/me#fragment','/api/weapp/v1/me?secret=1'])('rejects path escape %s', async (path) => {
    const b = bridge(); expect((await b.main({ op: 'call', path })).ok).toBe(false); expect(b.urls).toEqual([]);
  });
  it("accepts URL-safe share tokens containing underscores", async () => {
    const b = bridge();
    expect((await b.main({ op: 'call', path: '/api/weapp/v1/shares/abc_defghijklmnopqrstuV' })).ok).toBe(true);
  });
  it("rejects oversized QR scene before calling WeChat", async () => {
    const b = bridge(); expect((await b.main({ op: 'wxacode', page: 'pages/radar/detail', scene: 'id=' + '0'.repeat(36) })).ok).toBe(false);
    expect(b.cloud.openapi.wxacode.getUnlimited).not.toHaveBeenCalled();
  });
});
