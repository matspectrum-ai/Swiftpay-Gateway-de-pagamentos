import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ACTIVE_ID = 'cursor-2026-08-b';
const PREVIOUS_ID = 'cursor-2026-08-a';
const ACTIVE_KEY = 'a16-active-cursor-secret-0123456789abcdef0123456789';
const PREVIOUS_KEY = 'a16-previous-cursor-secret-0123456789abcdef01234567';
const LEGACY_KEY = 'a16-legacy-v0-cursor-secret-0123456789abcdef012345';
const WRONG_KEY = 'a16-wrong-cursor-secret-0123456789abcdef0123456789';

const MERCHANT_ID = '20000000-0000-0000-0000-0000000000a9';
const FOREIGN_MERCHANT_ID = '20000000-0000-0000-0000-0000000000ff';
const PAYMENT_ID = '30000000-0000-0000-0000-0000000000a2';
const CREATED_AT = '2026-08-17T05:00:00.000Z';
const EMPTY_FILTERS = { status: null, externalId: null, createdFrom: null, createdTo: null };

async function imports() {
  const [payments, config] = await Promise.all([
    import('../../packages/payments/dist/index.js'),
    import('../../packages/config/dist/index.js'),
  ]);
  return { payments, config };
}

function keyringInput(overrides = {}) {
  return {
    activeKeyId: ACTIVE_ID,
    keys: [
      { id: ACTIVE_ID, secret: ACTIVE_KEY },
      { id: PREVIOUS_ID, secret: PREVIOUS_KEY },
    ],
    legacyV0Key: LEGACY_KEY,
    ...overrides,
  };
}

function validConfigSource(overrides = {}) {
  return {
    SWIFTPAY_ENVIRONMENT: 'sandbox',
    SWIFTPAY_API_DATABASE_URL: 'postgresql://api:test@127.0.0.1:5432/postgres',
    SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID: 'machine-current',
    SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([
      { id: 'machine-current', secret: 'a15-machine-signing-secret-0123456789abcdef0123456789' },
    ]),
    SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID: ACTIVE_ID,
    SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: JSON.stringify(keyringInput().keys),
    SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY: LEGACY_KEY,
    SWIFTPAY_ABUSE_HMAC_KEY: 'a14-abuse-test-key-0123456789abcdef0123456789abcdef',
    SWIFTPAY_SUPABASE_URL: 'https://project-a6.supabase.co',
    SWIFTPAY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_a6_test_key',
    SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID: 'webhook-wrap-a7-test',
    SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY: 'AQID',
    ...overrides,
  };
}

function cursorInput(overrides = {}) {
  return {
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    filters: EMPTY_FILTERS,
    createdAt: CREATED_AT,
    paymentId: PAYMENT_ID,
    ...overrides,
  };
}

function filterDigest(filters) {
  return createHash('sha256')
    .update(`a9-filter-v0\n${JSON.stringify([
      filters.status,
      filters.externalId,
      filters.createdFrom,
      filters.createdTo,
    ])}`, 'utf8')
    .digest('hex');
}

function payloadFor(input = cursorInput()) {
  return Buffer.from(JSON.stringify([
    input.merchantId,
    input.environment,
    filterDigest(input.filters),
    input.createdAt,
    input.paymentId,
  ]), 'utf8').toString('base64url');
}

function legacyV0Token(key = LEGACY_KEY, input = cursorInput()) {
  const payload = payloadFor(input);
  const signed = `a9v0.${payload}`;
  const signature = createHmac('sha256', key).update(signed, 'ascii').digest('base64url');
  return `${signed}.${signature}`;
}

function resignV1WithKid(token, kid, secret) {
  const parts = token.split('.');
  assert.equal(parts.length, 4);
  const signed = `a9v1.${kid}.${parts[2]}`;
  const signature = createHmac('sha256', secret).update(signed, 'ascii').digest('base64url');
  return `${signed}.${signature}`;
}

