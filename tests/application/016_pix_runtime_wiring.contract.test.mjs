import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SIGNING_KEY = '0123456789abcdef0123456789abcdef';
const CURSOR_KEY = 'a9-dashboard-cursor-test-key-0123456789abcdef';
const NOW_SECONDS = 1_900_000_000;
const MERCHANT_ID = '60000000-0000-0000-0000-000000000001';
const CREDENTIAL_ID = '61000000-0000-0000-0000-000000000001';
const JTI = '62000000-0000-0000-0000-000000000001';
const PAYMENT_ID = '70000000-0000-0000-0000-000000000001';
const ATTEMPT_ID = '71000000-0000-0000-0000-000000000001';
const EXECUTION_TOKEN = '72000000-0000-0000-0000-000000000001';

const creatingPayment = {
  id: PAYMENT_ID,
  externalId: 'order-a2-runtime-001',
  method: 'pix',
  amount: 12_345,
  fee: 0,
  netAmount: 12_345,
  currency: 'BRL',
  status: 'creating',
  description: 'A2 runtime wiring',
  environment: 'sandbox',
  expiresAt: '2030-03-17T18:16:40.000Z',
  createdAt: '2030-03-17T17:46:40.000Z',
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

function trustedRoutine(sql) {
  const text = String(sql);
  for (const name of [
    'get_api_credential_auth_state',
    'prepare_api_pix_payment',
    'claim_api_pix_attempt',
    'resolve_api_pix_attempt',
    'get_api_payment',
  ]) {
    if (text.includes(name)) return name;
  }
  throw new Error(`unexpected SQL boundary: ${text}`);
}

test('A2 API runtime composes A1 Bearer revalidation with trusted Pix store service and deterministic emulator', async () => {
  const [{ buildApp }, runtime, auth] = await Promise.all([
    import('../../apps/api/dist/app.js'),
    import('../../apps/api/dist/runtime.js'),
    import('../../packages/auth/dist/index.js'),
  ]);

  const token = await auth.issueAccessToken({
    merchantId: MERCHANT_ID,
    credentialId: CREDENTIAL_ID,
    environment: 'sandbox',
    secretVersion: 3,
    jti: JTI,
    nowSeconds: NOW_SECONDS,
  }, SIGNING_KEY);

  const calls = [];
  const pool = {
    async query(sql, params) {
      const routine = trustedRoutine(sql);
      calls.push({ routine, sql: String(sql), params });
      assert.doesNotMatch(String(sql), /app\.(payments|provider_attempts|request_idempotency)\b/i);
      assert.doesNotMatch(String(sql), /\b(insert|update|delete)\b/i);

      if (routine === 'get_api_credential_auth_state') {
        return { rows: [{
          credential_id: CREDENTIAL_ID,
          merchant_id: MERCHANT_ID,
          environment: 'sandbox',
          credential_status: 'active',
          secret_version: 3,
          merchant_lifecycle_status: 'active',
        }] };
      }
      if (routine === 'prepare_api_pix_payment') {
        return { rows: [{ result: {
          kind: 'prepared',
          payment: creatingPayment,
          providerAttempt: { id: ATTEMPT_ID, amountCents: 12_345, expiresAt: creatingPayment.expiresAt },
        } }] };
      }
      if (routine === 'claim_api_pix_attempt') {
        return { rows: [{ result: { claimed: true, executionToken: EXECUTION_TOKEN } }] };
      }
      if (routine === 'resolve_api_pix_attempt') {
        assert.deepEqual(params[5], {
          certainty: 'success',
          providerPaymentId: `swiftpay-emulator-payment:${ATTEMPT_ID}`,
          txId: `swiftpay-emulator-tx:${ATTEMPT_ID}`,
          copyAndPaste: `SWIFTPAY_EMULATOR_COPY_${ATTEMPT_ID}`,
          qrCode: `SWIFTPAY_EMULATOR_QR_${ATTEMPT_ID}`,
          expiresAt: creatingPayment.expiresAt,
        });
        return { rows: [{ result: pendingPayment }] };
      }
      if (routine === 'get_api_payment') {
        return { rows: [{ result: pendingPayment }] };
      }
      throw new Error('unreachable');
    },
  };

  const services = runtime.createApiRuntimeServices(pool, {
    signingKey: SIGNING_KEY,
    dashboardCursorHmacKey: CURSOR_KEY,
    nowSeconds: () => NOW_SECONDS + 1,
    jti: () => JTI,
  });
  assert.equal(typeof services.authenticateBearer, 'function');
  assert.equal(typeof services.pixPayments?.create, 'function');
  assert.equal(typeof services.pixPayments?.get, 'function');

  const app = buildApp(services);
  try {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': 'idem-a2-runtime-001',
        'x-request-id': 'req-a2-runtime-001',
      },
      payload: {
        method: 'pix',
        amount: 12_345,
        currency: 'BRL',
        description: 'A2 runtime wiring',
        externalId: 'order-a2-runtime-001',
        pixExpirationMinutes: 30,
      },
    });

    assert.equal(createResponse.statusCode, 201);
    assert.deepEqual(createResponse.json(), pendingPayment);
    assert.deepEqual(calls.map((call) => call.routine), [
      'get_api_credential_auth_state',
      'prepare_api_pix_payment',
      'claim_api_pix_attempt',
      'resolve_api_pix_attempt',
    ]);

    const prepareParams = calls[1].params;
    assert.equal(prepareParams[0], MERCHANT_ID);
    assert.equal(prepareParams[1], 'sandbox');
    assert.equal(prepareParams[2], 'idem-a2-runtime-001');
    assert.match(prepareParams[3], /^[0-9a-f]{64}$/);
    assert.equal(prepareParams[4].amount, 12_345);
    assert.deepEqual(prepareParams[5], {
      pricingVersion: 'sandbox-zero-fee-v0',
      feeMode: 'fixed',
      feeFixedCents: 0,
      feeBasisPoints: 0,
      feePercentageComponentCents: 0,
      merchantFeeCents: 0,
      merchantNetCents: 12_345,
      roundingPolicyVersion: 'ceil-bp-v1',
      refundFeePolicy: 'merchant_fee_non_refundable',
    });
    assert.equal(prepareParams[6], 'sandbox-emulator-v0');

    calls.length = 0;
    const getResponse = await app.inject({
      method: 'GET',
      url: `/v1/transactions/${PAYMENT_ID}`,
      headers: {
        authorization: `Bearer ${token}`,
        'x-request-id': 'req-a2-runtime-002',
      },
    });

    assert.equal(getResponse.statusCode, 200);
    assert.deepEqual(getResponse.json(), pendingPayment);
    assert.deepEqual(calls.map((call) => call.routine), [
      'get_api_credential_auth_state',
      'get_api_payment',
    ]);
    assert.deepEqual(calls[1].params, [MERCHANT_ID, 'sandbox', PAYMENT_ID]);
  } finally {
    await app.close();
  }
});

test('A2 production API bootstrap passes the composed payment services into Fastify', async () => {
  const source = await readFile('apps/api/src/index.ts', 'utf8');
  assert.match(source, /createApiRuntimeServices/);
  assert.match(source, /buildApp\([^)]*services/);
});