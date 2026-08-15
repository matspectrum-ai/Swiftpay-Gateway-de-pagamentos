import assert from 'node:assert/strict';
import test from 'node:test';

const MERCHANT_ID = '60000000-0000-0000-0000-000000000001';
const PAYMENT_ID = '70000000-0000-0000-0000-000000000001';
const ATTEMPT_ID = '71000000-0000-0000-0000-000000000001';
const EXECUTION_TOKEN = '72000000-0000-0000-0000-000000000001';

const request = {
  method: 'pix',
  amount: 10_101,
  currency: 'BRL',
  description: 'Pedido A2 DB adapter',
  externalId: 'order-a2-db-adapter-001',
  pixExpirationMinutes: 30,
};

const pricing = {
  pricingVersion: 'sandbox-zero-fee-v0',
  feeMode: 'fixed',
  feeFixedCents: 0,
  feeBasisPoints: 0,
  feePercentageComponentCents: 0,
  merchantFeeCents: 0,
  merchantNetCents: 10_101,
  roundingPolicyVersion: 'ceil-bp-v1',
  refundFeePolicy: 'merchant_fee_non_refundable',
};

const creatingPayment = {
  id: PAYMENT_ID,
  externalId: 'order-a2-db-adapter-001',
  method: 'pix',
  amount: 10_101,
  fee: 0,
  netAmount: 10_101,
  currency: 'BRL',
  status: 'creating',
  description: 'Pedido A2 DB adapter',
  environment: 'sandbox',
  expiresAt: '2026-08-15T12:30:00.000Z',
  createdAt: '2026-08-15T12:00:00.000Z',
  pix: null,
};

const pendingPayment = {
  ...creatingPayment,
  status: 'pending',
  pix: {
    txId: `swiftpay-emulator-tx:${ATTEMPT_ID}`,
    qrCode: `SWIFTPAY_EMULATOR_QR_${ATTEMPT_ID}`,
    copyAndPaste: `SWIFTPAY_EMULATOR_COPY_${ATTEMPT_ID}`,
    expiresAt: creatingPayment.expiresAt,
  },
};

async function dbModule() {
  return import('../../packages/db/dist/index.js');
}

function fakePool(rowsByRoutine = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      const routine = Object.keys(rowsByRoutine).find((name) => String(sql).includes(name));
      if (!routine) throw new Error('unexpected SQL or direct table access');
      const value = rowsByRoutine[routine];
      if (value instanceof Error) throw value;
      return { rows: value };
    },
  };
}

function assertTrustedRoutineOnly(call, routine) {
  assert.match(call.sql, new RegExp(`app\\.${routine}`));
  assert.doesNotMatch(call.sql, /app\.(payments|provider_attempts|request_idempotency)\b/i);
  assert.doesNotMatch(call.sql, /\b(insert|update|delete)\b/i);
}

test('A2 database adapter prepares Pix only through trusted routine and maps prepared result', async () => {
  const db = await dbModule();
  assert.equal(typeof db.createPixPaymentStore, 'function');

  const pool = fakePool({
    prepare_api_pix_payment: [{
      result: {
        kind: 'prepared',
        payment: creatingPayment,
        providerAttempt: {
          id: ATTEMPT_ID,
          amountCents: 10_101,
          expiresAt: creatingPayment.expiresAt,
        },
      },
    }],
  });
  const store = db.createPixPaymentStore(pool);

  const result = await store.preparePixPayment({
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    idempotencyKey: 'idem-a2-db-adapter-001',
    requestHash: 'a'.repeat(64),
    request,
    pricing,
    routingPolicyVersion: 'sandbox-emulator-v0',
  });

  assert.deepEqual(result, {
    kind: 'prepared',
    payment: creatingPayment,
    providerAttempt: {
      id: ATTEMPT_ID,
      amountCents: 10_101,
      expiresAt: creatingPayment.expiresAt,
    },
  });
  assert.equal(pool.calls.length, 1);
  assertTrustedRoutineOnly(pool.calls[0], 'prepare_api_pix_payment');
  assert.deepEqual(pool.calls[0].params, [
    MERCHANT_ID,
    'sandbox',
    'idem-a2-db-adapter-001',
    'a'.repeat(64),
    request,
    pricing,
    'sandbox-emulator-v0',
  ]);
});

test('A2 database adapter preserves conflict completed executing and execution_unknown prepare variants', async () => {
  const db = await dbModule();
  const variants = [
    { kind: 'conflict' },
    { kind: 'completed', httpStatus: 201, payment: pendingPayment },
    { kind: 'executing', payment: creatingPayment },
    { kind: 'execution_unknown', payment: creatingPayment },
  ];

  for (const variant of variants) {
    const pool = fakePool({ prepare_api_pix_payment: [{ result: variant }] });
    const store = db.createPixPaymentStore(pool);
    const result = await store.preparePixPayment({
      merchantId: MERCHANT_ID,
      environment: 'sandbox',
      idempotencyKey: `idem-${variant.kind}`,
      requestHash: 'b'.repeat(64),
      request,
      pricing,
      routingPolicyVersion: 'sandbox-emulator-v0',
    });
    assert.deepEqual(result, variant);
    assertTrustedRoutineOnly(pool.calls[0], 'prepare_api_pix_payment');
  }
});