function decode(codec, token, overrides = {}) {
  return codec.decode({
    token,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    filters: EMPTY_FILTERS,
    ...overrides,
  });
}

test('A16 config exports the frozen dashboard cursor rotation variables and limits', async () => {
  const { config, payments } = await imports();
  assert.equal(typeof payments.createDashboardTransactionCursorCodec, 'function');
  assert.equal(config.DASHBOARD_CURSOR_ACTIVE_KEY_ID_ENV, 'SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID');
  assert.equal(config.DASHBOARD_CURSOR_HMAC_KEYS_ENV, 'SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS');
  assert.equal(config.DASHBOARD_CURSOR_LEGACY_V0_KEY_ENV, 'SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY');
  assert.equal(config.MIN_DASHBOARD_CURSOR_HMAC_KEY_BYTES, 32);
  assert.equal(config.MAX_DASHBOARD_CURSOR_HMAC_KEYS, 4);
});

test('A16 config accepts a bounded immutable keyring and exact active key identity', async () => {
  const { config } = await imports();
  const loaded = config.loadApiConfig(validConfigSource());
  assert.equal(loaded.dashboardCursorActiveKeyId, ACTIVE_ID);
  assert.deepEqual(loaded.dashboardCursorHmacKeys, keyringInput().keys);
  assert.equal(loaded.dashboardCursorLegacyV0Key, LEGACY_KEY);
  assert.equal(Object.isFrozen(loaded.dashboardCursorHmacKeys), true);
  assert.equal(Object.isFrozen(loaded.dashboardCursorHmacKeys[0]), true);
  assert.equal('dashboardCursorHmacKey' in loaded, false);
});

test('A16 config rejects old single-key-only and malformed keyring states without secret echo', async () => {
  const { config } = await imports();
  const oldOnly = validConfigSource();
  delete oldOnly.SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID;
  delete oldOnly.SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS;
  delete oldOnly.SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY;
  oldOnly.SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY = ACTIVE_KEY;
  assert.throws(() => config.loadApiConfig(oldOnly));

  const invalidCases = [
    { SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID: 'BAD ID' },
    { SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: '{}' },
    { SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: '[]' },
    { SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: JSON.stringify([{ id: ACTIVE_ID, secret: 'short' }]) },
    { SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: JSON.stringify([
      { id: ACTIVE_ID, secret: ACTIVE_KEY },
      { id: ACTIVE_ID, secret: PREVIOUS_KEY },
    ]) },
    { SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: JSON.stringify([
      { id: ACTIVE_ID, secret: ACTIVE_KEY },
      { id: PREVIOUS_ID, secret: ACTIVE_KEY },
    ]) },
    { SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: JSON.stringify([{ id: ACTIVE_ID, secret: ACTIVE_KEY, extra: true }]) },
    { SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: JSON.stringify([{ id: PREVIOUS_ID, secret: PREVIOUS_KEY }]) },
    { SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: JSON.stringify([
      { id: 'a', secret: `${ACTIVE_KEY}a` },
      { id: 'b', secret: `${ACTIVE_KEY}b` },
      { id: 'c', secret: `${ACTIVE_KEY}c` },
      { id: 'd', secret: `${ACTIVE_KEY}d` },
      { id: 'e', secret: `${ACTIVE_KEY}e` },
    ]) },
    { SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY: 'short' },
  ];

  for (const override of invalidCases) {
    assert.throws(
      () => config.loadApiConfig(validConfigSource(override)),
      (error) => {
        const text = String(error?.message);
        assert.doesNotMatch(text, new RegExp(ACTIVE_KEY));
        assert.doesNotMatch(text, new RegExp(PREVIOUS_KEY));
        assert.doesNotMatch(text, new RegExp(LEGACY_KEY));
        return true;
      },
    );
  }
});

