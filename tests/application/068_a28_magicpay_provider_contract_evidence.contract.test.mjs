import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const MAGICPAY_MODULE = '../../packages/providers/dist/magicpay.js';

async function magicpay() {
  try {
    return await import(MAGICPAY_MODULE);
  } catch (error) {
    assert.fail(`A28 MagicPay implementation missing or unloadable: ${error?.code ?? error}`);
  }
}

const CREDENTIALS = {
  publicKey: 'pk_a28_fixture',
  secretKey: 'sk_a28_fixture',
};

const INPUT = {
  credentials: CREDENTIALS,
  amountCents: 1250,
  clientReference: 'a28_fixture_payment_0001',
  description: 'A28 MagicPay fixture',
  customer: {
    name: 'A28 Fixture Customer',
    email: 'fixture@example.invalid',
    phone: '+55 (93) 99999-0000',
    document: '123.456.789-01',
  },
  postbackUrl: 'https://merchant.example.invalid/provider/magicpay',
};

test('A28 frozen artifacts preserve the provider guide hash and unresolved safety gaps', async () => {
  const [problem, spec, contract] = await Promise.all([
    readFile(new URL('../../docs/design/a28-magicpay-provider-contract-evidence-problem-analysis.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/specs/magicpay-provider-contract-evidence-v0.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/contracts/magicpay-provider-contract-evidence-v0.md', import.meta.url), 'utf8'),
  ]);

  for (const text of [problem, spec, contract]) {
    assert.match(text, /b9b493227d45b880077383c145e9ca5a0c16e6fae327b84d2c614566b8c47104/i);
    assert.match(text, /https:\/\/api\.dashboardmagicpay\.com\/v1/);
  }
  assert.match(spec, /create_idempotency_semantics/);
  assert.match(spec, /webhook_authentication/);
  assert.match(contract, /MUST NOT use `externalRef` as a provider idempotency guarantee/i);
  assert.match(contract, /webhookAuthority = false/i);
});

test('A28 dedicated module exposes exact partial MagicPay evidence metadata and keeps live monetary activation false', async () => {
  const { MAGICPAY_CONTRACT_EVIDENCE } = await magicpay();

  assert.deepEqual(MAGICPAY_CONTRACT_EVIDENCE, {
    provider: 'magicpay',
    status: 'partial_contract_only',
    sourceSha256: 'b9b493227d45b880077383c145e9ca5a0c16e6fae327b84d2c614566b8c47104',
    baseUrl: 'https://api.dashboardmagicpay.com/v1',
    auth: 'basic_public_secret',
    livePixAdapter: false,
    webhookAuthority: false,
    withdrawalAuthority: false,
    gaps: [
      'pix_create_success_response_schema',
      'pix_qr_copy_and_paste_field',
      'transaction_query_response_envelope',
      'create_idempotency_semantics',
      'ambiguous_create_recovery',
      'provider_error_certainty_contract',
      'sandbox_environment',
      'webhook_authentication',
      'webhook_replay_identity',
      'rate_limits',
    ],
  });
});

test('A28 pure Pix builder uses documented Basic auth and exact camelCase request vocabulary', async () => {
  const { buildMagicPayPixCreateRequest } = await magicpay();
  const result = buildMagicPayPixCreateRequest(INPUT);
  assert.equal(result.ok, true);

  const request = result.request;
  assert.equal(request.method, 'POST');
  assert.equal(request.relativePath, 'transactions');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(
    request.headers.Authorization,
    `Basic ${Buffer.from(`${CREDENTIALS.publicKey}:${CREDENTIALS.secretKey}`, 'utf8').toString('base64')}`,
  );
  assert.equal(request.headers['x-withdraw-key'], undefined);

  assert.deepEqual(JSON.parse(request.bodyUtf8), {
    amount: 1250,
    paymentMethod: 'pix',
    items: [{
      title: 'A28 MagicPay fixture',
      unitPrice: 1250,
      quantity: 1,
      tangible: false,
      externalRef: 'a28_fixture_payment_0001',
    }],
    customer: {
      name: 'A28 Fixture Customer',
      email: 'fixture@example.invalid',
      phone: '5593999990000',
      document: { number: '12345678901', type: 'cpf' },
    },
    externalRef: 'a28_fixture_payment_0001',
    postbackUrl: 'https://merchant.example.invalid/provider/magicpay',
  });
});

test('A28 Pix builder rejects invalid money/identity/credentials locally', async () => {
  const { buildMagicPayPixCreateRequest } = await magicpay();

  for (const patch of [
    { amountCents: 12.5 },
    { amountCents: 0 },
    { credentials: { publicKey: '', secretKey: 'x' } },
    { credentials: { publicKey: 'x', secretKey: '' } },
    { customer: { ...INPUT.customer, phone: '123' } },
    { customer: { ...INPUT.customer, document: '1234' } },
    { clientReference: ' ' },
  ]) {
    const result = buildMagicPayPixCreateRequest({ ...INPUT, ...patch });
    assert.deepEqual(result, { ok: false, reason: 'invalid_input' });
  }
});

test('A28 read-only MagicPay client is limited to company and balance with one Basic-authenticated GET', async () => {
  const { createMagicPayReadOnlyClient } = await magicpay();
  const calls = [];
  const transport = {
    async send(request) {
      calls.push(request);
      return { statusCode: 200, headers: {}, bodyUtf8: '{"opaque":true}' };
    },
  };
  const client = createMagicPayReadOnlyClient({ transport });

  const company = await client.getCompany({ credentials: CREDENTIALS });
  const balance = await client.getBalance({ credentials: CREDENTIALS });

  assert.deepEqual(company, { kind: 'ok', data: { opaque: true } });
  assert.deepEqual(balance, { kind: 'ok', data: { opaque: true } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => [call.method, call.relativePath]), [
    ['GET', 'company'],
    ['GET', 'balance/available'],
  ]);
  for (const call of calls) {
    assert.equal(call.bodyUtf8, undefined);
    assert.equal(
      call.headers.Authorization,
      `Basic ${Buffer.from(`${CREDENTIALS.publicKey}:${CREDENTIALS.secretKey}`, 'utf8').toString('base64')}`,
    );
    assert.equal(call.headers['x-withdraw-key'], undefined);
  }
});

test('A28 exposes no live MagicPay adapter, no public provider barrel export and no A10 activation', async () => {
  const module = await magicpay();
  assert.equal('createMagicPayAdapter' in module, false);

  const [activation, providerIndex] = await Promise.all([
    readFile(new URL('../../packages/providers/src/activation.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/providers/src/index.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(activation, /['"]magicpay['"]/i);
  assert.doesNotMatch(providerIndex, /export\s+\*\s+from\s+['"]\.\/magicpay\.js['"]/i);
});
