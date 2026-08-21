import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE = '../../packages/providers/dist/index.js';

async function providers() {
  try {
    return await import(MODULE);
  } catch (error) {
    assert.fail(`A5 providers implementation missing or unloadable: ${error?.code ?? error}`);
  }
}

function countingTransport(handler = async () => {
  throw new Error('unexpected transport call');
}) {
  const calls = [];
  return {
    calls,
    async send(request) {
      calls.push(request);
      return handler(request);
    },
  };
}

const CUSTOMER = {
  name: 'A5 Fixture Customer',
  email: 'fixture@example.invalid',
  phone: '5500000000000',
  document: '12345678901',
};

test('A5 provider surface exposes exactly the frozen retained capability matrix and no live activation', async () => {
  const { PROVIDER_CAPABILITIES } = await providers();
  assert.deepEqual(PROVIDER_CAPABILITIES, {
    akkadpag: {
      provider: 'akkadpag',
      activation: 'fixture_only',
      pixIn: true,
      pixQuery: true,
      pixOut: true,
      refund: false,
      webhookAuthority: false,
    },
    flevopay: {
      provider: 'flevopay',
      activation: 'fixture_only',
      pixIn: true,
      pixQuery: true,
      pixOut: false,
      refund: false,
      webhookAuthority: false,
    },
  });
});

test('A5 provider adapters reject invalid cents or missing real customer data before transport and never synthesize identity', async () => {
  const { createAkkadPagAdapter, createFlevoPayAdapter } = await providers();

  for (const [createAdapter, credentials] of [
    [createAkkadPagAdapter, { publicKey: 'pk_a5_fixture', secretKey: 'sk_a5_fixture' }],
    [createFlevoPayAdapter, { secretKey: 'sk_a5_flevo_fixture' }],
  ]) {
    const transport = countingTransport();
    const adapter = createAdapter({ transport });

    const invalidAmount = await adapter.createPixCharge({
      credentials,
      amountCents: 12.5,
      clientReference: 'pa_a5_invalid_amount',
      description: 'A5 invalid amount',
      customer: CUSTOMER,
      postbackUrl: 'https://merchant.example.invalid/provider/a5',
    });
    assert.equal(invalidAmount.kind, 'pre_execution_failure');

    const missingCustomer = await adapter.createPixCharge({
      credentials,
      amountCents: 12345,
      clientReference: 'pa_a5_missing_customer',
      description: 'A5 missing customer',
      customer: { name: CUSTOMER.name, document: CUSTOMER.document, email: CUSTOMER.email },
      postbackUrl: 'https://merchant.example.invalid/provider/a5',
    });
    assert.equal(missingCustomer.kind, 'pre_execution_failure');
    assert.equal(transport.calls.length, 0);
  }
});

test('A5 unsupported capabilities fail locally with zero provider traffic', async () => {
  const { createAkkadPagAdapter, createFlevoPayAdapter } = await providers();
  const akkadTransport = countingTransport();
  const flevoTransport = countingTransport();
  const akkad = createAkkadPagAdapter({ transport: akkadTransport });
  const flevo = createFlevoPayAdapter({ transport: flevoTransport });

  const flevoPayout = await flevo.createPixPayout({
    credentials: { secretKey: 'sk_a5_flevo_fixture' },
    amountCents: 5000,
    clientReference: 'po_a5_flevo_unsupported',
    pixKey: '00000000000',
    pixKeyType: 'cpf',
  });
  const flevoRefund = await flevo.createRefund({ credentials: { secretKey: 'sk_a5_flevo_fixture' } });
  const akkadRefund = await akkad.createRefund({ credentials: { publicKey: 'pk_a5_fixture', secretKey: 'sk_a5_fixture' } });

  assert.equal(flevoPayout.kind, 'unsupported');
  assert.equal(flevoRefund.kind, 'unsupported');
  assert.equal(akkadRefund.kind, 'unsupported');
  assert.equal(flevoTransport.calls.length, 0);
  assert.equal(akkadTransport.calls.length, 0);
});

test('A5 ambiguous monetary transport becomes execution_unknown after exactly one attempt', async () => {
  const { ProviderTransportError, createAkkadPagAdapter, createFlevoPayAdapter } = await providers();

  for (const [createAdapter, credentials] of [
    [createAkkadPagAdapter, { publicKey: 'pk_a5_fixture', secretKey: 'sk_a5_fixture' }],
    [createFlevoPayAdapter, { secretKey: 'sk_a5_flevo_fixture' }],
  ]) {
    const transport = countingTransport(async () => {
      throw new ProviderTransportError('transmission_ambiguous', 'ECONNRESET');
    });
    const adapter = createAdapter({ transport });
    const result = await adapter.createPixCharge({
      credentials,
      amountCents: 12345,
      clientReference: 'pa_a5_ambiguous',
      description: 'A5 ambiguous transport',
      customer: CUSTOMER,
      postbackUrl: 'https://merchant.example.invalid/provider/a5',
    });
    assert.equal(result.kind, 'execution_unknown');
    assert.equal(transport.calls.length, 1);
  }
});

test('A5 live provider webhook authority is unavailable for both retained providers', async () => {
  const { createAkkadPagAdapter, createFlevoPayAdapter } = await providers();
  for (const adapter of [
    createAkkadPagAdapter({ transport: countingTransport() }),
    createFlevoPayAdapter({ transport: countingTransport() }),
  ]) {
    const result = await adapter.verifyWebhook({ headers: {}, bodyUtf8: '{"status":"paid"}' });
    assert.deepEqual(result, { kind: 'verification_unavailable', trusted: false });
  }
});