test('A16 codec runtime-validates authority and snapshots caller-owned keyring input', async () => {
  const { payments } = await imports();
  assert.throws(() => payments.createDashboardTransactionCursorCodec({ activeKeyId: ACTIVE_ID, keys: [] }));
  assert.throws(() => payments.createDashboardTransactionCursorCodec({
    activeKeyId: ACTIVE_ID,
    keys: [{ id: ACTIVE_ID, secret: 'short' }],
  }));

  const source = keyringInput();
  const codec = payments.createDashboardTransactionCursorCodec(source);
  const token = codec.encode(cursorInput());
  source.keys[0].secret = WRONG_KEY;
  source.keys.push({ id: 'late-mutation', secret: WRONG_KEY });
  assert.equal(decode(codec, token).ok, true);
});

test('A16 issues a9v1 cursors with only the active kid and active HMAC key', async () => {
  const { payments } = await imports();
  const codec = payments.createDashboardTransactionCursorCodec(keyringInput());
  const token = codec.encode(cursorInput());
  assert.match(token, /^a9v1\.cursor-2026-08-b\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(decode(codec, token), { ok: true, cursor: { createdAt: CREATED_AT, paymentId: PAYMENT_ID } });

  const previousOnly = payments.createDashboardTransactionCursorCodec({
    activeKeyId: PREVIOUS_ID,
    keys: [{ id: PREVIOUS_ID, secret: PREVIOUS_KEY }],
  });
  assert.equal(decode(previousOnly, token).ok, false);
});

test('A16 verifies an old non-active v1 cursor by exact retained kid and survives active-key rotation', async () => {
  const { payments } = await imports();
  const previousIssuer = payments.createDashboardTransactionCursorCodec({
    activeKeyId: PREVIOUS_ID,
    keys: [{ id: PREVIOUS_ID, secret: PREVIOUS_KEY }],
  });
  const oldToken = previousIssuer.encode(cursorInput());
  assert.match(oldToken, /^a9v1\.cursor-2026-08-a\./);

  const rotated = payments.createDashboardTransactionCursorCodec(keyringInput());
  assert.deepEqual(decode(rotated, oldToken), { ok: true, cursor: { createdAt: CREATED_AT, paymentId: PAYMENT_ID } });
  assert.match(rotated.encode(cursorInput()), /^a9v1\.cursor-2026-08-b\./);
});

test('A16 retiring a v1 kid invalidates only cursors carrying that removed kid', async () => {
  const { payments } = await imports();
  const both = payments.createDashboardTransactionCursorCodec(keyringInput());
  const currentToken = both.encode(cursorInput());
  const previousIssuer = payments.createDashboardTransactionCursorCodec({
    activeKeyId: PREVIOUS_ID,
    keys: [{ id: PREVIOUS_ID, secret: PREVIOUS_KEY }],
  });
  const previousToken = previousIssuer.encode(cursorInput());
  const retired = payments.createDashboardTransactionCursorCodec({
    activeKeyId: ACTIVE_ID,
    keys: [{ id: ACTIVE_ID, secret: ACTIVE_KEY }],
  });
  assert.equal(decode(retired, currentToken).ok, true);
  assert.equal(decode(retired, previousToken).ok, false);
});

test('A16 unknown kid signed by a configured secret fails closed instead of trial-all verification', async () => {
  const { payments } = await imports();
  const codec = payments.createDashboardTransactionCursorCodec(keyringInput());
  const issued = codec.encode(cursorInput());
  const forged = resignV1WithKid(issued, 'cursor-unknown', ACTIVE_KEY);
  assert.equal(decode(codec, forged).ok, false);
});

test('A16 malformed version kid segment count base64 and signature all map to the same invalid_cursor contract', async () => {
  const { payments } = await imports();
  const codec = payments.createDashboardTransactionCursorCodec(keyringInput());
  const issued = codec.encode(cursorInput());
  const parts = issued.split('.');
  const candidates = [
    'a9v2.x.y.z',
    `a9v1.BAD ID.${parts[2]}.${parts[3]}`,
    `a9v1.${ACTIVE_ID}.${parts[2]}`,
    `a9v1.${ACTIVE_ID}.=.${parts[3]}`,
    `${issued.slice(0, -1)}${issued.endsWith('A') ? 'B' : 'A'}`,
  ];
  for (const token of candidates) {
    assert.deepEqual(decode(codec, token), {
      ok: false,
      violation: { field: 'cursor', code: 'invalid_cursor', message: 'Invalid transaction cursor.' },
    });
  }
});

test('A16 verifies legacy a9v0 only through explicit verify-only legacy authority and never issues v0', async () => {
  const { payments } = await imports();
  const token = legacyV0Token();
  const withLegacy = payments.createDashboardTransactionCursorCodec(keyringInput());
  const withoutLegacy = payments.createDashboardTransactionCursorCodec({
    activeKeyId: ACTIVE_ID,
    keys: keyringInput().keys,
  });
  assert.deepEqual(decode(withLegacy, token), { ok: true, cursor: { createdAt: CREATED_AT, paymentId: PAYMENT_ID } });
  assert.equal(decode(withoutLegacy, token).ok, false);
  assert.match(withLegacy.encode(cursorInput()), /^a9v1\./);
});

test('A16 legacy v0 never falls back to a current v1 keyring secret when legacy slot is absent', async () => {
  const { payments } = await imports();
  const ringSignedV0 = legacyV0Token(ACTIVE_KEY);
  const codec = payments.createDashboardTransactionCursorCodec({
    activeKeyId: ACTIVE_ID,
    keys: keyringInput().keys,
  });
  assert.equal(decode(codec, ringSignedV0).ok, false);
});

test('A16 preserves exact A9 merchant environment and normalized-filter cursor binding', async () => {
  const { payments } = await imports();
  const codec = payments.createDashboardTransactionCursorCodec(keyringInput());
  const token = codec.encode(cursorInput());
  assert.equal(decode(codec, token, { merchantId: FOREIGN_MERCHANT_ID }).ok, false);
  assert.equal(decode(codec, token, { environment: 'production' }).ok, false);
  assert.equal(decode(codec, token, { filters: { ...EMPTY_FILTERS, status: 'paid' } }).ok, false);
});

test('A16 production wiring uses explicit cursor keyring authority and does not consume the retired single-key field', async () => {
  const [runtimeSource, indexSource, configSource] = await Promise.all([
    readFile(new URL('../../apps/api/src/runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/api/src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/config/src/index.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(runtimeSource, /dashboardCursorActiveKeyId/);
  assert.match(runtimeSource, /dashboardCursorHmacKeys/);
  assert.match(runtimeSource, /dashboardCursorLegacyV0Key/);
  assert.match(indexSource, /dashboardCursorActiveKeyId:\s*config\.dashboardCursorActiveKeyId/);
  assert.match(indexSource, /dashboardCursorHmacKeys:\s*config\.dashboardCursorHmacKeys/);
  assert.match(indexSource, /dashboardCursorLegacyV0Key/);
  assert.doesNotMatch(configSource, /['"]SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY['"]/);
  assert.doesNotMatch(runtimeSource, /key:\s*options\.dashboardCursorHmacKey/);
});

test('A16 remains application-only and does not modify A14/A15/provider authority surfaces', async () => {
  const [configSource, runtimeSource] = await Promise.all([
    readFile(new URL('../../packages/config/src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/api/src/runtime.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(configSource, /SWIFTPAY_ABUSE_HMAC_KEY/);
  assert.match(configSource, /SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS/);
  assert.match(runtimeSource, /createApiAbuseControls/);
  assert.match(runtimeSource, /createAccessTokenSigningAuthority/);
  assert.doesNotMatch(runtimeSource, /createStrictProviderHttpTransport/);
});
