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

const validConfigSource = {
  SWIFTPAY_ENVIRONMENT: 'sandbox',
  SWIFTPAY_API_DATABASE_URL: 'postgresql://api:test@127.0.0.1:5432/postgres',
  SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY: '0123456789abcdef0123456789abcdef',
};

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
  assert.equal(typeof auth.evaluateExactIpAllowlist, 'function');
  assert.equal(auth.evaluateExactIpAllowlist('127.0.0.1', ['127.0.0.1']), true);
  assert.equal(auth.evaluateExactIpAllowlist('127.0.0.2', ['127.0.0.1']), false);
  assert.equal(auth.evaluateExactIpAllowlist('::1', ['::1']), true);
});

test('A1 exact-IP allowlist rejects wildcard, malformed JSON shape and invalid entries', async () => {
  const { auth } = await imports();
  assert.equal(typeof auth.evaluateExactIpAllowlist, 'function');
  assert.equal(auth.evaluateExactIpAllowlist('127.0.0.1', ['*']), false);
  assert.equal(auth.evaluateExactIpAllowlist('127.0.0.1', { ip: '127.0.0.1' }), false);
  assert.equal(auth.evaluateExactIpAllowlist('127.0.0.1', ['not-an-ip']), false);
  assert.equal(auth.evaluateExactIpAllowlist('not-an-ip', ['127.0.0.1']), false);
});

test('A1 JWT issuance and verification preserve canonical HS256 identity claims for exactly 900 seconds', async () => {
  const { auth } = await imports();
  assert.equal(typeof auth.issueAccessToken, 'function');
  assert.equal(typeof auth.verifyAccessToken, 'function');

  const signingKey = validConfigSource.SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY;
  const nowSeconds = 1_900_000_000;
  const token = await auth.issueAccessToken({
    merchantId: '60000000-0000-0000-0000-000000000001',
    credentialId: '61000000-0000-0000-0000-000000000001',
    environment: 'sandbox',
    secretVersion: 3,
    jti: '62000000-0000-0000-0000-000000000001',
    nowSeconds,
  }, signingKey);

  const claims = await auth.verifyAccessToken(token, signingKey, nowSeconds + 1);
  assert.ok(claims);
  assert.equal(claims.sub, '60000000-0000-0000-0000-000000000001');
  assert.equal(claims.credential_id, '61000000-0000-0000-0000-000000000001');
  assert.equal(claims.environment, 'sandbox');
  assert.equal(claims.secret_version, 3);
  assert.equal(claims.jti, '62000000-0000-0000-0000-000000000001');
  assert.equal(claims.iat, nowSeconds);
  assert.equal(claims.exp, nowSeconds + 900);
  assert.equal(claims.iss, 'swiftpay');
  assert.equal(claims.aud, 'swiftpay-api');
});

test('A1 JWT verification fails closed for wrong key and expiration', async () => {
  const { auth } = await imports();
  assert.equal(typeof auth.issueAccessToken, 'function');
  assert.equal(typeof auth.verifyAccessToken, 'function');

  const signingKey = validConfigSource.SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY;
  const token = await auth.issueAccessToken({
    merchantId: '60000000-0000-0000-0000-000000000001',
    credentialId: '61000000-0000-0000-0000-000000000001',
    environment: 'production',
    secretVersion: 4,
    jti: '62000000-0000-0000-0000-000000000002',
    nowSeconds: 1_900_000_000,
  }, signingKey);

  assert.equal(
    await auth.verifyAccessToken(token, 'abcdef0123456789abcdef0123456789', 1_900_000_001),
    null,
  );
  assert.equal(await auth.verifyAccessToken(token, signingKey, 1_900_000_901), null);
});

test('A1 signing helpers reject undersized signing keys without echoing secret material', async () => {
  const { auth } = await imports();
  assert.equal(typeof auth.issueAccessToken, 'function');
  const shortKey = 'do-not-echo-short-key';

  await assert.rejects(
    () => auth.issueAccessToken({
      merchantId: '60000000-0000-0000-0000-000000000001',
      credentialId: '61000000-0000-0000-0000-000000000001',
      environment: 'sandbox',
      secretVersion: 1,
      jti: '62000000-0000-0000-0000-000000000003',
      nowSeconds: 1_900_000_000,
    }, shortKey),
    (error) => {
      assert.equal(error?.name, 'SigningKeyError');
      assert.match(String(error?.message), /32/);
      assert.doesNotMatch(String(error?.message), /do-not-echo-short-key/);
      return true;
    },
  );
});

test('A1 API config requires a signing key with at least 32 UTF-8 bytes', async () => {
  const { config } = await imports();

  assert.throws(
    () => config.loadApiConfig({
      SWIFTPAY_ENVIRONMENT: 'sandbox',
      SWIFTPAY_API_DATABASE_URL: validConfigSource.SWIFTPAY_API_DATABASE_URL,
    }),
    /SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY/,
  );

  const shortKey = 'short-secret-do-not-echo';
  assert.throws(
    () => config.loadApiConfig({
      SWIFTPAY_ENVIRONMENT: 'sandbox',
      SWIFTPAY_API_DATABASE_URL: validConfigSource.SWIFTPAY_API_DATABASE_URL,
      SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY: shortKey,
    }),
    (error) => {
      assert.equal(error?.name, 'ConfigurationError');
      assert.match(String(error?.message), /SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY/);
      assert.match(String(error?.message), /32/);
      assert.doesNotMatch(String(error?.message), /short-secret-do-not-echo/);
      return true;
    },
  );

  const loaded = config.loadApiConfig(validConfigSource);
  assert.equal(loaded.accessTokenSigningKey, validConfigSource.SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY);
});
