import assert from 'node:assert/strict';
import test from 'node:test';

async function webhooks() { return import('../../packages/webhooks/dist/index.js'); }

const encryptionKey = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const secretCiphertext = 'aes-256-gcm-v1$AAECAwQFBgcICQoL$MGqlfqa6oy_Scaa5gt1NW7TuvlWSGDsZXlfUty5dNYQ2KJedzaJ2_RI$JHRLQtcGf8jjgEcrEbBimQ';

function baseClaim(overrides = {}) {
  return {
    jobId: 'b5000000-0000-0000-0000-000000000001',
    deliveryId: 'b5100000-0000-0000-0000-000000000001',
    leaseToken: 'b5200000-0000-0000-0000-000000000001',
    attemptNumber: 1,
    maxAttempts: 8,
    leaseExpiresAt: '2030-01-01T00:00:30.000Z',
    endpoint: {
      id: 'b4200000-0000-0000-0000-000000000001',
      url: 'https://merchant.example/webhook',
      environment: 'sandbox',
      signingSecretVersion: 7,
      signingSecretCiphertext: secretCiphertext,
    },
    event: {
      id: 'b4000000-0000-0000-0000-000000000001',
      type: 'payment.paid',
      occurredAt: '2030-01-01T00:00:00.000Z',
      payloadVersion: 'payment-v1',
      payload: { status: 'paid', id: 'pay_1', amount: 12345 },
    },
    ...overrides,
  };
}

function makeStore(claims) {
  const resolutions = [];
  return {
    resolutions,
    async claim() { return claims; },
    async resolve(input) { resolutions.push(input); return true; },
  };
}

const testEndpointPolicy = {
  async resolveAndValidate(url, environment) {
    assert.equal(environment, 'sandbox');
    return { url, hostname: 'merchant.example', port: 443, pinnedAddress: '8.8.8.8' };
  },
};

const fixedClock = { nowUnixSeconds: () => 1_893_456_000 };

test('A4 delivery service performs one signed POST attempt and atomically resolves 2xx success', async () => {
  const { createWebhookDeliveryService } = await webhooks();
  const store = makeStore([baseClaim()]);
  const sent = [];
  const transport = { async send(request) { sent.push(request); return { status: 204, headers: {} }; } };
  const service = createWebhookDeliveryService({ store, encryptionKey, endpointPolicy: testEndpointPolicy, transport, clock: fixedClock });

  const result = await service.runBatch({ workerId: 'worker-a4', limit: 10, leaseSeconds: 30 });
  assert.deepEqual(result, { claimed: 1, succeeded: 1, retried: 0, terminal: 0 });
  assert.equal(sent.length, 1, 'transport has no hidden retry');
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].timeoutMs, 5000);
  assert.equal(sent[0].redirects, 'manual');
  assert.equal(sent[0].headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(sent[0].headers['user-agent'], 'SwiftPay-Webhooks/1');
  assert.equal(sent[0].headers['x-swiftpay-event'], baseClaim().event.id);
  assert.equal(sent[0].headers['x-swiftpay-delivery'], baseClaim().deliveryId);
  assert.equal(sent[0].headers['x-swiftpay-timestamp'], '1893456000');
  assert.match(sent[0].headers['x-swiftpay-signature'], /^v1=[0-9a-f]{64}$/);
  assert.equal(store.resolutions.length, 1);
  assert.equal(store.resolutions[0].outcome, 'success');
  assert.equal(store.resolutions[0].httpStatus, 204);
});

test('A4 one retryable HTTP response causes one durable retry resolution and no in-process second send', async () => {
  const { createWebhookDeliveryService, computeWebhookRetryDelay } = await webhooks();
  const claim = baseClaim();
  const store = makeStore([claim]);
  let sends = 0;
  const service = createWebhookDeliveryService({
    store, encryptionKey, endpointPolicy: testEndpointPolicy, clock: fixedClock,
    transport: { async send() { sends += 1; return { status: 503, headers: {} }; } },
  });
  const result = await service.runBatch({ workerId: 'worker-a4', limit: 10, leaseSeconds: 30 });
  assert.equal(sends, 1);
  assert.deepEqual(result, { claimed: 1, succeeded: 0, retried: 1, terminal: 0 });
  assert.deepEqual(store.resolutions[0], {
    jobId: claim.jobId,
    deliveryId: claim.deliveryId,
    leaseToken: claim.leaseToken,
    outcome: 'retry',
    httpStatus: 503,
    errorClass: 'transient',
    errorCode: 'http_503',
    retryAfterSeconds: computeWebhookRetryDelay({ deliveryId: claim.deliveryId, attemptNumber: 1, status: 503 }),
  });
});

