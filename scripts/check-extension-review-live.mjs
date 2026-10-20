import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const directory = '/Users/joeyzhao/Documents/Finfold-private-review-20260909';
const account = JSON.parse(await readFile(`${directory}/account.json`, 'utf8'));
assert.ok(account.userId);
process.loadEnvFile('/Users/joeyzhao/Documents/Finfold/.env.local');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const origin = 'chrome-extension://lgkoejhkpfpbpebdlbgojngohgghmgpg';
const base = 'https://www.finfold.app/api/extension/v1';
const report = { checkedAt: new Date().toISOString(), mode: 'deployed HTTP API; not a Chrome UI test' };
let state;
try { state = JSON.parse(await readFile(`${directory}/live-state.json`, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = {}; }
if (state.revoked) throw new Error('This review check is finalized; do not silently create another test session or spend more Credits.');
const save = () => writeFile(`${directory}/live-state.json`, JSON.stringify(state), { mode: 0o600 });
const sha = value => createHash('sha256').update(value).digest('hex');
async function call(path, body, authenticated = true) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${state.tokens.accessToken}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(180000)
  });
  const json = await response.json();
  console.log(path, response.status, json.error?.code ?? 'ok');
  return { status: response.status, json };
}
if (!state.tokens) {
  const loginClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await loginClient.auth.signInWithPassword({ email: account.email, password: account.password });
  assert.equal(login.error, null, 'review password login');
  assert.equal(login.data.user.id, account.userId);
  await loginClient.auth.signOut();
  const verifier = randomBytes(48).toString('base64url');
  const code = `ff_ext_c_${randomBytes(32).toString('hex')}`;
  const redirectUri = 'https://lgkoejhkpfpbpebdlbgojngohgghmgpg.chromiumapp.org/finfold';
  const inserted = await db.from('extension_oauth_codes').insert({
    code_hash: sha(code), user_id: account.userId, redirect_uri: redirectUri,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    expires_at: new Date(Date.now() + 300000).toISOString()
  });
  assert.equal(inserted.error, null);
  const exchange = { grantType: 'authorization_code', code, codeVerifier: verifier, redirectUri };
  assert.equal((await call('/oauth/token', { ...exchange, codeVerifier: randomBytes(48).toString('base64url') }, false)).status, 401);
  const tokens = await call('/oauth/token', exchange, false);
  assert.equal(tokens.status, 200);
  state.tokens = tokens.json;
  await save();
  assert.equal((await call('/oauth/token', exchange, false)).status, 401);
  report.passwordLogin = true;
  report.pkceWrongVerifierRejected = true;
  report.authorizationCodeSingleUse = true;
}
const session = await call('/session');
assert.equal(session.status, 200);
assert.equal(session.json.userId, account.userId);
assert.equal(session.json.freePoolOnly, false);
assert.equal((await call('/session')).json.availableCredits, session.json.availableCredits);
const batches = await db.from('credit_balances').select('source,granted,used,remaining,period_key').eq('user_id', account.userId);
assert.equal(batches.error, null);
const originalGrants = batches.data.filter(batch => batch.source !== 'refund');
assert.equal(originalGrants.length, 1);
assert.equal(originalGrants[0].granted, 60);
assert.equal(originalGrants[0].period_key, 'extension-store-review-v1');
report.oneTimeGrant = { totalGranted: 60, available: session.json.availableCredits, repeatedSessionDoesNotRefill: true };

const mode = process.argv.includes('--single') ? 'single' : process.argv.includes('--pack') ? 'pack' : null;
if (mode) {
  if (!state[mode]) {
    state[mode] = { requestId: randomUUID(), before: session.json.availableCredits };
    await save();
  }
  const test = state[mode];
  const platforms = mode === 'single' ? ['linkedin'] : ['x', 'linkedin', 'xiaohongshu', 'reddit'];
  const request = { requestId: test.requestId, action: 'repurpose', language: 'en', platforms,
    page: { url: 'https://www.finfold.app/extension/support', title: 'Finfold for Chrome Support', siteName: 'Finfold',
      description: 'Finfold Chrome extension support', language: 'en', selectionUsed: true,
      text: 'Finfold for Chrome turns content you choose on the current webpage into draft posts for X, LinkedIn, Xiaohongshu, and Reddit. Sign in to generate. One platform costs 3 Credits, and a four-platform package costs 24 Credits. Review, edit and copy the output before publishing it yourself. The extension does not post comments or publish automatically.' } };
  const generated = await call('/actions', request);
  test.status = generated.status;
  test.error = generated.json.error?.code;
  await save();
  assert.equal(generated.status, 200, 'real generation must succeed; do not silently create a new request');
  assert.equal(generated.json.results.length, platforms.length);
  const after = await call('/session');
  const cost = mode === 'single' ? 3 : 24;
  assert.equal(test.before - after.json.availableCredits, cost);
  const replay = await call('/actions', request);
  assert.equal(replay.status, 200);
  assert.equal(replay.json.kitId, generated.json.kitId);
  assert.equal((await call('/session')).json.availableCredits, after.json.availableCredits);
  test.completed = true;
  test.after = after.json.availableCredits;
  test.kitId = generated.json.kitId;
  await save();
  await writeFile(`${directory}/${mode}-result.json`, JSON.stringify(generated.json, null, 2), { mode: 0o600 });
  report[mode] = { cost, available: test.after, kitSaved: true, replayCharged: 0 };
}
await writeFile(`${directory}/latest-check.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report));
