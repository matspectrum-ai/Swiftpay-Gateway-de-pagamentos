import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ACTIVE_KEY = 'a15-active-signing-secret-0123456789abcdef0123456789';
const PREVIOUS_KEY = 'a15-previous-signing-secret-0123456789abcdef012345';
const LEGACY_KEY = 'a15-legacy-no-kid-secret-0123456789abcdef0123456';
const WRONG_KEY = 'a15-wrong-signing-secret-0123456789abcdef012345678';

const ACTIVE_ID = 'machine-2026-08-a';
const PREVIOUS_ID = 'machine-2026-07-z';

const IDS = {
  merchantId: '60000000-0000-0000-0000-000000000001',
  credentialId: '61000000-0000-0000-0000-000000000001',
  jti: '62000000-0000-0000-0000-000000000001',
};
const NOW = 1_900_000_000;

async function imports() {
  const [auth, config] = await Promise.all([
    import('../../packages/auth/dist/index.js'),
    import('../../packages/config/dist/index.js'),
  ]);
  return { auth, config };
}

function authorityInput(overrides = {}) {
  return {
    activeKeyId: ACTIVE_ID,
    keys: [
      { id: ACTIVE_ID, secret: ACTIVE_KEY },
      { id: PREVIOUS_ID, secret: PREVIOUS_KEY },
    ],
    legacyNoKidKey: LEGACY_KEY,
    ...overrides,
  };
}

