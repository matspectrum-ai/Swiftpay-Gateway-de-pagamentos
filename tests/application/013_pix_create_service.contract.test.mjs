import assert from 'node:assert/strict';
import test from 'node:test';

async function payments() {
  return import('../../packages/payments/dist/index.js');
}

const principal = {
  merchantId: '60000000-0000-0000-0000-000000000001',
  credentialId: '61000000-0000-0000-0000-000000000001',
  environment: 'sandbox',
  secretVersion: 3,
  tokenId: '62000000-0000-0000-0000-000000000001',
};

const request = {
  method: 'pix',
  amount: 10_101,
  currency: 'BRL',
  description: 'Pedido A2',
  externalId: 'order-a2-001',
  pixExpirationMinutes: 30,
};

const preparedPayment = {
  id: '70000000-0000-0000-0000-000000000001',
  externalId: 'order-a2-001',
  method: 'pix',
  amount: 10_101,
  fee: 0,
  netAmount: 10_101,
  currency: 'BRL',
  status: 'creating',
  description: 'Pedido A2',
  environment: 'sandbox',
  expiresAt: '2026-08-15T12:30:00.000Z',
  createdAt: '2026-08-15T12:00:00.000Z',
  pix: null,
};

const pendingPayment = {
  ...preparedPayment,
  status: 'pending',
  pix: {
    txId: 'swiftpay-emulator-tx:71000000-0000-0000-0000-000000000001',
    qrCode: 'SWIFTPAY_EMULATOR_QR_71000000-0000-0000-0000-000000000001',
    copyAndPaste: 'SWIFTPAY_EMULATOR_COPY_71000000-0000-0000-0000-000000000001',
    expiresAt: preparedPayment.expiresAt,
  },
};

const failedPayment = {
  ...preparedPayment,
  status: 'failed',
};

function firstPrepare() {
  return {
    kind: 'prepared',
    payment: preparedPayment,
    providerAttempt: {
      id: '71000000-0000-0000-0000-000000000001',
      amountCents: request.amount,
      expiresAt: preparedPayment.expiresAt,
    },
  };
}

function createStore(overrides = {}) {
  const calls = [];
  const store = {
    calls,
    async preparePixPayment(input) {
      calls.push(['prepare', input]);
      return firstPrepare();
    },
    async claimPixAttempt(input) {
      calls.push(['claim', input]);
      return {
        claimed: true,
        executionToken: '72000000-0000-0000-0000-000000000001',
      };
    },
    async resolvePixAttempt(input) {
      calls.push(['resolve', input]);
      if (input.resolution.certainty === 'success') return pendingPayment;
      if (input.resolution.certainty === 'definitive_rejection') return failedPayment;
      return preparedPayment;
    },
    async getPayment(input) {
      calls.push(['get', input]);
      return preparedPayment;
    },
    ...overrides,
  };
  return store;
}

const successEmulatorResult = {
  certainty: 'success',
  providerPaymentId: 'swiftpay-emulator-payment:71000000-0000-0000-0000-000000000001',
  txId: 'swiftpay-emulator-tx:71000000-0000-0000-0000-000000000001',
  copyAndPaste: 'SWIFTPAY_EMULATOR_COPY_71000000-0000-0000-0000-000000000001',
  qrCode: 'SWIFTPAY_EMULATOR_QR_71000000-0000-0000-0000-000000000001',
  expiresAt: preparedPayment.expiresAt,
};

function createEmulator(result = successEmulatorResult) {
  const calls = [];
  return {
    calls,
    async createPixCharge(input) {
      calls.push(input);
      return result;
    },
  };
}

