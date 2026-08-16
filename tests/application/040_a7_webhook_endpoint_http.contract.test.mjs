import assert from 'node:assert/strict';
import test from 'node:test';

const { buildApp } = await import('../../apps/api/dist/app.js');

const MERCHANT_ID = '20000000-0000-0000-0000-0000000000a7';
const ENDPOINT_ID = '30000000-0000-0000-0000-0000000000a7';
const BASE = `/dashboard/v1/merchants/${MERCHANT_ID}/environments/sandbox/webhook-endpoints`;

function endpoint() {
  return {
    id: ENDPOINT_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    url: 'https://merchant.example.com/webhooks',
    status: 'active',
    subscribedEvents: ['payment.paid'],
    secretVersion: 1,
    revision: 1,
    createdAt: '2026-08-16T06:00:00.000Z',
    updatedAt: '2026-08-16T06:00:00.000Z',
  };
}

function appWith(service) {
  return buildApp({
    readinessProbe: async () => {},
    dashboardWebhookEndpoints: service,
  });
}

test('A7 list route delegates only the dashboard authorization header and route merchant/environment', async () => {
  const calls = [];
  const app = appWith({
    list: async (input) => { calls.push(input); return { kind: 'ok', endpoints: [endpoint()] }; },
  });
  try {
    const response = await app.inject({
      method: 'GET', url: BASE,
      headers: { authorization: 'Bearer dashboard-a7', 'x-request-id': 'req-a7-list' },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { object: 'list', data: [endpoint()] });
    assert.deepEqual(calls, [{ authorization: 'Bearer dashboard-a7', merchantId: MERCHANT_ID, environment: 'sandbox' }]);
  } finally {
    await app.close();
  }
});

test('A7 create route requires dashboard realm plus Idempotency-Key and returns plaintext only from the winning service result', async () => {
  const calls = [];
  const app = appWith({
    create: async (input) => {
      calls.push(input);
      return { kind: 'created', endpoint: endpoint(), signingSecret: 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', secretAvailable: true, replayed: false };
    },
  });
  try {
    const response = await app.inject({
      method: 'POST', url: BASE,
      headers: { authorization: 'Bearer dashboard-a7', 'idempotency-key': 'create-a7-http', 'content-type': 'application/json' },
      payload: { url: 'https://merchant.example.com/webhooks', subscribedEvents: ['payment.paid'] },
    });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.signingSecret.startsWith('whsec_'), true);
    assert.equal(body.secretAvailable, true);
    assert.equal(body.replayed, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].idempotencyKey, 'create-a7-http');
  } finally {
    await app.close();
  }
});

test('A7 dashboard service result kinds map to frozen HTTP codes without secret or internal leakage', async () => {
  const cases = [
    ['invalid_session', 401, 'invalid_dashboard_session'],
    ['authentication_unavailable', 503, 'dashboard_authentication_unavailable'],
    ['forbidden', 403, 'operation_forbidden'],
    ['validation_error', 400, 'validation_error'],
    ['resource_not_found', 404, 'resource_not_found'],
    ['resource_conflict', 409, 'resource_conflict'],
    ['idempotency_conflict', 409, 'idempotency_conflict'],
    ['idempotency_in_progress', 409, 'idempotency_in_progress'],
    ['endpoint_limit_reached', 409, 'endpoint_limit_reached'],
    ['internal_error', 500, 'internal_error'],
  ];

  for (const [kind, expectedStatus, expectedCode] of cases) {
    const app = appWith({ get: async () => ({ kind }) });
    try {
      const response = await app.inject({ method: 'GET', url: `${BASE}/${ENDPOINT_ID}`, headers: { authorization: 'Bearer private-a7-token' } });
      assert.equal(response.statusCode, expectedStatus, kind);
      const serialized = response.body;
      assert.equal(response.json().error.code, expectedCode, kind);
      assert.equal(serialized.includes('private-a7-token'), false);
      assert.equal(serialized.includes('secretCiphertext'), false);
    } finally {
      await app.close();
    }
  }
});

test('A7 mutation route family is dashboard-only and machine /v1 namespace does not expose webhook administration', async () => {
  const app = appWith({
    update: async () => ({ kind: 'ok', endpoint: endpoint() }),
    disable: async () => ({ kind: 'ok', endpoint: endpoint() }),
    enable: async () => ({ kind: 'ok', endpoint: endpoint() }),
    rotateSecret: async () => ({ kind: 'ok', endpoint: endpoint(), signingSecret: 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', secretAvailable: true, replayed: false }),
  });
  try {
    for (const [method, path, payload] of [
      ['PATCH', `${BASE}/${ENDPOINT_ID}`, { expectedRevision: 1, subscribedEvents: ['payment.paid'] }],
      ['POST', `${BASE}/${ENDPOINT_ID}/disable`, { expectedRevision: 1 }],
      ['POST', `${BASE}/${ENDPOINT_ID}/enable`, { expectedRevision: 1 }],
      ['POST', `${BASE}/${ENDPOINT_ID}/rotate-secret`, { expectedRevision: 1 }],
    ]) {
      const response = await app.inject({ method, url: path, headers: { authorization: 'Bearer dashboard-a7', 'idempotency-key': `idem-${path}`, 'content-type': 'application/json' }, payload });
      assert.notEqual(response.statusCode, 404, `${method} ${path}`);
    }
    const machine = await app.inject({ method: 'POST', url: `/v1/merchants/${MERCHANT_ID}/webhook-endpoints`, headers: { authorization: 'Bearer machine-token' }, payload: {} });
    assert.equal(machine.statusCode, 404);
  } finally {
    await app.close();
  }
});
