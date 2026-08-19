import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ACTIVE_KEY = 'a18-active-abuse-hmac-key-0123456789abcdef0123456789';
const PREVIOUS_KEY = 'a18-previous-abuse-hmac-key-0123456789abcdef01234567';
const ACTIVE_HASH = 'a'.repeat(64);
const PREVIOUS_HASH = 'b'.repeat(64);

async function requireAbuse() {
  const module = await import('../../packages/abuse/dist/index.js');
  assert.equal(typeof module.createApiAbuseControls, 'function');
  return module;
}

async function requireDbStoreFactory() {
  const db = await import('../../packages/db/dist/index.js');
  assert.equal(typeof db.createApiAbuseRateLimitStore, 'function');
  return db.createApiAbuseRateLimitStore;
}

function validConfigSource(overrides = {}) {
  return {
    SWIFTPAY_ENVIRONMENT: 'sandbox',
    SWIFTPAY_API_DATABASE_URL: 'postgresql://api:test@127.0.0.1:5432/postgres',
    SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID: 'machine-current',
    SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([
      { id: 'machine-current', secret: 'a15-machine-signing-secret-0123456789abcdef0123456789' },
    ]),
    SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID: 'cursor-current',
    SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS: JSON.stringify([
      { id: 'cursor-current', secret: 'a16-cursor-signing-secret-0123456789abcdef0123456789' },
    ]),
    SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY: 'a16-legacy-v0-cursor-secret-0123456789abcdef012345',
    SWIFTPAY_ABUSE_HMAC_KEY: ACTIVE_KEY,
    SWIFTPAY_SUPABASE_URL: 'https://project-a18.supabase.co',
    SWIFTPAY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_a18_test_key',
    SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID: 'webhook-wrap-a18-test',
    SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY: 'AQID',
    ...overrides,
  };
}

function hash(key, subjectClass, canonicalSubject) {
  return createHmac('sha256', key)
    .update(`a14v0\n${subjectClass}\n${canonicalSubject}`, 'utf8')
    .digest('hex');
}

test('A18 config exports exactly one optional previous abuse-HMAC authority', async () => {
  const config = await import('../../packages/config/dist/index.js');
  assert.equal(config.ABUSE_HMAC_KEY_ENV, 'SWIFTPAY_ABUSE_HMAC_KEY');
  assert.equal(config.ABUSE_HMAC_PREVIOUS_KEY_ENV, 'SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY');
  assert.equal(config.MIN_ABUSE_HMAC_KEY_BYTES, 32);

  const source = await readFile(new URL('../../packages/config/src/core.ts', import.meta.url), 'utf8');
  assert.match(source, /abuseHmacPreviousKey/);
  assert.doesNotMatch(source, /ABUSE_HMAC_KEYS|abuseHmacKeys|abuse.*keyring/i);
});

test('A18 config accepts zero-or-one previous key and rejects short or duplicate continuity authority', async () => {
  const config = await import('../../packages/config/dist/index.js');

  const activeOnly = config.loadApiConfig(validConfigSource());
  assert.equal(activeOnly.abuseHmacKey, ACTIVE_KEY);
  assert.equal('abuseHmacPreviousKey' in activeOnly, false);

  const overlapping = config.loadApiConfig(validConfigSource({
    SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY: PREVIOUS_KEY,
  }));
  assert.equal(overlapping.abuseHmacKey, ACTIVE_KEY);
  assert.equal(overlapping.abuseHmacPreviousKey, PREVIOUS_KEY);

  for (const previous of ['short', ACTIVE_KEY]) {
    assert.throws(
      () => config.loadApiConfig(validConfigSource({ SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY: previous })),
      (error) => {
        assert.doesNotMatch(String(error?.message), /a18-active-abuse-hmac-key|a18-previous-abuse-hmac-key/);
        return true;
      },
    );
  }
});

test('A18 dual-key admission derives active plus previous pseudonyms and performs one store consume', async () => {
  const { createApiAbuseControls } = await requireAbuse();
  const calls = [];
  const controls = createApiAbuseControls(
    {
      async consume(input) {
        calls.push(structuredClone(input));
        return { allowed: true, remaining: 29, retryAfterSeconds: 0 };
      },
    },
    {
      trustedProxyIps: [],
      hmacKey: ACTIVE_KEY,
      previousHmacKey: PREVIOUS_KEY,
    },
  );

  const result = await controls.admitNetwork({
    policy: 'token_exchange_pre_auth',
    clientIp: '203.0.113.10',
  });

  assert.deepEqual(result, { kind: 'allowed', remaining: 29 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    policy: 'token_exchange_pre_auth',
    activeSubjectHash: hash(ACTIVE_KEY, 'network', '203.0.113.10'),
    previousSubjectHash: hash(PREVIOUS_KEY, 'network', '203.0.113.10'),
  });
  assert.doesNotMatch(JSON.stringify(calls), /203\.0\.113\.10/);
});