test('A2 sandbox first create prepares, claims, executes emulator once and resolves to 201 pending', async () => {
  const mod = await payments();
  assert.equal(typeof mod.createPixPaymentService, 'function');
  const store = createStore();
  const emulator = createEmulator();
  const service = mod.createPixPaymentService(store, emulator);

  const result = await service.create({
    principal,
    idempotencyKey: 'idem-a2-001',
    request,
  });

  assert.deepEqual(result, {
    ok: true,
    httpStatus: 201,
    payment: pendingPayment,
    replayed: false,
  });
  assert.deepEqual(store.calls.map(([name]) => name), ['prepare', 'claim', 'resolve']);
  assert.equal(emulator.calls.length, 1);
  assert.deepEqual(emulator.calls[0], {
    providerAttemptId: '71000000-0000-0000-0000-000000000001',
    amountCents: 10_101,
    expiresAt: preparedPayment.expiresAt,
  });

  const prepareInput = store.calls[0][1];
  assert.equal(prepareInput.merchantId, principal.merchantId);
  assert.equal(prepareInput.environment, 'sandbox');
  assert.equal(prepareInput.idempotencyKey, 'idem-a2-001');
  assert.match(prepareInput.requestHash, /^[a-f0-9]{64}$/);
  assert.equal(prepareInput.pricing.pricingVersion, 'sandbox-zero-fee-v0');
  assert.equal(prepareInput.pricing.merchantFeeCents, 0);
  assert.equal(prepareInput.pricing.merchantNetCents, request.amount);
  assert.equal(prepareInput.routingPolicyVersion, 'sandbox-emulator-v0');
});

test('A2 completed idempotency replay returns stored snapshot and never claims or executes again', async () => {
  const mod = await payments();
  const store = createStore({
    async preparePixPayment(input) {
      this.calls.push(['prepare', input]);
      return {
        kind: 'completed',
        httpStatus: 201,
        payment: pendingPayment,
      };
    },
  });
  const emulator = createEmulator();
  const service = mod.createPixPaymentService(store, emulator);

  const result = await service.create({ principal, idempotencyKey: 'idem-a2-replay', request });
  assert.deepEqual(result, {
    ok: true,
    httpStatus: 201,
    payment: pendingPayment,
    replayed: true,
  });
  assert.deepEqual(store.calls.map(([name]) => name), ['prepare']);
  assert.equal(emulator.calls.length, 0);
});

test('A2 same idempotency key with different canonical request maps to conflict without emulator execution', async () => {
  const mod = await payments();
  const store = createStore({
    async preparePixPayment(input) {
      this.calls.push(['prepare', input]);
      return { kind: 'conflict' };
    },
  });
  const emulator = createEmulator();
  const service = mod.createPixPaymentService(store, emulator);

  const result = await service.create({ principal, idempotencyKey: 'idem-a2-conflict', request });
  assert.deepEqual(result, {
    ok: false,
    httpStatus: 409,
    error: {
      code: 'idempotency_key_reused',
      message: 'Idempotency-Key was already used with a different request.',
    },
  });
  assert.deepEqual(store.calls.map(([name]) => name), ['prepare']);
  assert.equal(emulator.calls.length, 0);
});

test('A2 executing or execution-unknown replay returns the same logical Payment as 202 without second emulator call', async () => {
  const mod = await payments();

  for (const kind of ['executing', 'execution_unknown']) {
    const store = createStore({
      async preparePixPayment(input) {
        this.calls.push(['prepare', input]);
        return { kind, payment: preparedPayment };
      },
    });
    const emulator = createEmulator();
    const service = mod.createPixPaymentService(store, emulator);

    const result = await service.create({ principal, idempotencyKey: `idem-a2-${kind}`, request });
    assert.deepEqual(result, {
      ok: true,
      httpStatus: 202,
      payment: preparedPayment,
      replayed: true,
    });
    assert.deepEqual(store.calls.map(([name]) => name), ['prepare']);
    assert.equal(emulator.calls.length, 0);
  }
});

