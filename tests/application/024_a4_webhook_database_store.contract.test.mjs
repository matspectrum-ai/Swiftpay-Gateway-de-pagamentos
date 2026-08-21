import assert from 'node:assert/strict';
import test from 'node:test';

async function db() { return import('../../packages/db/dist/index.js'); }

const claimProjection = {
  jobId: 'b5000000-0000-0000-0000-000000000001',
  deliveryId: 'b5100000-0000-0000-0000-000000000001',
  leaseToken: 'b5200000-0000-0000-0000-000000000001',
  attemptNumber: 1,
  maxAttempts: 8,
  leaseExpiresAt: '2030-01-01T00:00:30.000Z',
  endpoint: {
    id: 'b5300000-0000-0000-0000-000000000001',
    url: 'https://merchant.example/webhook',
    environment: 'sandbox',
    signingSecretVersion: 3,
    signingSecretCiphertext: 'rsa-oaep-sha256-v1$QUJD',
    signingSecretCiphertextFormat: 'rsa-oaep-sha256-v1',
    signingSecretWrappingKeyId: 'webhook-wrap-a4-v1',
  },
  event: {
    id: 'b5400000-0000-0000-0000-000000000001',
    type: 'payment.paid',
    occurredAt: '2030-01-01T00:00:00.000Z',
    payloadVersion: 'payment-v1',
    payload: { id: 'pay_1', status: 'paid' },
  },
};

function fakePool(handler) {
  return { query: handler };
}

test('A4 database adapter claims only through the composed trusted routine and maps the strict internal projection', async () => {
  const { createMerchantWebhookDeliveryStore } = await db();
  const calls = [];
  const store = createMerchantWebhookDeliveryStore(fakePool(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ delivery: claimProjection }] };
  }));
  const result = await store.claim({ workerId: 'worker-a4-1', limit: 10, leaseSeconds: 30 });
  assert.deepEqual(result, [claimProjection]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /app\.claim_merchant_webhook_deliveries/);
  assert.doesNotMatch(calls[0].sql, /app\.(jobs|webhook_endpoints|webhook_events|webhook_deliveries)\b/i);
  assert.deepEqual(calls[0].params, ['worker-a4-1', 10, 30]);
});

test('A4 database adapter resolves only through the composed fenced routine', async () => {
  const { createMerchantWebhookDeliveryStore } = await db();
  const calls = [];
  const store = createMerchantWebhookDeliveryStore(fakePool(async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ resolved: true }] };
  }));
  const resolved = await store.resolve({
    jobId: claimProjection.jobId,
    deliveryId: claimProjection.deliveryId,
    leaseToken: claimProjection.leaseToken,
    outcome: 'retry',
    httpStatus: 503,
    errorClass: 'transient',
    errorCode: 'http_503',
    retryAfterSeconds: 123,
  });
  assert.equal(resolved, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /app\.resolve_merchant_webhook_delivery/);
  assert.doesNotMatch(calls[0].sql, /\b(update|insert|delete)\b/i);
  assert.deepEqual(calls[0].params, [
    claimProjection.jobId,
    claimProjection.deliveryId,
    claimProjection.leaseToken,
    'retry', 503, 'transient', 'http_503', 123,
  ]);
});

test('A4 webhook DB adapter rejects malformed or extra claim fields rather than trusting privileged JSON', async () => {
  const { createMerchantWebhookDeliveryStore, RuntimeWebhookDeliveryStoreError } = await db();
  for (const malformed of [
    { ...claimProjection, unexpected: true },
    { ...claimProjection, attemptNumber: 0 },
    { ...claimProjection, maxAttempts: 7, attemptNumber: 8 },
    { ...claimProjection, endpoint: { ...claimProjection.endpoint, environment: 'invalid' } },
    { ...claimProjection, endpoint: { ...claimProjection.endpoint, signingSecretVersion: 0 } },
    { ...claimProjection, event: { ...claimProjection.event, payload: [] } },
  ]) {
    const store = createMerchantWebhookDeliveryStore(fakePool(async () => ({ rows: [{ delivery: malformed }] })));
    await assert.rejects(() => store.claim({ workerId: 'worker-a4-1', limit: 10, leaseSeconds: 30 }), RuntimeWebhookDeliveryStoreError);
  }
});

test('A4 webhook DB adapter validates claim and resolve inputs before PostgreSQL', async () => {
  const { createMerchantWebhookDeliveryStore, RuntimeWebhookDeliveryStoreError } = await db();
  let queryCount = 0;
  const store = createMerchantWebhookDeliveryStore(fakePool(async () => { queryCount += 1; return { rows: [] }; }));
  await assert.rejects(() => store.claim({ workerId: ' ', limit: 10, leaseSeconds: 30 }), RuntimeWebhookDeliveryStoreError);
  await assert.rejects(() => store.claim({ workerId: 'ok', limit: 0, leaseSeconds: 30 }), RuntimeWebhookDeliveryStoreError);
  await assert.rejects(() => store.claim({ workerId: 'ok', limit: 10, leaseSeconds: 301 }), RuntimeWebhookDeliveryStoreError);
  await assert.rejects(() => store.resolve({ jobId: 'not-a-uuid', deliveryId: claimProjection.deliveryId, leaseToken: claimProjection.leaseToken, outcome: 'success', httpStatus: 204, errorClass: null, errorCode: null, retryAfterSeconds: null }), RuntimeWebhookDeliveryStoreError);
  assert.equal(queryCount, 0);
});

test('A4 webhook DB adapter sanitizes privileged database errors and never leaks ciphertext or SQL', async () => {
  const { createMerchantWebhookDeliveryStore, RuntimeWebhookDeliveryStoreError } = await db();
  const store = createMerchantWebhookDeliveryStore(fakePool(async () => {
    throw new Error('select secret_ciphertext from app.webhook_endpoints where secret_ciphertext=rsa-oaep-sha256-v1$TOPSECRET');
  }));
  await assert.rejects(
    () => store.claim({ workerId: 'worker-a4-1', limit: 10, leaseSeconds: 30 }),
    (error) => {
      assert.ok(error instanceof RuntimeWebhookDeliveryStoreError);
      assert.doesNotMatch(String(error), /TOPSECRET|secret_ciphertext|webhook_endpoints|select /i);
      return true;
    },
  );
});
