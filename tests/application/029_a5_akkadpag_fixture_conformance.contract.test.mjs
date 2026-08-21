import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MODULE = '../../packages/providers/dist/index.js';
const FIXTURE_ROOT = new URL('./provider-fixtures/akkadpag/', import.meta.url);

async function providers() {
  try {
    return await import(MODULE);
  } catch (error) {
    assert.fail(`A5 providers implementation missing or unloadable: ${error?.code ?? error}`);
  }
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_ROOT), 'utf8'));
}

function fixtureTransport(fx, ProviderTransportError) {
  const calls = [];
  return {
    calls,
    async send(request) {
      calls.push(request);
      if (fx.transportError) {
        throw new ProviderTransportError(fx.transportError.kind, fx.transportError.code);
      }
      return {
        statusCode: fx.response.statusCode,
        headers: fx.response.headers ?? {},
        bodyUtf8: typeof fx.response.body === 'string' ? fx.response.body : JSON.stringify(fx.response.body),
      };
    },
  };
}

function assertRequest(actual, expected) {
  assert.equal(actual.method, expected.method);
  assert.equal(actual.relativePath, expected.relativePath);
  for (const [name, value] of Object.entries(expected.expectedHeaders ?? {})) {
    assert.equal(actual.headers[name], value);
  }
  assert.deepEqual(actual.bodyUtf8 == null ? null : JSON.parse(actual.bodyUtf8), expected.body);
}

const INPUT = {
  credentials: { publicKey: 'pk_a5_fixture', secretKey: 'sk_a5_fixture' },
  amountCents: 12345,
  clientReference: 'pa_a5_akkad_001',
  description: 'A5 fixture payment',
  customer: {
    name: 'A5 Fixture Customer',
    email: 'fixture@example.invalid',
    phone: '+55 (00) 00000-0000',
    document: '123.456.789-01',
  },
  postbackUrl: 'https://merchant.example.invalid/provider/akkadpag',
};

test('A5 AkkadPag maps the frozen legacy-lineage Pix request with synthetic Basic auth and stable client reference', async () => {
  const { ProviderTransportError, createAkkadPagAdapter } = await providers();
  const fx = await fixture('pix-create-success.json');
  const transport = fixtureTransport(fx, ProviderTransportError);
  const result = await createAkkadPagAdapter({ transport }).createPixCharge(INPUT);

  assert.equal(transport.calls.length, 1);
  assertRequest(transport.calls[0], fx.request);
  assert.equal(result.kind, 'succeeded');
  assert.equal(result.providerPaymentId, 'akkad-fixture-pay-001');
  assert.equal(result.providerTransactionId, 'akkad-fixture-pay-001');
  assert.equal(result.providerEndToEndId, 'E00000000000000000000000000000001');
  assert.equal(result.pix.copyAndPaste, '000201A5AKKADFIXTURE');
  assert.equal(result.paymentStatus, 'pending');
});

test('A5 AkkadPag missing credentials or invalid customer document fails before transport without placeholders', async () => {
  const { createAkkadPagAdapter } = await providers();
  const transport = { calls: [], async send(request) { this.calls.push(request); throw new Error('unexpected transport'); } };
  const adapter = createAkkadPagAdapter({ transport });

  const missingCredentials = await adapter.createPixCharge({ ...INPUT, credentials: { publicKey: '', secretKey: '' } });
  assert.equal(missingCredentials.kind, 'configuration_error');

  const invalidDocument = await adapter.createPixCharge({
    ...INPUT,
    customer: { ...INPUT.customer, document: '1234' },
  });
  assert.equal(invalidDocument.kind, 'pre_execution_failure');
  assert.equal(transport.calls.length, 0);
});

test('A5 AkkadPag monetary malformed 2xx, unproven 4xx, 5xx and ambiguous transport all remain execution_unknown with no retry', async () => {
  const { ProviderTransportError, createAkkadPagAdapter } = await providers();

  for (const name of ['pix-create-malformed-2xx.json', 'pix-create-ambiguous-4xx.json', 'pix-create-ambiguous-5xx.json']) {
    const fx = await fixture(name);
    const transport = fixtureTransport(fx, ProviderTransportError);
    const result = await createAkkadPagAdapter({ transport }).createPixCharge(INPUT);
    assert.equal(result.kind, 'execution_unknown', name);
    assert.equal(transport.calls.length, 1, name);
  }

  const transport = {
    calls: [],
    async send(request) {
      this.calls.push(request);
      throw new ProviderTransportError('transmission_ambiguous', 'ETIMEDOUT');
    },
  };
  const result = await createAkkadPagAdapter({ transport }).createPixCharge(INPUT);
  assert.equal(result.kind, 'execution_unknown');
  assert.equal(transport.calls.length, 1);
});

test('A5 AkkadPag query maps known historical statuses and fails closed on unknown status', async () => {
  const { ProviderTransportError, createAkkadPagAdapter } = await providers();
  for (const [name, expectedKind] of [
    ['pix-query-pending.json', 'found_pending'],
    ['pix-query-paid.json', 'found_paid'],
    ['pix-query-unknown-status.json', 'unrecognized_provider_status'],
  ]) {
    const fx = await fixture(name);
    const transport = fixtureTransport(fx, ProviderTransportError);
    const result = await createAkkadPagAdapter({ transport }).queryPixCharge({
      credentials: INPUT.credentials,
      providerPaymentId: 'akkad-fixture-pay-001',
    });
    assert.equal(transport.calls.length, 1, name);
    assertRequest(transport.calls[0], fx.request);
    assert.equal(result.kind, expectedKind, name);
  }
});

test('A5 AkkadPag payout requires withdrawalKey and preserves Processing as nonterminal while unknown status fails closed', async () => {
  const { ProviderTransportError, createAkkadPagAdapter } = await providers();
  const payoutInput = {
    credentials: { ...INPUT.credentials, withdrawalKey: 'wd_a5_fixture' },
    amountCents: 5000,
    clientReference: 'po_a5_akkad_001',
    pixKey: '00000000000',
    pixKeyType: 'cpf',
    postbackUrl: 'https://merchant.example.invalid/provider/akkadpag',
  };

  for (const [name, expectedStatus] of [
    ['payout-create-processing.json', 'processing'],
    ['payout-create-completed.json', 'completed'],
    ['payout-unknown-status.json', 'unrecognized_provider_status'],
  ]) {
    const fx = await fixture(name);
    const transport = fixtureTransport(fx, ProviderTransportError);
    const result = await createAkkadPagAdapter({ transport }).createPixPayout(payoutInput);
    assert.equal(transport.calls.length, 1, name);
    assertRequest(transport.calls[0], fx.request);
    assert.equal(result.kind, 'succeeded', name);
    assert.equal(result.payoutStatus, expectedStatus, name);
  }

  const noCall = { calls: [], async send(request) { this.calls.push(request); throw new Error('unexpected transport'); } };
  const missingWithdrawal = await createAkkadPagAdapter({ transport: noCall }).createPixPayout({
    ...payoutInput,
    credentials: INPUT.credentials,
  });
  assert.equal(missingWithdrawal.kind, 'configuration_error');
  assert.equal(noCall.calls.length, 0);
});