test('A2 losing the atomic attempt claim returns 202 current Payment and never executes emulator', async () => {
  const mod = await payments();
  const store = createStore({
    async claimPixAttempt(input) {
      this.calls.push(['claim', input]);
      return { claimed: false };
    },
  });
  const emulator = createEmulator();
  const service = mod.createPixPaymentService(store, emulator);

  const result = await service.create({ principal, idempotencyKey: 'idem-a2-claim-loser', request });
  assert.deepEqual(result, {
    ok: true,
    httpStatus: 202,
    payment: preparedPayment,
    replayed: true,
  });
  assert.deepEqual(store.calls.map(([name]) => name), ['prepare', 'claim', 'get']);
  assert.equal(emulator.calls.length, 0);
});

test('A2 execution_unknown resolves the attempt but preserves Payment creating and returns 202', async () => {
  const mod = await payments();
  const store = createStore();
  const emulator = createEmulator({
    certainty: 'execution_unknown',
    errorClass: 'execution_unknown',
  });
  const service = mod.createPixPaymentService(store, emulator);

  const result = await service.create({ principal, idempotencyKey: 'idem-a2-unknown', request });
  assert.deepEqual(result, {
    ok: true,
    httpStatus: 202,
    payment: preparedPayment,
    replayed: false,
  });
  assert.equal(emulator.calls.length, 1);
  assert.equal(store.calls.at(-1)[0], 'resolve');
  assert.equal(store.calls.at(-1)[1].resolution.certainty, 'execution_unknown');
});

test('A2 definitive rejection resolves one local failed Payment resource and returns 201', async () => {
  const mod = await payments();
  const store = createStore();
  const emulator = createEmulator({
    certainty: 'definitive_rejection',
    errorClass: 'definitive_rejection',
    errorCode: 'emulator_rejected',
  });
  const service = mod.createPixPaymentService(store, emulator);

  const result = await service.create({ principal, idempotencyKey: 'idem-a2-rejected', request });
  assert.deepEqual(result, {
    ok: true,
    httpStatus: 201,
    payment: failedPayment,
    replayed: false,
  });
  assert.equal(emulator.calls.length, 1);
});

test('A2 Production principal is fail-closed before store or emulator side effects', async () => {
  const mod = await payments();
  const store = createStore();
  const emulator = createEmulator();
  const service = mod.createPixPaymentService(store, emulator);

  const result = await service.create({
    principal: { ...principal, environment: 'production' },
    idempotencyKey: 'idem-a2-production',
    request,
  });

  assert.deepEqual(result, {
    ok: false,
    httpStatus: 403,
    error: {
      code: 'operation_forbidden',
      message: 'Pix creation is not enabled for this environment.',
    },
  });
  assert.equal(store.calls.length, 0);
  assert.equal(emulator.calls.length, 0);
});

test('A2 concurrent same-key callers rely on atomic claim so exactly one invokes emulator', async () => {
  const mod = await payments();
  let claimWinnerAvailable = true;
  const calls = [];
  const store = {
    async preparePixPayment(input) {
      calls.push(['prepare', input]);
      return firstPrepare();
    },
    async claimPixAttempt(input) {
      calls.push(['claim', input]);
      if (claimWinnerAvailable) {
        claimWinnerAvailable = false;
        return {
          claimed: true,
          executionToken: '72000000-0000-0000-0000-000000000001',
        };
      }
      return { claimed: false };
    },
    async resolvePixAttempt(input) {
      calls.push(['resolve', input]);
      return pendingPayment;
    },
    async getPayment(input) {
      calls.push(['get', input]);
      return preparedPayment;
    },
  };
  const emulator = createEmulator();
  const service = mod.createPixPaymentService(store, emulator);

  const [one, two] = await Promise.all([
    service.create({ principal, idempotencyKey: 'idem-a2-race', request }),
    service.create({ principal, idempotencyKey: 'idem-a2-race', request }),
  ]);

  assert.equal(emulator.calls.length, 1);
  assert.deepEqual([one.httpStatus, two.httpStatus].sort(), [201, 202]);
  assert.equal(calls.filter(([name]) => name === 'claim').length, 2);
  assert.equal(calls.filter(([name]) => name === 'resolve').length, 1);
});