test('A4 unavailable or invalid signing material is terminal without a network call and without secret leakage', async () => {
  const { createWebhookDeliveryService } = await webhooks();
  for (const ciphertext of [null, `${secretCiphertext}MUTATED`]) {
    const claim = baseClaim({ endpoint: { ...baseClaim().endpoint, signingSecretCiphertext: ciphertext } });
    const store = makeStore([claim]);
    let sends = 0;
    const service = createWebhookDeliveryService({
      store, encryptionKey, endpointPolicy: testEndpointPolicy, clock: fixedClock,
      transport: { async send() { sends += 1; return { status: 204, headers: {} }; } },
    });
    const result = await service.runBatch({ workerId: 'worker-a4', limit: 10, leaseSeconds: 30 });
    assert.equal(sends, 0);
    assert.deepEqual(result, { claimed: 1, succeeded: 0, retried: 0, terminal: 1 });
    assert.equal(store.resolutions[0].outcome, 'terminal');
    assert.equal(store.resolutions[0].errorClass, 'configuration');
    assert.match(store.resolutions[0].errorCode, /^signing_secret_(unavailable|invalid)$/);
    assert.doesNotMatch(JSON.stringify(store.resolutions[0]), /MGqlfqa6|whsec_a4/);
  }
});

test('A4 unsupported payload version and endpoint-policy failure are terminal before transport', async () => {
  const { createWebhookDeliveryService } = await webhooks();
  const scenarios = [
    {
      claim: baseClaim({ event: { ...baseClaim().event, payloadVersion: 'payment-v999' } }),
      policy: testEndpointPolicy,
      code: 'unsupported_payload_version',
      errorClass: 'validation',
    },
    {
      claim: baseClaim(),
      policy: { async resolveAndValidate() { throw new Error('blocked 127.0.0.1 secret=do-not-leak'); } },
      code: 'endpoint_policy',
      errorClass: 'configuration',
    },
  ];
  for (const scenario of scenarios) {
    const store = makeStore([scenario.claim]);
    let sends = 0;
    const service = createWebhookDeliveryService({
      store, encryptionKey, endpointPolicy: scenario.policy, clock: fixedClock,
      transport: { async send() { sends += 1; return { status: 204, headers: {} }; } },
    });
    await service.runBatch({ workerId: 'worker-a4', limit: 10, leaseSeconds: 30 });
    assert.equal(sends, 0);
    assert.equal(store.resolutions[0].outcome, 'terminal');
    assert.equal(store.resolutions[0].errorClass, scenario.errorClass);
    assert.equal(store.resolutions[0].errorCode, scenario.code);
    assert.doesNotMatch(JSON.stringify(store.resolutions[0]), /127\.0\.0\.1|do-not-leak/);
  }
});

test('A4 transport timeout/network exception becomes one retry and merchant response content never becomes a command', async () => {
  const { createWebhookDeliveryService } = await webhooks();
  const claim = baseClaim();
  for (const transport of [
    { async send() { return { status: 500, headers: {}, body: '{"markPaymentPaidAgain":true}' }; } },
    { async send() { const error = new Error('socket failed secret=hidden'); error.code = 'ECONNRESET'; throw error; } },
  ]) {
    const store = makeStore([claim]);
    const service = createWebhookDeliveryService({ store, encryptionKey, endpointPolicy: testEndpointPolicy, transport, clock: fixedClock });
    await service.runBatch({ workerId: 'worker-a4', limit: 10, leaseSeconds: 30 });
    assert.equal(store.resolutions.length, 1);
    assert.equal(store.resolutions[0].outcome, 'retry');
    assert.equal(store.resolutions[0].errorClass, 'transient');
    assert.doesNotMatch(JSON.stringify(store.resolutions[0]), /markPaymentPaidAgain|hidden/);
  }
});
