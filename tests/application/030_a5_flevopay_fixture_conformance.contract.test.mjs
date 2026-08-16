import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MODULE = '../../packages/providers/dist/index.js';
const FIXTURE_ROOT = new URL('./provider-fixtures/flevopay/', import.meta.url);

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
  credentials: { secretKey: 'sk_a5_flevo_fixture' },
  amountCents: 12345,
  clientReference: 'pa_a5_flevo_001',
  description: 'A5 fixture payment',
  customer: {
    name: 'A5 Fixture Customer',
    email: 'fixture@example.invalid',
    phone: '+55 (00) 00000-0000',
    document: '123.456.789-01',
  },
  postbackUrl: 'https://merchant.example.invalid/provider/flevopay',
};

test('A5 FlevoPay maps the frozen legacy-lineage Pix request with X-API-Key and stable client reference', async () => {
  const { ProviderTransportError, createFlevoPayAdapter } = await providers();
  const fx = await fixture('pix-create-success.json');
  const transport = fixtureTransport(fx, ProviderTransportError);
  const result = await createFlevoPayAdapter({ transport }).createPixCharge(INPUT);

  assert.equal(transport.calls.length, 1);
  assertRequest(transport.calls[0], fx.request);
  assert.equal(result.kind, 'succeeded');
  assert.equal(result.providerPaymentId, '84001');
  assert.equal(result.providerTransactionId, '84001');
  assert.equal(result.providerSpecificLookupReference, '84001');
  assert.equal(result.pix.copyAndPaste, '000201A5FLEVOFIXTURE');
  assert.equal(result.paymentStatus, 'pending');
});

test('A5 FlevoPay missing credentials or customer fields fails before transport without legacy placeholders', async () => {
  const { createFlevoPayAdapter } = await providers();
  const transport = { calls: [], async send(request) { this.calls.push(request); throw new Error('unexpected transport'); } };
  const adapter = createFlevoPayAdapter({ transport });

  const missingCredentials = await adapter.createPixCharge({ ...INPUT, credentials: { secretKey: '' } });
  assert.equal(missingCredentials.kind, 'configuration_error');

  const missingPhone = await adapter.createPixCharge({
    ...INPUT,
    customer: { name: INPUT.customer.name, email: INPUT.customer.email, document: INPUT.customer.document },
  });
  assert.equal(missingPhone.kind, 'pre_execution_failure');
  assert.equal(transport.calls.length, 0);
});

test('A5 FlevoPay monetary malformed 2xx, unproven 4xx, 5xx and ambiguous transport all remain execution_unknown with no retry', async () => {
  const { ProviderTransportError, createFlevoPayAdapter } = await providers();

  for (const name of ['pix-create-malformed-2xx.json', 'pix-create-ambiguous-4xx.json', 'pix-create-ambiguous-5xx.json']) {
    const fx = await fixture(name);
    const transport = fixtureTransport(fx, ProviderTransportError);
    const result = await createFlevoPayAdapter({ transport }).createPixCharge(INPUT);
    assert.equal(result.kind, 'execution_unknown', name);
    assert.equal(transport.calls.length, 1, name);
  }

  const transport = {
    calls: [],
    async send(request) {
      this.calls.push(request);
      throw new ProviderTransportError('transmission_ambiguous', 'ECONNRESET');
    },
  };
  const result = await createFlevoPayAdapter({ transport }).createPixCharge(INPUT);
  assert.equal(result.kind, 'execution_unknown');
  assert.equal(transport.calls.length, 1);
});

test('A5 FlevoPay query uses the provider lookup reference, URL encoding and fail-closed status normalization', async () => {
  const { ProviderTransportError, createFlevoPayAdapter } = await providers();
  for (const [name, expectedKind] of [
    ['pix-query-pending.json', 'found_pending'],
    ['pix-query-paid.json', 'found_paid'],
    ['pix-query-unknown-status.json', 'unrecognized_provider_status'],
  ]) {
    const fx = await fixture(name);
    const transport = fixtureTransport(fx, ProviderTransportError);
    const result = await createFlevoPayAdapter({ transport }).queryPixCharge({
      credentials: INPUT.credentials,
      providerSpecificLookupReference: '84001',
    });
    assert.equal(transport.calls.length, 1, name);
    assertRequest(transport.calls[0], fx.request);
    assert.equal(result.kind, expectedKind, name);
  }

  const encodedTransport = {
    calls: [],
    async send(request) {
      this.calls.push(request);
      return { statusCode: 200, headers: {}, bodyUtf8: JSON.stringify({ id: 'a/b', status: 'pending', amount: 1 }) };
    },
  };
  await createFlevoPayAdapter({ transport: encodedTransport }).queryPixCharge({
    credentials: INPUT.credentials,
    providerSpecificLookupReference: 'a/b',
  });
  assert.equal(encodedTransport.calls[0].relativePath, 'query?action=get_transaction&id=a%2Fb');
});

test('A5 FlevoPay Pix-out and refund stay unsupported and produce zero transport calls', async () => {
  const { createFlevoPayAdapter } = await providers();
  const transport = { calls: [], async send(request) { this.calls.push(request); throw new Error('unexpected transport'); } };
  const adapter = createFlevoPayAdapter({ transport });

  const payout = await adapter.createPixPayout({
    credentials: INPUT.credentials,
    amountCents: 5000,
    clientReference: 'po_a5_flevo_unsupported',
    pixKey: '00000000000',
    pixKeyType: 'cpf',
  });
  const refund = await adapter.createRefund({ credentials: INPUT.credentials });

  assert.equal(payout.kind, 'unsupported');
  assert.equal(refund.kind, 'unsupported');
  assert.equal(transport.calls.length, 0);
});
