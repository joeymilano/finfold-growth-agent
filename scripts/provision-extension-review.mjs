import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Explicitly authorized store-review account only. Never prints credentials.
const privateDir = '/Users/joeyzhao/Documents/Finfold-private-review-20260909';
const statePath = `${privateDir}/account.json`;
process.loadEnvFile('/Users/joeyzhao/Documents/Finfold/.env.local');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
await mkdir(privateDir, { recursive: true, mode: 0o700 });
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!state) {
  if (!process.argv.includes('--create')) throw new Error('Account does not exist; --create is required.');
  state = { email: 'support+chrome-review@finfold.app', password: randomBytes(30).toString('base64url'), expiresAt: '2026-10-09T00:00:00Z' };
  // Persist before the network request, so an uncertain response never loses credentials.
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
}
if (!state.userId) {
  const existing = await db.from('profiles').select('id').eq('email', state.email).maybeSingle();
  if (existing.error) throw new Error('Unable to reconcile the previous attempt.');
  if (existing.data) {
    const found = await db.auth.admin.getUserById(existing.data.id);
    if (found.error || found.data.user?.app_metadata?.purpose !== 'chrome_store_review') throw new Error('Existing account is not the authorized review account.');
    state.userId = existing.data.id;
  } else {
    if (!process.argv.includes('--create')) throw new Error('No account found; --create is required.');
    const { data, error } = await db.auth.admin.createUser({
    email: state.email, password: state.password, email_confirm: true,
    app_metadata: { purpose: 'chrome_store_review', credit_grant_limit: 60 },
    user_metadata: { full_name: 'Finfold Chrome Review' }
  });
  if (error || !data.user) throw new Error(`Account creation failed (${error?.status ?? 'unknown'}); inspect before retry.`);
  state.userId = data.user.id;
  }
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
}
if (!state.userId) throw new Error('Uncertain account creation; stop for reconciliation, do not create another account.');
const [balances, subscriptions, profile] = await Promise.all([
  db.from('credit_balances').select('source,granted,used,remaining,period_key').eq('user_id', state.userId),
  db.from('subscriptions').select('id').eq('user_id', state.userId),
  db.from('profiles').select('plan').eq('id', state.userId).single()
]);
if (balances.error || subscriptions.error || profile.error) throw new Error('Could not verify isolated account state.');
const granted = balances.data.reduce((n, row) => n + row.granted, 0);
if (granted !== 0 || subscriptions.data.length || profile.data.plan !== 'free') throw new Error('Account is not a clean zero-credit free account; do not issue more Credits.');
await writeFile(`${privateDir}/worker-review-config.json`, JSON.stringify({
  FINFOLD_EXTENSION_REVIEW_USER_ID: state.userId,
  FINFOLD_EXTENSION_REVIEW_EXPIRES_AT: state.expiresAt
}), { mode: 0o600 });
console.log(JSON.stringify({ userId: state.userId, created: true, totalCreditsGranted: granted, subscriptions: 0, plan: profile.data.plan, credentialsStoredPrivately: true }));
