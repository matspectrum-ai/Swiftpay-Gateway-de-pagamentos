import assert from 'node:assert/strict';
import test from 'node:test';

const webhooks = await import('../../packages/webhooks/dist/index.js');

const USER_ID = '10000000-0000-0000-0000-0000000000a7';
const MERCHANT_ID = '20000000-0000-0000-0000-0000000000a7';
const ENDPOINT_ID = '30000000-0000-0000-0000-0000000000a7';

const factory = webhooks.createDashboardWebhookEndpointManagementService;

function buildService(overrides = {}) {
  const calls = { auth: [], context: [], policy: [], store: [], generated: 0, wrapped: [] };
  const options = {
    sessionVerifier: async (authorization) => {
      calls.auth.push(authorization);
      return { kind: 'authenticated', principal: { userId: USER_ID } };
    },
    contextStore: {
      requireContext: async (input) => {
        calls.context.push(input);
        return { kind: 'authorized', context: { merchantId: MERCHANT_ID, environment: 'sandbox', membershipRole: 'admin' } };
      },
    },
    endpointPolicy: {
      resolveAndValidate: async (url, environment) => {
        calls.policy.push({ url, environment });
        return { url, hostname: 'merchant.example.com', port: 443, pinnedAddress: '93.184.216.34' };
      },
    },
    store: {
      list: async () => [],
      get: async () => null,
      create: async (input) => {
        calls.store.push({ method: 'create', input });
        return {
          kind: 'created', replayed: false,
          endpoint: {
            id: ENDPOINT_ID, merchantId: MERCHANT_ID, environment: 'sandbox',
            url: 'https://merchant.example.com/webhooks', status: 'active',
            subscribedEvents: ['payment.paid'], secretVersion: 1, revision: 1,
            createdAt: '2026-08-16T06:00:00.000Z', updatedAt: '2026-08-16T06:00:00.000Z',
          },
        };
      },
      update: async (input) => { calls.store.push({ method: 'update', input }); return { kind: 'ok' }; },
      disable: async (input) => { calls.store.push({ method: 'disable', input }); return { kind: 'ok' }; },
      enable: async (input) => { calls.store.push({ method: 'enable', input }); return { kind: 'ok' }; },
      rotateSecret: async (input) => { calls.store.push({ method: 'rotateSecret', input }); return { kind: 'ok' }; },
    },
    wrappingKeyId: 'webhook-wrap-a7-v1',
    wrappingPublicKey: 'synthetic-public-key',
    idFactory: () => ENDPOINT_ID,
    secretGenerator: () => {
      calls.generated += 1;
      return 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    },
    secretWrapper: (input) => {
      calls.wrapped.push(input);
      return {
        format: 'rsa-oaep-sha256-v1', wrappingKeyId: 'webhook-wrap-a7-v1',
        ciphertext: 'rsa-oaep-sha256-v1$synthetic_ciphertext',
      };
    },
    ...overrides,
  };
  if (typeof factory !== 'function') {
    const missing = async () => ({ kind: 'not_implemented' });
    return { service: { list: missing, get: missing, create: missing, update: missing, disable: missing, enable: missing, rotateSecret: missing }, calls };
  }
  return { service: factory(options), calls };
}

test('A7 webhooks package exports createDashboardWebhookEndpointManagementService', () => {
  assert.equal(typeof factory, 'function');
});

test('A7 create authenticates one dashboard user, requires admin, validates destination and forwards only verified userId authority', async () => {
  const { service, calls } = buildService();
  const result = await service.create({
    authorization: 'Bearer user-session-a7',
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    idempotencyKey: ' create-a7-001 ',
    request: { url: 'https://merchant.example.com/webhooks', subscribedEvents: ['payment.paid'] },
  });

  assert.equal(result.kind, 'created');
  assert.equal(result.secretAvailable, true);
  assert.match(result.signingSecret, /^whsec_/);
  assert.deepEqual(calls.auth, ['Bearer user-session-a7']);
  assert.deepEqual(calls.context, [{ userId: USER_ID, merchantId: MERCHANT_ID, environment: 'sandbox', requiredRole: 'admin' }]);
  assert.equal(calls.policy.length, 1);
  assert.equal(calls.store.length, 1);
  assert.equal(calls.store[0].input.userId, USER_ID);
  assert.equal(calls.store[0].input.idempotencyKey, 'create-a7-001');
  assert.equal(JSON.stringify(calls.store[0].input).includes('user-session-a7'), false);
});

