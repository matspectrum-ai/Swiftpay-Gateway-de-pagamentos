import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

async function payments() {
  return import('../../packages/payments/dist/index.js');
}

const validRequest = {
  method: 'pix',
  amount: 10_101,
  currency: 'BRL',
  description: 'Pedido A2',
  externalId: 'order-a2-001',
  pixExpirationMinutes: 30,
  customerName: 'Cliente Sandbox',
  customerDocument: '12345678901',
  customerEmail: 'sandbox@example.test',
  customerPhone: '+5593999999999',
};

function expectedHash(request) {
  const vector = [
    request.method,
    request.amount,
    request.currency,
    request.externalId ?? null,
    request.description ?? null,
    request.pixExpirationMinutes,
    request.customerName ?? null,
    request.customerDocument ?? null,
    request.customerEmail ?? null,
    request.customerPhone ?? null,
  ];
  return createHash('sha256')
    .update(`pix-create-v0\n${JSON.stringify(vector)}`, 'utf8')
    .digest('hex');
}

test('A2 validates and normalizes the frozen Pix create request without inventing customer data', async () => {
  const mod = await payments();
  assert.equal(typeof mod.validatePixCreateRequest, 'function');

  const result = mod.validatePixCreateRequest(validRequest);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, validRequest);

  const minimal = mod.validatePixCreateRequest({
    method: 'pix',
    amount: 1,
    currency: 'BRL',
  });
  assert.equal(minimal.ok, true);
  assert.deepEqual(minimal.value, {
    method: 'pix',
    amount: 1,
    currency: 'BRL',
    pixExpirationMinutes: 60,
  });
  assert.equal('customerEmail' in minimal.value, false);
  assert.equal('customerPhone' in minimal.value, false);
});

test('A2 reports all deterministic create-request violations and rejects unknown fields', async () => {
  const mod = await payments();
  const result = mod.validatePixCreateRequest({
    method: 'card',
    amount: 10.5,
    currency: 'USD',
    externalId: '',
    pixExpirationMinutes: 4,
    customerEmail: '',
    callbackUrl: 'https://merchant.example.test/webhook',
  });

  assert.equal(result.ok, false);
  const fields = result.violations.map((violation) => violation.field).sort();
  assert.deepEqual(fields, [
    'amount',
    'callbackUrl',
    'currency',
    'customerEmail',
    'externalId',
    'method',
    'pixExpirationMinutes',
  ]);
});

test('A2 rejects non-object bodies and unsafe/invalid integer cent amounts', async () => {
  const mod = await payments();

  for (const input of [null, [], 'pix']) {
    const result = mod.validatePixCreateRequest(input);
    assert.equal(result.ok, false);
    assert.ok(result.violations.length >= 1);
  }

  for (const amount of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const result = mod.validatePixCreateRequest({ method: 'pix', amount, currency: 'BRL' });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((violation) => violation.field === 'amount'));
  }
});

test('A2 Idempotency-Key normalization is trimmed, bounded and deterministic', async () => {
  const mod = await payments();
  assert.equal(typeof mod.normalizePixCreateIdempotencyKey, 'function');

  assert.deepEqual(mod.normalizePixCreateIdempotencyKey('  idem-a2-001  '), {
    ok: true,
    value: 'idem-a2-001',
  });
  assert.equal(mod.normalizePixCreateIdempotencyKey('   ').ok, false);
  assert.equal(mod.normalizePixCreateIdempotencyKey('x'.repeat(161)).ok, false);
  assert.equal(mod.normalizePixCreateIdempotencyKey(undefined).ok, false);
});

test('A2 canonical request hash uses the frozen ordered vector and defaulted expiration', async () => {
  const mod = await payments();
  assert.equal(typeof mod.hashPixCreateRequest, 'function');

  const first = mod.validatePixCreateRequest(validRequest);
  assert.equal(first.ok, true);
  assert.equal(mod.hashPixCreateRequest(first.value), expectedHash(first.value));

  const differentObjectOrder = mod.validatePixCreateRequest({
    customerPhone: validRequest.customerPhone,
    currency: validRequest.currency,
    externalId: validRequest.externalId,
    amount: validRequest.amount,
    customerEmail: validRequest.customerEmail,
    method: validRequest.method,
    customerDocument: validRequest.customerDocument,
    pixExpirationMinutes: validRequest.pixExpirationMinutes,
    description: validRequest.description,
    customerName: validRequest.customerName,
  });
  assert.equal(differentObjectOrder.ok, true);
  assert.equal(mod.hashPixCreateRequest(differentObjectOrder.value), mod.hashPixCreateRequest(first.value));

  const defaulted = mod.validatePixCreateRequest({ method: 'pix', amount: 500, currency: 'BRL' });
  const explicit = mod.validatePixCreateRequest({
    method: 'pix',
    amount: 500,
    currency: 'BRL',
    pixExpirationMinutes: 60,
  });
  assert.equal(defaulted.ok, true);
  assert.equal(explicit.ok, true);
  assert.equal(mod.hashPixCreateRequest(defaulted.value), mod.hashPixCreateRequest(explicit.value));
});

test('A2 externalId remains independent from request idempotency hashing semantics', async () => {
  const mod = await payments();
  const one = mod.validatePixCreateRequest({
    method: 'pix',
    amount: 100,
    currency: 'BRL',
    externalId: 'merchant-order-1',
  });
  const two = mod.validatePixCreateRequest({
    method: 'pix',
    amount: 200,
    currency: 'BRL',
    externalId: 'merchant-order-1',
  });
  assert.equal(one.ok, true);
  assert.equal(two.ok, true);
  assert.notEqual(mod.hashPixCreateRequest(one.value), mod.hashPixCreateRequest(two.value));
});

test('A2 deterministic emulator success is visibly non-payable and stable from ProviderAttempt identity', async () => {
  const mod = await payments();
  assert.equal(typeof mod.createDeterministicPixEmulator, 'function');

  const emulator = mod.createDeterministicPixEmulator({ outcome: 'success_pending' });
  const input = {
    providerAttemptId: '70000000-0000-0000-0000-000000000001',
    amountCents: 10_101,
    expiresAt: '2026-08-15T12:30:00.000Z',
  };
  const first = await emulator.createPixCharge(input);
  const second = await emulator.createPixCharge(input);

  assert.deepEqual(first, second);
  assert.equal(first.certainty, 'success');
  assert.match(first.providerPaymentId, /70000000-0000-0000-0000-000000000001/);
  assert.match(first.txId, /70000000-0000-0000-0000-000000000001/);
  assert.match(first.copyAndPaste, /^SWIFTPAY_EMULATOR_/);
  assert.match(first.qrCode, /^SWIFTPAY_EMULATOR_/);
  assert.equal(first.expiresAt, input.expiresAt);
});

test('A2 emulator exposes execution_unknown and definitive_rejection without provider secrets or network transport', async () => {
  const mod = await payments();
  const input = {
    providerAttemptId: '70000000-0000-0000-0000-000000000002',
    amountCents: 500,
    expiresAt: '2026-08-15T13:00:00.000Z',
  };

  const unknown = await mod.createDeterministicPixEmulator({ outcome: 'execution_unknown' }).createPixCharge(input);
  assert.deepEqual(unknown, {
    certainty: 'execution_unknown',
    errorClass: 'execution_unknown',
  });

  const rejected = await mod.createDeterministicPixEmulator({ outcome: 'definitive_rejection' }).createPixCharge(input);
  assert.deepEqual(rejected, {
    certainty: 'definitive_rejection',
    errorClass: 'definitive_rejection',
    errorCode: 'emulator_rejected',
  });
});