test('A18 active-only admission preserves A14 derivation without inventing a previous pseudonym', async () => {
  const { createApiAbuseControls } = await requireAbuse();
  const calls = [];
  const controls = createApiAbuseControls(
    {
      async consume(input) {
        calls.push(structuredClone(input));
        return { allowed: true, remaining: 29, retryAfterSeconds: 0 };
      },
    },
    { trustedProxyIps: [], hmacKey: ACTIVE_KEY },
  );

  await controls.admitNetwork({ policy: 'token_exchange_pre_auth', clientIp: '203.0.113.10' });
  assert.deepEqual(calls, [{
    policy: 'token_exchange_pre_auth',
    activeSubjectHash: hash(ACTIVE_KEY, 'network', '203.0.113.10'),
  }]);
});

test('A18 rejects short or duplicate previous key authority without secret echo', async () => {
  const { createApiAbuseControls } = await requireAbuse();
  const store = { consume: async () => ({ allowed: true, remaining: 29, retryAfterSeconds: 0 }) };
  const canary = 'a18-secret-canary-that-must-not-echo-0123456789';

  for (const previousHmacKey of ['short', ACTIVE_KEY, canary.slice(0, 12)]) {
    assert.throws(
      () => createApiAbuseControls(store, {
        trustedProxyIps: [],
        hmacKey: ACTIVE_KEY,
        previousHmacKey,
      }),
      (error) => {
        assert.doesNotMatch(String(error?.message), /a18-secret-canary|a18-active-abuse-hmac-key/);
        return true;
      },
    );
  }
});

test('A18 DB adapter invokes the trusted quota routine once with active and nullable previous hash', async () => {
  const createApiAbuseRateLimitStore = await requireDbStoreFactory();
  const calls = [];
  const store = createApiAbuseRateLimitStore({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ allowed: true, remaining: 29, retry_after_seconds: 0 }] };
    },
  });

  assert.deepEqual(
    await store.consume({
      policy: 'token_exchange_pre_auth',
      activeSubjectHash: ACTIVE_HASH,
      previousSubjectHash: PREVIOUS_HASH,
    }),
    { allowed: true, remaining: 29, retryAfterSeconds: 0 },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /consume_api_abuse_quota\(\$1::text,\s*\$2::text,\s*\$3::text\)/);
  assert.deepEqual(calls[0].params, ['token_exchange_pre_auth', ACTIVE_HASH, PREVIOUS_HASH]);

  calls.length = 0;
  await store.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: ACTIVE_HASH });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['token_exchange_pre_auth', ACTIVE_HASH, null]);
});

test('A18 DB adapter rejects malformed or duplicate aliases before PostgreSQL', async () => {
  const createApiAbuseRateLimitStore = await requireDbStoreFactory();
  let queryCalls = 0;
  const store = createApiAbuseRateLimitStore({
    async query() {
      queryCalls += 1;
      return { rows: [{ allowed: true, remaining: 29, retry_after_seconds: 0 }] };
    },
  });

  const invalid = [
    { policy: 'token_exchange_pre_auth', activeSubjectHash: 'NOT_A_HASH' },
    { policy: 'token_exchange_pre_auth', activeSubjectHash: ACTIVE_HASH, previousSubjectHash: 'NOT_A_HASH' },
    { policy: 'token_exchange_pre_auth', activeSubjectHash: ACTIVE_HASH, previousSubjectHash: ACTIVE_HASH },
  ];
  for (const input of invalid) await assert.rejects(store.consume(input));
  assert.equal(queryCalls, 0);
});

test('A18 API runtime wires previous continuity authority while worker gains none', async () => {
  const [apiIndex, apiRuntime, workerIndex, configIndex] = await Promise.all([
    readFile(new URL('../../apps/api/src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/api/src/runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/worker/src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/config/src/index.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(apiIndex + apiRuntime, /abuseHmacPreviousKey/);
  assert.match(configIndex, /SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY/);
  assert.doesNotMatch(workerIndex, /ABUSE_HMAC_PREVIOUS_KEY|abuseHmacPreviousKey/);
});

test('A18 rotation adds no subject/hash/key observability or provider authority', async () => {
  const [observability, metrics, abuseSource, dbSource] = await Promise.all([
    readFile(new URL('../../packages/observability/src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/metrics/src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/abuse/src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../packages/db/src/api-abuse-rate-limit.ts', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(observability, /previousSubjectHash|activeSubjectHash|abuseHmacPreviousKey/);
  assert.doesNotMatch(metrics, /previousSubjectHash|activeSubjectHash|abuseHmacPreviousKey/);
  assert.doesNotMatch(abuseSource + dbSource, /ProviderAttempt|createPayment|ledger|retained-provider/i);
});
