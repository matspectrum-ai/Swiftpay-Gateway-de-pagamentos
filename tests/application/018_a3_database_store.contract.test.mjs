import assert from 'node:assert/strict';
import test from 'node:test';

const MERCHANT_ID = 'a0000000-0000-0000-0000-000000000001';
const PAYMENT_ID = 'a1000000-0000-0000-0000-000000000001';
const SOURCE_ID = 'a2000000-0000-0000-0000-000000000001';
const PROVIDER_EVENT_ID = 'a3000000-0000-0000-0000-000000000001';
const LEDGER_ID = 'a4000000-0000-0000-0000-000000000001';
const WEBHOOK_ID = 'a5000000-0000-0000-0000-000000000001';

const paidPayment = {
  id: PAYMENT_ID,
  externalId: 'order-a3-adapter-001',
  method: 'pix',
  amount: 15_000,
  fee: 0,
  netAmount: 15_000,
  currency: 'BRL',
  status: 'paid',
  description: 'A3 adapter paid Payment',
  environment: 'sandbox',
  expiresAt: '2030-01-02T04:04:05.000Z',
  createdAt: '2030-01-02T03:00:00.000Z',
  pix: {
    txId: 'swiftpay-emulator-tx:a3',
    qrCode: 'SWIFTPAY_EMULATOR_QR_a3',
    copyAndPaste: 'SWIFTPAY_EMULATOR_COPY_a3',
    expiresAt: '2030-01-02T04:04:05.000Z',
  },
};

const zeroBalance = {
  currency: 'BRL',
  environment: 'sandbox',
  pendingSettlement: 0,
  available: 0,
  reserved: 0,
  blockedPayouts: 0,
  blockedRefunds: 0,
  blocked: 0,
  withdrawable: 0,
  totalMerchantFunds: 0,
};

const paidBalance = {
  ...zeroBalance,
  pendingSettlement: 15_000,
  totalMerchantFunds: 15_000,
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
  assert.doesNotMatch(
    call.sql,
    /app\.(accounts|payments|provider_events|provider_attempts|ledger_transactions|ledger_entries|webhook_events|jobs)\b/i,
  );
  assert.doesNotMatch(call.sql, /\b(insert|update|delete)\b/i);
}

test('A3 existing Pix adapter accepts paid public Payment and preserves normalized Pix data', async () => {
  const db = await dbModule();
  const pool = fakePool({ get_api_payment: [{ result: paidPayment }] });
  const store = db.createPixPaymentStore(pool);

  assert.deepEqual(await store.getPayment({
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    paymentId: PAYMENT_ID,
  }), paidPayment);
  assertTrustedRoutineOnly(pool.calls[0], 'get_api_payment');
});

test('A3 merchant balance adapter uses only get_api_balance and maps exact merchant-safe balance', async () => {
  const db = await dbModule();
  assert.equal(typeof db.createMerchantBalanceStore, 'function');

  for (const expected of [zeroBalance, paidBalance]) {
    const pool = fakePool({ get_api_balance: [{ result: expected }] });
    const store = db.createMerchantBalanceStore(pool);
    assert.deepEqual(await store.getBalance({
      merchantId: MERCHANT_ID,
      environment: 'sandbox',
    }), expected);
    assert.equal(pool.calls.length, 1);
    assertTrustedRoutineOnly(pool.calls[0], 'get_api_balance');
    assert.deepEqual(pool.calls[0].params, [MERCHANT_ID, 'sandbox']);
  }
});

test('A3 merchant balance adapter rejects malformed or extra trusted-routine fields with sanitized error', async () => {
  const db = await dbModule();
  const pool = fakePool({
    get_api_balance: [{ result: { ...paidBalance, providerSettlementAsset: 15_000 } }],
  });
  const store = db.createMerchantBalanceStore(pool);

  await assert.rejects(
    () => store.getBalance({ merchantId: MERCHANT_ID, environment: 'sandbox' }),
    (error) => {
      assert.equal(error?.name, 'RuntimeFinancialStoreError');
      assert.equal(error?.message, 'Runtime financial database operation failed');
      assert.doesNotMatch(String(error), /providerSettlementAsset|accounts|postgresql:\/\//i);
      return true;
    },
  );
});

test('A3 worker paid-evidence adapter uses only composed apply_sandbox_pix_paid routine', async () => {
  const db = await dbModule();
  assert.equal(typeof db.createSandboxPaidEvidenceStore, 'function');
  const expected = {
    kind: 'applied',
    payment: paidPayment,
    providerEventId: PROVIDER_EVENT_ID,
    ledgerTransactionId: LEDGER_ID,
    webhookEventId: WEBHOOK_ID,
  };
  const pool = fakePool({ apply_sandbox_pix_paid: [{ result: expected }] });
  const store = db.createSandboxPaidEvidenceStore(pool);

  assert.deepEqual(await store.applyPaidEvidence({
    paymentId: PAYMENT_ID,
    simulationSourceId: SOURCE_ID,
    amountCents: 15_000,
    providerCostCents: 0,
    payloadHash: 'a'.repeat(64),
    occurredAt: '2030-01-02T03:04:05.000Z',
  }), expected);

  assert.equal(pool.calls.length, 1);
  assertTrustedRoutineOnly(pool.calls[0], 'apply_sandbox_pix_paid');
  assert.deepEqual(pool.calls[0].params, [
    PAYMENT_ID,
    SOURCE_ID,
    15_000,
    0,
    'a'.repeat(64),
    '2030-01-02T03:04:05.000Z',
  ]);
});

test('A3 financial adapters sanitize database failures without leaking SQL credentials or internal tables', async () => {
  const db = await dbModule();
  const apiPool = fakePool({
    get_api_balance: new Error('password=secret postgresql://root:pw@db app.accounts'),
  });
  const workerPool = fakePool({
    apply_sandbox_pix_paid: new Error('password=secret postgresql://root:pw@db app.ledger_entries'),
  });

  for (const operation of [
    () => db.createMerchantBalanceStore(apiPool).getBalance({ merchantId: MERCHANT_ID, environment: 'sandbox' }),
    () => db.createSandboxPaidEvidenceStore(workerPool).applyPaidEvidence({
      paymentId: PAYMENT_ID,
      simulationSourceId: SOURCE_ID,
      amountCents: 15_000,
      providerCostCents: 0,
      payloadHash: 'b'.repeat(64),
      occurredAt: '2030-01-02T03:04:05.000Z',
    }),
  ]) {
    await assert.rejects(operation, (error) => {
      assert.equal(error?.name, 'RuntimeFinancialStoreError');
      assert.equal(error?.message, 'Runtime financial database operation failed');
      assert.doesNotMatch(String(error), /secret|postgresql|app\.(accounts|ledger_entries)|password/i);
      return true;
    });
  }
});
