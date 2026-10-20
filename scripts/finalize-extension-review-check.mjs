import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
const directory = '/Users/joeyzhao/Documents/Finfold-private-review-20260909';
const account = JSON.parse(await readFile(`${directory}/account.json`, 'utf8'));
const state = JSON.parse(await readFile(`${directory}/live-state.json`, 'utf8'));
process.loadEnvFile('/Users/joeyzhao/Documents/Finfold/.env.local');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const base = 'https://www.finfold.app/api/extension/v1';
const origin = 'chrome-extension://lgkoejhkpfpbpebdlbgojngohgghmgpg';
async function call(path, body, token) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000)
  });
  return { status: response.status, json: await response.json() };
}
if (!state.revoked) {
  const previous = state.tokens.refreshToken;
  const refreshed = await call('/oauth/token', { grantType: 'refresh_token', refreshToken: previous });
  assert.equal(refreshed.status, 200);
  state.tokens = refreshed.json;
  await writeFile(`${directory}/live-state.json`, JSON.stringify(state), { mode: 0o600 });
  assert.equal((await call('/oauth/token', { grantType: 'refresh_token', refreshToken: previous })).status, 401);
  assert.equal((await call('/oauth/revoke', { token: state.tokens.refreshToken })).status, 200);
  state.revoked = true;
  await writeFile(`${directory}/live-state.json`, JSON.stringify(state), { mode: 0o600 });
}
assert.equal((await call('/session', undefined, state.tokens.accessToken)).status, 401);
const balances = await db.from('credit_balances').select('source,granted,remaining,period_key').eq('user_id', account.userId);
assert.equal(balances.error, null);
assert.equal(balances.data.filter(b => b.source !== 'refund').reduce((n, b) => n + b.granted, 0), 60);
assert.equal(balances.data.reduce((n, b) => n + b.remaining, 0), 33);
const usage = await db.from('extension_model_usage').select('provider_name,model_name,total_tokens,estimated_cost_usd').eq('user_id', account.userId);
assert.equal(usage.error, null);
const report = { checkedAt: new Date().toISOString(), mode: 'production HTTP API and database; Chrome UI acceptance remains pending',
  totalGranted: 60, singleCost: 3, packCost: 24, availableCredits: 33, replayCharged: 0,
  refreshRotation: true, testSessionRevoked: true, paidModelUsage: usage.data,
  screenshotsReady: false, storeSubmitted: false };
await writeFile(`${directory}/verification-report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
await writeFile(`${directory}/reviewer-instructions.md`, `# Finfold — Social Drafts 1.1.3\n\nPRIVATE: paste credentials only into Chrome Web Store Test instructions. Do not put this file in the extension ZIP or public listing.\n\nLogin: ${account.email}\nPassword: ${account.password}\n\nThis isolated reviewer account has 33 Credits remaining after pre-submission QA. No subscription, payment card or purchase is required. The one-time test allowance expires at ${account.expiresAt}; it does not renew automatically.\n\n1. Install the submitted extension in Chrome 116 or later.\n2. Open https://www.finfold.app/extension/support or another regular webpage.\n3. Click Finfold in the toolbar; alternatively use Create with Finfold in the page context menu.\n4. Sign in with the reviewer credentials above and complete the Finfold authorization flow.\n5. Review the page context and privacy disclosure before generating.\n6. Generate one platform for 3 Credits, then review and copy the full result.\n7. Generate all four platforms for 24 Credits. Results are saved to this review account's content library.\n8. The extension creates drafts only. It does not publish, reply, comment or monitor browsing in the background.\n\nAnonymous generation is disabled in this release. Restricted Chrome and store pages cannot be extracted.\n\nSupport: support@finfold.app\nPrivacy: https://www.finfold.app/privacy\n\nOwner-only readiness note: production API login, PKCE, generation, same-session replay, billing and refresh/revocation were verified. A controlled model-failure test verified the real ledger refund without a model call. Native Chrome side-panel end-to-end acceptance and store screenshots are still pending; do not submit until those checks pass.\n`, { mode: 0o600 });
console.log(JSON.stringify(report));