test('A7 invalid/forbidden dashboard authority short-circuits URL policy secret generation and database mutation', async () => {
  for (const verification of [{ kind: 'invalid_session' }, { kind: 'authentication_unavailable' }]) {
    const { service, calls } = buildService({ sessionVerifier: async () => verification });
    const result = await service.create({
      authorization: 'Bearer rejected', merchantId: MERCHANT_ID, environment: 'sandbox',
      idempotencyKey: 'idem-a7-rejected', request: { url: 'https://merchant.example.com/webhooks', subscribedEvents: ['payment.paid'] },
    });
    assert.deepEqual(result, verification);
    assert.equal(calls.policy.length, 0);
    assert.equal(calls.generated, 0);
    assert.equal(calls.store.length, 0);
  }

  const { service, calls } = buildService({
    contextStore: { requireContext: async () => ({ kind: 'forbidden' }) },
  });
  assert.deepEqual(await service.create({
    authorization: 'Bearer member', merchantId: MERCHANT_ID, environment: 'sandbox',
    idempotencyKey: 'idem-a7-member', request: { url: 'https://merchant.example.com/webhooks', subscribedEvents: ['payment.paid'] },
  }), { kind: 'forbidden' });
  assert.equal(calls.policy.length, 0);
  assert.equal(calls.generated, 0);
  assert.equal(calls.store.length, 0);
});

test('A7 validates Idempotency-Key and exact payment.paid subscription before secret or store side effects', async () => {
  for (const sample of [
    { idempotencyKey: '', subscribedEvents: ['payment.paid'] },
    { idempotencyKey: 'x'.repeat(161), subscribedEvents: ['payment.paid'] },
    { idempotencyKey: 'valid', subscribedEvents: [] },
    { idempotencyKey: 'valid', subscribedEvents: ['payment.refunded'] },
    { idempotencyKey: 'valid', subscribedEvents: ['payment.paid', 'payment.paid'] },
  ]) {
    const { service, calls } = buildService();
    const result = await service.create({
      authorization: 'Bearer user-session-a7', merchantId: MERCHANT_ID, environment: 'sandbox',
      idempotencyKey: sample.idempotencyKey,
      request: { url: 'https://merchant.example.com/webhooks', subscribedEvents: sample.subscribedEvents },
    });
    assert.equal(result.kind, 'validation_error');
    assert.equal(calls.generated, 0);
    assert.equal(calls.store.length, 0);
  }
});

test('A7 completed create replay never returns candidate plaintext as authoritative secret', async () => {
  const replayStore = {
    list: async () => [], get: async () => null,
    create: async () => ({
      kind: 'created', replayed: true,
      endpoint: { id: ENDPOINT_ID, merchantId: MERCHANT_ID, environment: 'sandbox', url: 'https://merchant.example.com/webhooks', status: 'active', subscribedEvents: ['payment.paid'], secretVersion: 1, revision: 1, createdAt: '2026-08-16T06:00:00.000Z', updatedAt: '2026-08-16T06:00:00.000Z' },
    }),
    update: async () => ({ kind: 'not_used' }), disable: async () => ({ kind: 'not_used' }), enable: async () => ({ kind: 'not_used' }), rotateSecret: async () => ({ kind: 'not_used' }),
  };
  const { service } = buildService({ store: replayStore });
  const result = await service.create({
    authorization: 'Bearer user-session-a7', merchantId: MERCHANT_ID, environment: 'sandbox',
    idempotencyKey: 'idem-a7-replay', request: { url: 'https://merchant.example.com/webhooks', subscribedEvents: ['payment.paid'] },
  });
  assert.equal(result.replayed, true);
  assert.equal(result.signingSecret, null);
  assert.equal(result.secretAvailable, false);
});
