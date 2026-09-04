import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const MAGICPAY_MODULE = '../../packages/providers/dist/magicpay.js';
const EVIDENCE_SHA = '8838db6276152af9d43d16ce71fa32cb9310b01f46f10c20897dea668d2f6833';

async function magicpay() {
  try {
    return await import(MAGICPAY_MODULE);
  } catch (error) {
    assert.fail(`A29 MagicPay implementation missing or unloadable: ${error?.code ?? error}`);
  }
}

const CREDENTIALS = {
  publicKey: 'pk_a29_fixture',
  secretKey: 'sk_a29_fixture',
};

const CREATE_INPUT = {
  credentials: CREDENTIALS,
  amountCents: 1250,
  clientReference: 'a29_fixture_payment_0001',
  description: 'A29 MagicPay fixture',
  customer: {
    name: 'A29 Fixture Customer',
    email: 'fixture@example.invalid',
    phone: '+55 (93) 99999-0000',
    document: '123.456.789-01',
  },
  postbackUrl: 'https://merchant.example.invalid/provider/magicpay',
};

test('A29 freezes provider-owned screenshot lineage and explicit third-provider decision', async () => {
  const [problem, spec, contract, adr] = await Promise.all([
    readFile(new URL('../../docs/design/a29-magicpay-response-query-contract-problem-analysis.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/specs/magicpay-response-query-contract-v0.yaml', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/contracts/magicpay-response-query-contract-v0.md', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/decisions/0005-admit-magicpay-provider-candidate.md', import.meta.url), 'utf8'),
  ]);

  for (const text of [problem, spec, contract]) assert.match(text, new RegExp(EVIDENCE_SHA, 'i'));
  assert.match(adr, /third provider candidate/i);
  assert.match(contract, /MUST NOT modify A10 or A11/i);
  assert.match(contract, /MUST NOT rename that value to `copyAndPaste`/i);
});

test('A29 exposes new response/query evidence metadata without live adapter authority', async () => {
  const { MAGICPAY_RESPONSE_QUERY_EVIDENCE } = await magicpay();
  assert.deepEqual(MAGICPAY_RESPONSE_QUERY_EVIDENCE, {
    provider: 'magicpay',
    status: 'response_query_contract_proven',
    sourceSha256: EVIDENCE_SHA,
    livePixAdapter: false,
    canonicalPixCopyAndPaste: false,
    a10Registered: false,
    gaps: [
      'pix_create_nested_pix_object_fields',
      'canonical_pix_copy_and_paste_semantics',
      'create_idempotency_semantics',
      'ambiguous_create_recovery',
      'provider_error_certainty_contract',
      'sandbox_environment',
      'authenticated_provider_proof',
      'webhook_authentication',
      'webhook_replay_identity',
      'rate_limits',
    ],
  });
});

test('A29 serializes documented optional pix.expiresInDays and validates positive int32 locally', async () => {
  const { buildMagicPayPixCreateRequest } = await magicpay();
  const result = buildMagicPayPixCreateRequest({ ...CREATE_INPUT, expiresInDays: 2 });
  assert.equal(result.ok, true);
  const body = JSON.parse(result.request.bodyUtf8);
  assert.deepEqual(body.pix, { expiresInDays: 2 });

  for (const expiresInDays of [0, -1, 1.5, 2147483648, '2']) {
    const invalid = buildMagicPayPixCreateRequest({ ...CREATE_INPUT, expiresInDays });
    assert.deepEqual(invalid, { ok: false, reason: 'invalid_input' }, String(expiresInDays));
  }
});

test('A29 maps only provider-documented MagicPay status vocabulary', async () => {
  const { normalizeMagicPayPaymentStatus } = await magicpay();
  assert.equal(normalizeMagicPayPaymentStatus('waiting_payment'), 'pending');
  assert.equal(normalizeMagicPayPaymentStatus(' PENDING '), 'pending');
  assert.equal(normalizeMagicPayPaymentStatus('paid'), 'paid');
  assert.equal(normalizeMagicPayPaymentStatus('refused'), 'failed');
  assert.equal(normalizeMagicPayPaymentStatus('refunded'), 'refunded');
  assert.equal(normalizeMagicPayPaymentStatus('chargedback'), 'disputed');
  assert.equal(normalizeMagicPayPaymentStatus('expired'), null);
  assert.equal(normalizeMagicPayPaymentStatus('processing'), null);
  assert.equal(normalizeMagicPayPaymentStatus(null), null);
});

