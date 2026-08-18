import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import test from 'node:test';

async function imports() {
  const [auth, config] = await Promise.all([
    import('../../packages/auth/dist/index.js'),
    import('../../packages/config/dist/index.js'),
  ]);
  return { auth, config };
}

function verifierFor(secret, salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex')) {
  const key = scryptSync(secret, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt-v1$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

const SIGNING_KEY = '0123456789abcdef0123456789abcdef';
const SIGNING_KEY_ID = 'machine-a1-test';
const validConfigSource = {
  SWIFTPAY_ENVIRONMENT: 'sandbox',
  SWIFTPAY_API_DATABASE_URL: 'postgresql://api:test@127.0.0.1:5432/postgres',
  SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID: SIGNING_KEY_ID,
  SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([{ id: SIGNING_KEY_ID, secret: SIGNING_KEY }]),
  SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY: 'a9-dashboard-cursor-test-key-0123456789abcdef',
  SWIFTPAY_ABUSE_HMAC_KEY: 'a14-abuse-test-key-0123456789abcdef0123456789abcdef',
  SWIFTPAY_SUPABASE_URL: 'https://project-a6.supabase.co',
  SWIFTPAY_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_a6_test_key',
  SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID: 'webhook-wrap-a7-test',
  SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY: 'AQID',
};

function signingAuthority(auth, secret = SIGNING_KEY) {
  return auth.createAccessTokenSigningAuthority({
    activeKeyId: SIGNING_KEY_ID,
    keys: [{ id: SIGNING_KEY_ID, secret }],
  });
}

test('A1 scrypt-v1 verifies the exact opaque plaintext secret', async () => {
  const { auth } = await imports();
  assert.equal(typeof auth.verifyCredentialSecret, 'function');
  const secret = '  opaque secret with whitespace  ';
  const verifier = verifierFor(secret);
  assert.equal(await auth.verifyCredentialSecret(secret, verifier), true);
  assert.equal(await auth.verifyCredentialSecret(secret.trim(), verifier), false);
  assert.equal(await auth.verifyCredentialSecret(`${secret}x`, verifier), false);
});

test('A1 scrypt verifier parsing fails closed for malformed or non-frozen representations', async () => {
  const { auth } = await imports();
  assert.equal(typeof auth.verifyCredentialSecret, 'function');
  const secret = 'correct-secret';
  const valid = verifierFor(secret);
  const parts = valid.split('$');

  const malformed = [
    '',
    'garbage',
    valid.replace('scrypt-v1', 'scrypt-v2'),
    valid.replace('$16384$', '$32768$'),
    valid.replace('$8$', '$4$'),
    valid.replace('$1$', '$2$'),
    `${parts.slice(0, 5).join('$')}$***not-base64url***`,
    verifierFor(secret, Buffer.alloc(15, 1)),
  ];

  for (const representation of malformed) {
    assert.equal(await auth.verifyCredentialSecret(secret, representation), false, representation);
  }
});

test('A1 exact-IP allowlist treats null and empty list as unrestricted', async () => {
  const { auth } = await imports();
  assert.equal(typeof auth.evaluateExactIpAllowlist, 'function');
  assert.equal(auth.evaluateExactIpAllowlist('127.0.0.1', null), true);
  assert.equal(auth.evaluateExactIpAllowlist('127.0.0.1', []), true);
});

test('A1 exact-IP allowlist matches only an exact validated stored IP', async () => {
  const { auth } = await imports();
  const allowlist = ['203.0.113.10', '2001:db8::10'];
  assert.equal(auth.evaluateExactIpAllowlist('203.0.113.10', allowlist), true);
  assert.equal(auth.evaluateExactIpAllowlist('203.0.113.11', allowlist), false);
  assert.equal(auth.evaluateExactIpAllowlist('2001:db8::10', allowlist), true);
  assert.equal(auth.evaluateExactIpAllowlist('2001:db8::11', allowlist), false);
});

test('A1 exact-IP allowlist rejects wildcard, malformed JSON shape and invalid entries', async () => {
  const { auth } = await imports();
  assert.equal(auth.evaluateExactIpAllowlist('203.0.113.10', ['203.0.113.0/24']), false);
  assert.equal(auth.evaluateExactIpAllowlist('203.0.113.10', '203.0.113.10'), false);
  assert.equal(auth.evaluateExactIpAllowlist('203.0.113.10', [42]), false);
  assert.equal(auth.evaluateExactIpAllowlist('203.0.113.10', ['not-an-ip']), false);
  assert.equal(auth.evaluateExactIpAllowlist('not-an-ip', []), false);
});

test('A1 JWT issuance and verification preserve canonical HS256 identity claims for exactly 900 seconds', async () => {
  const { auth } = await imports();
  const authority = signingAuthority(auth);
  const input = {
    merchantId: '60000000-0000-0000-0000-000000000001',
    credentialId: '61000000-0000-0000-0000-000000000001',
    environment: 'sandbox',
    secretVersion: 3,
    jti: '62000000-0000-0000-0000-000000000001',
    nowSeconds: 1_900_000_000,
  };

  const token = await auth.issueAccessToken(input, authority);
  const [encodedHeader] = token.split('.');
  assert.ok(encodedHeader);
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
  assert.deepEqual(header, { alg: 'HS256', kid: SIGNING_KEY_ID });

  const claims = await auth.verifyAccessToken(token, authority, input.nowSeconds);
  assert.ok(claims);
  assert.equal(claims.sub, input.merchantId);
  assert.equal(claims.credential_id, input.credentialId);
  assert.equal(claims.environment, input.environment);
  assert.equal(claims.secret_version, input.secretVersion);
  assert.equal(claims.jti, input.jti);
  assert.equal(claims.iat, input.nowSeconds);
  assert.equal(claims.exp, input.nowSeconds + 900);
  assert.equal(claims.exp - claims.iat, 900);
});

test('A1 JWT verification fails closed for wrong key and expiration', async () => {
  const { auth } = await imports();
  const authority = signingAuthority(auth);
  const token = await auth.issueAccessToken({
    merchantId: '60000000-0000-0000-0000-000000000001',
    credentialId: '61000000-0000-0000-0000-000000000001',
    environment: 'sandbox',
    secretVersion: 1,
    jti: '62000000-0000-0000-0000-000000000002',
    nowSeconds: 1_900_000_000,
  }, authority);

  const wrongAuthority = signingAuthority(auth, 'fedcba9876543210fedcba9876543210');
  assert.equal(await auth.verifyAccessToken(token, wrongAuthority, 1_900_000_000), null);
  assert.equal(await auth.verifyAccessToken(token, authority, 1_900_000_901), null);
});

test('A1 signing helpers reject undersized signing keys without echoing secret material', async () => {
  const { auth } = await imports();
  const shortKey = 'do-not-echo-short-key';
  assert.throws(
    () => auth.createAccessTokenSigningAuthority({
      activeKeyId: SIGNING_KEY_ID,
      keys: [{ id: SIGNING_KEY_ID, secret: shortKey }],
    }),
    (error) => {
      assert.equal(error?.name, 'SigningKeyError');
      assert.doesNotMatch(String(error?.message), /do-not-echo-short-key/);
      return true;
    },
  );
});

test('A1 API config requires a bounded signing authority with secrets of at least 32 UTF-8 bytes', async () => {
  const { config } = await imports();

  assert.throws(
    () => config.loadApiConfig({
      ...validConfigSource,
      SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID: undefined,
    }),
    /SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID/,
  );

  const shortKey = 'short-secret-do-not-echo';
  assert.throws(
    () => config.loadApiConfig({
      ...validConfigSource,
      SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS: JSON.stringify([{ id: SIGNING_KEY_ID, secret: shortKey }]),
    }),
    (error) => {
      assert.equal(error?.name, 'ConfigurationError');
      assert.match(String(error?.message), /SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS/);
      assert.doesNotMatch(String(error?.message), /short-secret-do-not-echo/);
      return true;
    },
  );

  const loaded = config.loadApiConfig(validConfigSource);
  assert.equal(loaded.accessTokenActiveKeyId, SIGNING_KEY_ID);
  assert.deepEqual(loaded.accessTokenSigningKeys, [{ id: SIGNING_KEY_ID, secret: SIGNING_KEY }]);
  assert.equal('accessTokenSigningKey' in loaded, false);
});