test('A2 database adapter claims execution only through trusted routine', async () => {
  const db = await dbModule();
  const pool = fakePool({
    claim_api_pix_attempt: [{ result: { claimed: true, executionToken: EXECUTION_TOKEN } }],
  });
  const store = db.createPixPaymentStore(pool);

  assert.deepEqual(await store.claimPixAttempt({
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    paymentId: PAYMENT_ID,
    providerAttemptId: ATTEMPT_ID,
  }), { claimed: true, executionToken: EXECUTION_TOKEN });

  assertTrustedRoutineOnly(pool.calls[0], 'claim_api_pix_attempt');
  assert.deepEqual(pool.calls[0].params, [MERCHANT_ID, 'sandbox', PAYMENT_ID, ATTEMPT_ID]);
});

test('A2 database adapter resolves provider outcome only through trusted routine and maps public Payment', async () => {
  const db = await dbModule();
  const resolution = {
    certainty: 'success',
    providerPaymentId: `swiftpay-emulator-payment:${ATTEMPT_ID}`,
    txId: `swiftpay-emulator-tx:${ATTEMPT_ID}`,
    copyAndPaste: `SWIFTPAY_EMULATOR_COPY_${ATTEMPT_ID}`,
    qrCode: `SWIFTPAY_EMULATOR_QR_${ATTEMPT_ID}`,
    expiresAt: creatingPayment.expiresAt,
  };
  const pool = fakePool({ resolve_api_pix_attempt: [{ result: pendingPayment }] });
  const store = db.createPixPaymentStore(pool);

  assert.deepEqual(await store.resolvePixAttempt({
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    paymentId: PAYMENT_ID,
    providerAttemptId: ATTEMPT_ID,
    executionToken: EXECUTION_TOKEN,
    resolution,
  }), pendingPayment);

  assertTrustedRoutineOnly(pool.calls[0], 'resolve_api_pix_attempt');
  assert.deepEqual(pool.calls[0].params, [
    MERCHANT_ID,
    'sandbox',
    PAYMENT_ID,
    ATTEMPT_ID,
    EXECUTION_TOKEN,
    resolution,
  ]);
});

test('A2 database adapter gets merchant-scoped Payment only through trusted routine and preserves absence', async () => {
  const db = await dbModule();

  for (const value of [pendingPayment, null]) {
    const pool = fakePool({ get_api_payment: [{ result: value }] });
    const store = db.createPixPaymentStore(pool);
    assert.deepEqual(await store.getPayment({
      merchantId: MERCHANT_ID,
      environment: 'sandbox',
      paymentId: PAYMENT_ID,
    }), value);
    assertTrustedRoutineOnly(pool.calls[0], 'get_api_payment');
    assert.deepEqual(pool.calls[0].params, [MERCHANT_ID, 'sandbox', PAYMENT_ID]);
  }
});

test('A2 database adapter fails closed with sanitized error on malformed trusted-routine JSON', async () => {
  const db = await dbModule();
  const pool = fakePool({
    prepare_api_pix_payment: [{ result: { kind: 'prepared', payment: { id: PAYMENT_ID } } }],
  });
  const store = db.createPixPaymentStore(pool);

  await assert.rejects(
    () => store.preparePixPayment({
      merchantId: MERCHANT_ID,
      environment: 'sandbox',
      idempotencyKey: 'idem-malformed',
      requestHash: 'c'.repeat(64),
      request,
      pricing,
      routingPolicyVersion: 'sandbox-emulator-v0',
    }),
    (error) => {
      assert.equal(error?.name, 'RuntimePixStoreError');
      assert.equal(error?.message, 'Runtime Pix database operation failed');
      assert.doesNotMatch(String(error), /payments|provider_attempts|request_idempotency|postgresql:\/\//i);
      return true;
    },
  );
});

test('A2 database adapter sanitizes database failures and never leaks underlying SQL or connection details', async () => {
  const db = await dbModule();
  const pool = fakePool({
    get_api_payment: new Error('password=secret postgresql://root:pw@db app.payments'),
  });
  const store = db.createPixPaymentStore(pool);

  await assert.rejects(
    () => store.getPayment({ merchantId: MERCHANT_ID, environment: 'sandbox', paymentId: PAYMENT_ID }),
    (error) => {
      assert.equal(error?.name, 'RuntimePixStoreError');
      assert.equal(error?.message, 'Runtime Pix database operation failed');
      assert.doesNotMatch(String(error), /secret|postgresql|app\.payments|password/i);
      return true;
    },
  );
});
