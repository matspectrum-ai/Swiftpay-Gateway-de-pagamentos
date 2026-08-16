import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WEBHOOK_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const DELIVERY_ID = 'b6100000-0000-0000-0000-000000000001';
const JOB_ID = 'b6200000-0000-0000-0000-000000000001';
const LEASE_TOKEN = 'b6300000-0000-0000-0000-000000000001';

const claim = {
  jobId: JOB_ID,
  deliveryId: DELIVERY_ID,
  leaseToken: LEASE_TOKEN,
  attemptNumber: 1,
  maxAttempts: 8,
  leaseExpiresAt: '2030-01-01T00:00:30.000Z',
  endpoint: {
    id: 'b6400000-0000-0000-0000-000000000001',
    url: 'https://merchant.example/webhook',
    environment: 'sandbox',
    signingSecretVersion: 7,
    signingSecretCiphertext: null,
  },
  event: {
    id: 'b6500000-0000-0000-0000-000000000001',
    type: 'payment.paid',
    occurredAt: '2030-01-01T00:00:00.000Z',
    payloadVersion: 'payment-v1',
    payload: { id: 'pay_runtime_a4', status: 'paid' },
  },
};

function assertNoRawWebhookOrFinancialDml(sql) {
  const text = String(sql);
  assert.doesNotMatch(text, /\b(insert|update|delete)\b/i);
  assert.doesNotMatch(
    text,
    /app\.(webhook_endpoints|webhook_events|webhook_deliveries|jobs|payments|accounts|ledger_transactions|ledger_entries)\b/i,
  );
}

test('A4 worker runtime composes webhook delivery through composed worker-only DB routines while preserving A3 paid evidence', async () => {
  const runtime = await import('../../apps/worker/dist/runtime.js');
  const calls = [];
  const pool = {
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      assertNoRawWebhookOrFinancialDml(text);
      if (text.includes('claim_merchant_webhook_deliveries')) return { rows: [{ delivery: claim }] };
      if (text.includes('resolve_merchant_webhook_delivery')) return { rows: [{ resolved: true }] };
      throw new Error(`unexpected SQL boundary: ${text}`);
    },
  };

  const endpointPolicy = {
    async resolveAndValidate(url) {
      return { url, hostname: 'merchant.example', port: 443, pinnedAddress: '8.8.8.8' };
    },
  };
  let sends = 0;
  const transport = {
    async send() {
      sends += 1;
      throw new Error('network unavailable for wiring contract');
    },
  };
  const clock = { nowUnixSeconds: () => 1_893_456_000 };

  const services = runtime.createWorkerRuntimeServices(pool, {
    webhookEncryptionKey: WEBHOOK_KEY,
    webhookEndpointPolicy: endpointPolicy,
    webhookTransport: transport,
    clock,
  });

  assert.equal(typeof services.sandboxPaidEvidence?.applyPaidEvidence, 'function');
  assert.equal(typeof services.webhookDeliveries?.runBatch, 'function');
  const result = await services.webhookDeliveries.runBatch({ workerId: 'worker-a4-runtime', limit: 10, leaseSeconds: 30 });
  assert.deepEqual(result, { claimed: 1, succeeded: 0, retried: 0, terminal: 1 });
  assert.equal(sends, 0, 'null snapshotted signing material is terminal before transport');
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /app\.claim_merchant_webhook_deliveries/);
  assert.match(calls[1].sql, /app\.resolve_merchant_webhook_delivery/);
});

test('A4 worker runtime never uses generic claim_jobs for webhook delivery scheduling', async () => {
  const source = await readFile('apps/worker/src/runtime.ts', 'utf8');
  assert.match(source, /createMerchantWebhookDeliveryStore/);
  assert.match(source, /createWebhookDeliveryService/);
  assert.doesNotMatch(source, /claimJobs|claim_jobs/);
});

test('A4 worker config names a worker-only webhook encryption key without fallback or secret echo', async () => {
  const source = await readFile('packages/config/src/index.ts', 'utf8');
  assert.match(source, /SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY/);
  assert.doesNotMatch(source, /SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY.*WEBHOOK|WEBHOOK.*SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY/s);
  const runtimeSource = await readFile('apps/worker/src/runtime.ts', 'utf8');
  assert.doesNotMatch(runtimeSource, /console\.(log|error).*WEBHOOK_SECRET|process\.stdout.*webhookEncryptionKey/i);
});

test('A4 worker bootstrap runs the composed webhook batch loop instead of the old no-job-loop placeholder', async () => {
  const source = await readFile('apps/worker/src/index.ts', 'utf8');
  assert.match(source, /services\.webhookDeliveries/);
  assert.match(source, /runBatch/);
  assert.doesNotMatch(source, /worker_initialized_without_job_loop/);
  assert.doesNotMatch(source, /claim_jobs|claimJobs/);
});
