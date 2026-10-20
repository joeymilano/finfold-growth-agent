// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

// Failure injection only; uses the real ledger but never calls a model.
vi.mock('@/lib/extension/generation', () => ({ generateExtensionResults: async () => { throw new Error('Controlled review refund check'); } }));
it.skipIf(process.env.FINFOLD_REVIEW_REFUND_LIVE !== '1')('refunds the authorized reviewer after a generation exception', async () => {
  process.loadEnvFile('/Users/joeyzhao/Documents/Finfold/.env.local');
  const account = JSON.parse(await readFile('/Users/joeyzhao/Documents/Finfold-private-review-20260909/account.json', 'utf8'));
  process.env.FINFOLD_EXTENSION_REVIEW_USER_ID = account.userId;
  process.env.FINFOLD_EXTENSION_REVIEW_EXPIRES_AT = account.expiresAt;
  const { runAuthenticatedExtensionAction } = await import('@/lib/extension/service');
  const { getAvailableCredits } = await import('@/lib/payment');
  const { createSupabaseAdminClient } = await import('@/lib/supabase');
  const before = await getAvailableCredits(account.userId);
  const requestId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  await expect(runAuthenticatedExtensionAction({ userId: account.userId, sessionId, request: {
    requestId, action: 'repurpose', platforms: ['linkedin'], language: 'en',
    page: { url: 'https://www.finfold.app/extension/support', title: 'Controlled refund test', siteName: 'Finfold', description: '', language: 'en', selectionUsed: true, text: 'Controlled refund test. No external model is called by this test.' }
  } })).rejects.toThrow('Controlled review refund check');
  expect(await getAvailableCredits(account.userId)).toBe(before);
  const ledger = await createSupabaseAdminClient()!.from('ai_usage_operations').select('status').eq('user_id', account.userId).eq('operation_key', `extension:${sessionId}:${requestId}`).single();
  expect(ledger.error).toBeNull();
  expect(ledger.data?.status).toBe('refunded');
  console.info(JSON.stringify({ realLedgerRefundVerified: true, modelFailureInjected: true, paidModelCalls: 0, balanceBefore: before, balanceAfter: before }));
}, 120000);