test('A29 parses documented create-sale 200 envelope without inventing nested Pix semantics', async () => {
  const { parseMagicPayCreateResponse } = await magicpay();
  const result = parseMagicPayCreateResponse(JSON.stringify({
    id: 98765,
    amount: 1250,
    currency: 'BRL',
    paymentMethod: 'pix',
    status: 'pending',
    externalRef: 'a29_fixture_payment_0001',
    pix: { undocumentedForA29: 'opaque' },
  }));
  assert.deepEqual(result, {
    ok: true,
    transaction: {
      providerPaymentId: '98765',
      amountCents: 1250,
      paymentMethodRaw: 'pix',
      providerStatusRaw: 'pending',
      paymentStatus: 'pending',
      externalRef: 'a29_fixture_payment_0001',
    },
  });

  assert.deepEqual(parseMagicPayCreateResponse('{'), { ok: false, reason: 'response_invalid' });
  assert.deepEqual(parseMagicPayCreateResponse(JSON.stringify({ id: 1, status: 'expired' })), {
    ok: false,
    reason: 'unrecognized_provider_status',
    providerStatusRaw: 'expired',
  });
});

test('A29 parses documented create-sale 400 shape but assigns no execution certainty', async () => {
  const { parseMagicPayCreateErrorResponse } = await magicpay();
  assert.deepEqual(parseMagicPayCreateErrorResponse('{"code":400,"message":"Bad Request"}'), {
    ok: true,
    error: { code: 400, message: 'Bad Request' },
  });
  assert.deepEqual(parseMagicPayCreateErrorResponse('{"code":"400","message":"Bad Request"}'), {
    ok: false,
    reason: 'response_invalid',
  });
});

test('A29 builds exact Basic-authenticated transaction query with zero withdrawal/body material', async () => {
  const { buildMagicPayTransactionQueryRequest } = await magicpay();
  const result = buildMagicPayTransactionQueryRequest({ credentials: CREDENTIALS, providerPaymentId: '98765' });
  assert.equal(result.ok, true);
  assert.equal(result.request.method, 'GET');
  assert.equal(result.request.relativePath, 'transactions/98765');
  assert.equal(result.request.bodyUtf8, undefined);
  assert.equal(
    result.request.headers.Authorization,
    `Basic ${Buffer.from(`${CREDENTIALS.publicKey}:${CREDENTIALS.secretKey}`, 'utf8').toString('base64')}`,
  );
  assert.equal(result.request.headers['x-withdraw-key'], undefined);

  for (const providerPaymentId of ['', '0', '-1', 'abc', 0, -1, 1.5]) {
    assert.deepEqual(
      buildMagicPayTransactionQueryRequest({ credentials: CREDENTIALS, providerPaymentId }),
      { ok: false, reason: 'invalid_input' },
      String(providerPaymentId),
    );
  }
});

test('A29 parses query 200 envelope and preserves Pix only as providerPixValue', async () => {
  const { parseMagicPayTransactionQueryResponse } = await magicpay();
  const result = parseMagicPayTransactionQueryResponse(JSON.stringify({
    id: 98765,
    amount: 1250,
    paymentMethod: 'pix',
    status: 'paid',
    paidAt: '2026-09-03T23:00:00.000Z',
    externalRef: 'a29_fixture_payment_0001',
    pix: 'provider-documented-pix-key-or-code',
  }));
  assert.deepEqual(result, {
    ok: true,
    transaction: {
      providerPaymentId: '98765',
      amountCents: 1250,
      paymentMethodRaw: 'pix',
      providerStatusRaw: 'paid',
      paymentStatus: 'paid',
      providerPixValue: 'provider-documented-pix-key-or-code',
      paidAt: '2026-09-03T23:00:00.000Z',
      externalRef: 'a29_fixture_payment_0001',
    },
  });
  assert.equal('copyAndPaste' in result.transaction, false);

  assert.deepEqual(parseMagicPayTransactionQueryResponse(JSON.stringify({ id: 98765, status: 'mystery' })), {
    ok: false,
    reason: 'unrecognized_provider_status',
    providerStatusRaw: 'mystery',
  });
});

test('A29 still exposes no live adapter, no public barrel export and no A10 MagicPay registration', async () => {
  const module = await magicpay();
  assert.equal('createMagicPayAdapter' in module, false);

  const [activation, providerIndex] = await Promise.all([
    readFile(new URL('../../packages/providers/src/activation.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/providers/src/index.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(activation, /['"]magicpay['"]/i);
  assert.doesNotMatch(providerIndex, /export\s+\*\s+from\s+['"]\.\/magicpay\.js['"]/i);
});
