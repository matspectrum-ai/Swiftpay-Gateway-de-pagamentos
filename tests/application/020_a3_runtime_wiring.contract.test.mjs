import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SIGNING_KEY = '0123456789abcdef0123456789abcdef';
const SIGNING_KEY_ID = 'machine-a3-runtime';
const CURSOR_KEY = 'a9-dashboard-cursor-test-key-0123456789abcdef';
const MERCHANT_ID = 'c0000000-0000-0000-0000-000000000001';
const PAYMENT_ID = 'c1000000-0000-0000-0000-000000000001';
const SOURCE_ID = 'c2000000-0000-0000-0000-000000000001';
const PROVIDER_EVENT_ID = 'c3000000-0000-0000-0000-000000000001';
const LEDGER_ID = 'c4000000-0000-0000-0000-000000000001';
const WEBHOOK_ID = 'c5000000-0000-0000-0000-000000000001';

const principal = {
  merchantId: MERCHANT_ID,
  credentialId: 'c6000000-0000-0000-0000-000000000001',
  environment: 'sandbox',
  secretVersion: 1,
  tokenId: 'c7000000-0000-0000-0000-000000000001',
};

const balance = {
  currency: 'BRL',
  environment: 'sandbox',
  pendingSettlement: 12_345,
  available: 0,
  reserved: 0,
  blockedPayouts: 0,
  blockedRefunds: 0,
  blocked: 0,
  withdrawable: 0,
  totalMerchantFunds: 12_345,
};

const paidPayment = {
  id: PAYMENT_ID,
  externalId: 'order-a3-runtime-001',
  method: 'pix',
  amount: 12_345,
  fee: 0,
  netAmount: 12_345,
  currency: 'BRL',
  status: 'paid',
  description: 'A3 runtime paid Payment',
  environment: 'sandbox',
  expiresAt: '2030-03-17T18:16:40.000Z',
  createdAt: '2030-03-17T17:46:40.000Z',
  pix: {
    txId: 'swiftpay-emulator-tx:a3-runtime',
    qrCode: 'SWIFTPAY_EMULATOR_QR_a3-runtime',
    copyAndPaste: 'SWIFTPAY_EMULATOR_COPY_a3-runtime',
    expiresAt: '2030-03-17T18:16:40.000Z',
  },
};

function assertNoRawFinancialAccess(sql) {
  assert.doesNotMatch(
    String(sql),
    /app\.(accounts|payments|provider_events|provider_attempts|ledger_transactions|ledger_entries|webhook_events|jobs)\b/i,
  );
  assert.doesNotMatch(String(sql), /\b(insert|update|delete)\b/i);
}

test('A3 API runtime composes merchant balance from authenticated principal through trusted balance routine only', async () => {
  const runtime = await import('../../apps/api/dist/runtime.js');
  const calls = [];
  const pool = {
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      assertNoRawFinancialAccess(text);
      if (text.includes('get_api_balance')) return { rows: [{ result: balance }] };
      throw new Error(`unexpected SQL boundary: ${text}`);
    },
  };

  const services = runtime.createApiRuntimeServices(pool, {
    accessTokenActiveKeyId: SIGNING_KEY_ID,
    accessTokenSigningKeys: [{ id: SIGNING_KEY_ID, secret: SIGNING_KEY }],
    supabaseUrl: 'https://project-a6.supabase.co',
    supabasePublishableKey: 'sb_publishable_a6_test_key',
    dashboardCursorHmacKey: CURSOR_KEY,
  });
  assert.equal(typeof services.merchantBalance?.get, 'function');
  assert.deepEqual(await services.merchantBalance.get({ principal }), balance);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /app\.get_api_balance/);
  assert.deepEqual(calls[0].params, [MERCHANT_ID, 'sandbox']);
});

test('A3 worker runtime composes the paid-evidence command through worker trusted routine only', async () => {
  const runtime = await import('../../apps/worker/dist/runtime.js');
  const calls = [];
  const pool = {
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      assertNoRawFinancialAccess(text);
      if (text.includes('apply_sandbox_pix_paid')) {
        return { rows: [{ result: {
          kind: 'applied',
          payment: paidPayment,
          providerEventId: PROVIDER_EVENT_ID,
          ledgerTransactionId: LEDGER_ID,
          webhookEventId: WEBHOOK_ID,
        } }] };
      }
      throw new Error(`unexpected SQL boundary: ${text}`);
    },
  };

  const services = runtime.createWorkerRuntimeServices(pool);
  assert.equal(typeof services.sandboxPaidEvidence?.applyPaidEvidence, 'function');
  const result = await services.sandboxPaidEvidence.applyPaidEvidence({
    paymentId: PAYMENT_ID,
    simulationSourceId: SOURCE_ID,
    amountCents: 12_345,
    providerCostCents: 0,
    payloadHash: 'a'.repeat(64),
    occurredAt: '2030-03-17T17:50:00.000Z',
  });
  assert.equal(result.kind, 'applied');
  assert.deepEqual(result.payment, paidPayment);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /app\.apply_sandbox_pix_paid/);
  assert.deepEqual(calls[0].params, [
    PAYMENT_ID,
    SOURCE_ID,
    12_345,
    0,
    'a'.repeat(64),
    '2030-03-17T17:50:00.000Z',
  ]);
});

test('A3 worker bootstrap delegates readiness to composed worker runtime services', async () => {
  const source = await readFile('apps/worker/src/index.ts', 'utf8');
  assert.match(source, /createWorkerRuntimeServices/);
  assert.match(source, /services\.readinessProbe\(\)/);
  assert.doesNotMatch(source, /verifyRuntimeBoundary\(pool,\s*['"]worker['"]\)/);
});