function validConfigSource(overrides = {}) {
  return {
    SWIFTPAY_ENVIRONMENT: 'sandbox',
    SWIFTPAY_API_DATABASE_URL: 'postgresql://api:test@127.0.0.1:5432/postgres',
    SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID: ACTIVE_ID,
    SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify(authorityInput().keys),
    SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY: LEGACY_KEY,
    SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY: 'a9-dashboard-cursor-test-key-0123456789abcdef',
    SWIFTPAY_ABUSE_HMAC_KEY: 'a14-abuse-test-key-0123456789abcdef0123456789abcdef',
    SWIFTPAY_SUPABASE_URL: 'https://project-a6.supabase.co',
    SWIFTPAY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_a6_test_key',
    SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID: 'webhook-wrap-a7-test',
    SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY: 'AQID',
    ...overrides,
  };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signRawJwt({ key, header, claims }) {
  const encodedHeader = base64urlJson(header);
  const encodedClaims = base64urlJson(claims);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = createHmac('sha256', key).update(signingInput, 'ascii').digest('base64url');
  return `${signingInput}.${signature}`;
}

function canonicalClaims(overrides = {}) {
  return {
    sub: IDS.merchantId,
    credential_id: IDS.credentialId,
    environment: 'sandbox',
    secret_version: 3,
    jti: IDS.jti,
    iat: NOW,
    exp: NOW + 900,
    iss: 'swiftpay',
    aud: 'swiftpay-api',
    ...overrides,
  };
}

function tokenInput(overrides = {}) {
  return {
    merchantId: IDS.merchantId,
    credentialId: IDS.credentialId,
    environment: 'sandbox',
    secretVersion: 3,
    jti: IDS.jti,
    nowSeconds: NOW,
    ...overrides,
  };
}

test('A15 auth/config packages expose the frozen key-rotation boundary', async () => {
  const { auth, config } = await imports();
  assert.equal(typeof auth.createAccessTokenSigningAuthority, 'function');
  assert.equal(config.ACCESS_TOKEN_ACTIVE_KEY_ID_ENV, 'SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID');
  assert.equal(config.ACCESS_TOKEN_SIGNING_KEYS_ENV, 'SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS');
  assert.equal(config.ACCESS_TOKEN_LEGACY_NO_KID_KEY_ENV, 'SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY');
});

test('A15 config accepts one bounded immutable keyring and resolves the exact active key identity', async () => {
  const { config } = await imports();
  const loaded = config.loadApiConfig(validConfigSource());
  assert.equal(loaded.accessTokenActiveKeyId, ACTIVE_ID);
  assert.deepEqual(loaded.accessTokenSigningKeys, authorityInput().keys);
  assert.equal(loaded.accessTokenLegacyNoKidKey, LEGACY_KEY);
  assert.equal(Object.isFrozen(loaded.accessTokenSigningKeys), true);
  assert.equal(Object.isFrozen(loaded.accessTokenSigningKeys[0]), true);
  assert.equal('accessTokenSigningKey' in loaded, false);
});

test('A15 config rejects old single-key-only and malformed keyring states without echoing secrets', async () => {
  const { config } = await imports();
  const common = validConfigSource();
  delete common.SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID;
  delete common.SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS;
  delete common.SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY;
  common.SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY = ACTIVE_KEY;
  assert.throws(
    () => config.loadApiConfig(common),
    (error) => {
      const text = String(error?.message);
      assert.match(text, /SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID|SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS/);
      assert.doesNotMatch(text, new RegExp(ACTIVE_KEY));
      return true;
    },
  );

  const invalidCases = [
    { SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID: 'BAD ID' },
    { SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: '{}' },
    { SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: '[]' },
    { SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([{ id: ACTIVE_ID, secret: 'short' }]) },
    { SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([
      { id: ACTIVE_ID, secret: ACTIVE_KEY },
      { id: ACTIVE_ID, secret: PREVIOUS_KEY },
    ]) },
    { SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([
      { id: ACTIVE_ID, secret: ACTIVE_KEY },
      { id: PREVIOUS_ID, secret: ACTIVE_KEY },
    ]) },
    { SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([{ id: ACTIVE_ID, secret: ACTIVE_KEY, extra: true }]) },
    { SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([{ id: PREVIOUS_ID, secret: PREVIOUS_KEY }]) },
    { SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([
      { id: 'a', secret: `${ACTIVE_KEY}a` },
      { id: 'b', secret: `${ACTIVE_KEY}b` },
      { id: 'c', secret: `${ACTIVE_KEY}c` },
      { id: 'd', secret: `${ACTIVE_KEY}d` },
      { id: 'e', secret: `${ACTIVE_KEY}e` },
    ]) },
    { SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY: 'short' },
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

test('A15 signing authority rejects structural spoofing and is isolated from source mutation', async () => {
  const { auth } = await imports();
  const source = authorityInput();
  const authority = auth.createAccessTokenSigningAuthority(source);
  const forged = structuredClone(source);

  await assert.rejects(() => auth.issueAccessToken(tokenInput(), forged));
  assert.equal(await auth.verifyAccessToken('not-a-token', forged, NOW), null);

  source.keys[0].secret = WRONG_KEY;
  source.keys.push({ id: 'late-mutation', secret: WRONG_KEY });
  const token = await auth.issueAccessToken(tokenInput(), authority);
  assert.ok(await auth.verifyAccessToken(token, authority, NOW));
});

test('A15 issues every new token with exact HS256+kid header and only the active signing key', async () => {
  const { auth } = await imports();
  const authority = auth.createAccessTokenSigningAuthority(authorityInput());
  const token = await auth.issueAccessToken(tokenInput(), authority);
  const [encodedHeader] = token.split('.');
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
  assert.deepEqual(header, { alg: 'HS256', kid: ACTIVE_ID });

  assert.ok(await auth.verifyAccessToken(token, authority, NOW));
  const activeOnly = auth.createAccessTokenSigningAuthority({ activeKeyId: ACTIVE_ID, keys: [{ id: ACTIVE_ID, secret: ACTIVE_KEY }] });
  assert.ok(await auth.verifyAccessToken(token, activeOnly, NOW));
  const previousAsActive = auth.createAccessTokenSigningAuthority({ activeKeyId: PREVIOUS_ID, keys: [{ id: PREVIOUS_ID, secret: PREVIOUS_KEY }] });
  assert.equal(await auth.verifyAccessToken(token, previousAsActive, NOW), null);
});

test('A15 verification accepts current and verify-only known kid with exact selected key', async () => {
  const { auth } = await imports();
  const authority = auth.createAccessTokenSigningAuthority(authorityInput());
  const current = signRawJwt({ key: ACTIVE_KEY, header: { alg: 'HS256', kid: ACTIVE_ID }, claims: canonicalClaims() });
  const previous = signRawJwt({ key: PREVIOUS_KEY, header: { alg: 'HS256', kid: PREVIOUS_ID }, claims: canonicalClaims({ jti: '62000000-0000-0000-0000-000000000002' }) });
  assert.ok(await auth.verifyAccessToken(current, authority, NOW));
  assert.ok(await auth.verifyAccessToken(previous, authority, NOW));
});

test('A15 unknown kid rejects even when token is signed by a configured key and never falls back', async () => {
  const { auth } = await imports();
  const authority = auth.createAccessTokenSigningAuthority(authorityInput());
  const token = signRawJwt({ key: ACTIVE_KEY, header: { alg: 'HS256', kid: 'unknown-valid-id' }, claims: canonicalClaims() });
  assert.equal(await auth.verifyAccessToken(token, authority, NOW), null);
});

test('A15 malformed kid extra protected fields and non-HS256 headers reject before authority use', async () => {
  const { auth } = await imports();
  const authority = auth.createAccessTokenSigningAuthority(authorityInput());
  const candidates = [
    signRawJwt({ key: ACTIVE_KEY, header: { alg: 'HS256', kid: 'BAD ID' }, claims: canonicalClaims() }),
    signRawJwt({ key: ACTIVE_KEY, header: { alg: 'HS256', kid: ACTIVE_ID, typ: 'JWT' }, claims: canonicalClaims() }),
    signRawJwt({ key: ACTIVE_KEY, header: { alg: 'HS512', kid: ACTIVE_ID }, claims: canonicalClaims() }),
  ];
  for (const token of candidates) assert.equal(await auth.verifyAccessToken(token, authority, NOW), null);
});

test('A15 no-kid compatibility verifies only through the explicit legacy slot and disappears on removal', async () => {
  const { auth } = await imports();
  const legacyToken = signRawJwt({ key: LEGACY_KEY, header: { alg: 'HS256' }, claims: canonicalClaims() });
  const ringSignedNoKid = signRawJwt({ key: ACTIVE_KEY, header: { alg: 'HS256' }, claims: canonicalClaims() });
  const withLegacy = auth.createAccessTokenSigningAuthority(authorityInput());
  const withoutLegacy = auth.createAccessTokenSigningAuthority({ activeKeyId: ACTIVE_ID, keys: authorityInput().keys });
  assert.ok(await auth.verifyAccessToken(legacyToken, withLegacy, NOW));
  assert.equal(await auth.verifyAccessToken(legacyToken, withoutLegacy, NOW), null);
  assert.equal(await auth.verifyAccessToken(ringSignedNoKid, withoutLegacy, NOW), null);
});

test('A15 still rejects wrong signature expiration issuer audience and algorithm confusion', async () => {
  const { auth } = await imports();
  const authority = auth.createAccessTokenSigningAuthority(authorityInput());
  const cases = [
    signRawJwt({ key: WRONG_KEY, header: { alg: 'HS256', kid: ACTIVE_ID }, claims: canonicalClaims() }),
    signRawJwt({ key: ACTIVE_KEY, header: { alg: 'HS256', kid: ACTIVE_ID }, claims: canonicalClaims({ exp: NOW - 1 }) }),
    signRawJwt({ key: ACTIVE_KEY, header: { alg: 'HS256', kid: ACTIVE_ID }, claims: canonicalClaims({ iss: 'not-swiftpay' }) }),
    signRawJwt({ key: ACTIVE_KEY, header: { alg: 'HS256', kid: ACTIVE_ID }, claims: canonicalClaims({ aud: 'not-swiftpay-api' }) }),
  ];
  for (const token of cases) assert.equal(await auth.verifyAccessToken(token, authority, NOW), null);
});

test('A15 preserves exact 900-second TTL and canonical A1 identity claims', async () => {
  const { auth } = await imports();
  const authority = auth.createAccessTokenSigningAuthority(authorityInput());
  const token = await auth.issueAccessToken(tokenInput(), authority);
  const claims = await auth.verifyAccessToken(token, authority, NOW);
  assert.ok(claims);
  assert.equal(claims.sub, IDS.merchantId);
  assert.equal(claims.credential_id, IDS.credentialId);
  assert.equal(claims.environment, 'sandbox');
  assert.equal(claims.secret_version, 3);
  assert.equal(claims.jti, IDS.jti);
  assert.equal(claims.iat, NOW);
  assert.equal(claims.exp, NOW + 900);
  assert.equal(claims.exp - claims.iat, 900);
});

test('A15 bearer authentication still requires database revalidation after successful key verification', async () => {
  const { auth } = await imports();
  const authority = auth.createAccessTokenSigningAuthority(authorityInput());
  const token = await auth.issueAccessToken(tokenInput(), authority);
  let calls = 0;
  const store = {
    async getCredentialAuthState() {
      calls += 1;
      return {
        credentialId: IDS.credentialId,
        merchantId: IDS.merchantId,
        environment: 'sandbox',
        credentialStatus: 'active',
        secretVersion: 3,
        merchantLifecycleStatus: 'active',
      };
    },
  };
  const principal = await auth.authenticateAccessToken(token, authority, store, NOW);
  assert.equal(calls, 1);
  assert.equal(principal?.merchantId, IDS.merchantId);

  store.getCredentialAuthState = async () => {
    calls += 1;
    return {
      credentialId: IDS.credentialId,
      merchantId: IDS.merchantId,
      environment: 'sandbox',
      credentialStatus: 'revoked',
      secretVersion: 3,
      merchantLifecycleStatus: 'active',
    };
  };
  assert.equal(await auth.authenticateAccessToken(token, authority, store, NOW), null);
});

test('A15 token exchange keeps the A1 public success shape while issuing kid-aware tokens', async () => {
  const { auth } = await imports();
  const authority = auth.createAccessTokenSigningAuthority(authorityInput());
  const secret = 'merchant-api-secret';
  const { scryptSync } = await import('node:crypto');
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const derived = scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const store = {
    async lookupCredentialForToken() {
      return {
        credentialId: IDS.credentialId,
        merchantId: IDS.merchantId,
        environment: 'sandbox',
        credentialStatus: 'active',
        secretVerifier: `scrypt-v1$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`,
        secretVersion: 3,
        ipAllowlist: null,
        merchantLifecycleStatus: 'active',
      };
    },
    async consumeTokenIssuance() { return { allowed: true, remaining: 9, retryAfterSeconds: 0 }; },
  };
  const handler = auth.createTokenExchangeHandler(store, {
    signingAuthority: authority,
    nowSeconds: () => NOW,
    jti: () => IDS.jti,
  });
  const result = await handler(
    { grantType: 'client_credentials', publicKey: 'pk_test', secretKey: secret },
    { clientIp: '127.0.0.1', requestId: 'request-a15' },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), ['accessToken', 'environment', 'expiresIn', 'tokenType']);
  assert.equal(result.value.expiresIn, 900);
  const [headerPart] = result.value.accessToken.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')), { alg: 'HS256', kid: ACTIVE_ID });
});

test('A15 configuration and signing-authority failures never echo key material or legacy-slot presence', async () => {
  const { auth } = await imports();
  const secretCanaries = [ACTIVE_KEY, PREVIOUS_KEY, LEGACY_KEY];
  let errorText = '';
  try {
    auth.createAccessTokenSigningAuthority({
      activeKeyId: 'missing',
      keys: authorityInput().keys,
      legacyNoKidKey: LEGACY_KEY,
    });
  } catch (error) {
    errorText = String(error?.message);
  }
  assert.notEqual(errorText, '');
  for (const canary of secretCanaries) assert.doesNotMatch(errorText, new RegExp(canary));
  assert.doesNotMatch(errorText.toLowerCase(), /legacy.*present|legacy.*configured/);
});

test('A15 production API composition uses the keyring authority and contains no old single-key fallback', async () => {
  const [configSource, runtimeSource, bootstrapSource] = await Promise.all([
    readFile(new URL('../../packages/config/src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/api/src/runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/api/src/index.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(configSource, /SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID/);
  assert.match(configSource, /SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS/);
  assert.match(configSource, /SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY/);
  assert.match(runtimeSource, /createAccessTokenSigningAuthority/);
  assert.match(runtimeSource, /signingAuthority/);
  assert.doesNotMatch(runtimeSource, /options\.signingKey\b/);
  assert.match(bootstrapSource, /accessTokenActiveKeyId/);
  assert.match(bootstrapSource, /accessTokenSigningKeys/);
  assert.doesNotMatch(bootstrapSource, /accessTokenSigningKey\b/);
});

test('A15 remains application-only and introduces no database migration provider bridge or financial authority', async () => {
  const authSource = await readFile(new URL('../../packages/auth/src/index.ts', import.meta.url), 'utf8');
  assert.match(authSource, /createAccessTokenSigningAuthority/);
  assert.doesNotMatch(authSource, /node:https|node:http|fetch\s*\(|ProviderAttempt|settlement_paid|consume_api_abuse_quota/);
  const contract = await readFile(new URL('../../docs/contracts/machine-access-token-signing-key-rotation-v0.md', import.meta.url), 'utf8');
  assert.match(contract, /no Supabase migration/i);
  assert.match(contract, /no provider call/i);
});
