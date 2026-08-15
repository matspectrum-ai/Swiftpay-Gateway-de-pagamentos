import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import test from 'node:test';

const SIGNING_KEY = '0123456789abcdef0123456789abcdef';
const NOW_SECONDS = 1_900_000_000;
const MERCHANT_ID = '60000000-0000-0000-0000-000000000001';
const CREDENTIAL_ID = '61000000-0000-0000-0000-000000000001';
const JTI = '62000000-0000-0000-0000-000000000001';

function verifierFor(secret, salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex')) {
  const key = scryptSync(secret, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt-v1$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function activeCredential(secret = 'correct-secret', overrides = {}) {
  return {
    credentialId: CREDENTIAL_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    credentialStatus: 'active',
    secretVerifier: verifierFor(secret),
    secretVersion: 3,
    ipAllowlist: null,
    merchantLifecycleStatus: 'active',
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    grantType: 'client_credentials',
    publicKey: 'pk_test_merchant',
    secretKey: 'correct-secret',
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    clientIp: '127.0.0.1',
    requestId: 'req-a1-service-001',
    ...overrides,
  };
}

async function authModule() {
  return import('../../packages/auth/dist/index.js');
}

function handlerOptions() {
  return {
    signingKey: SIGNING_KEY,
    nowSeconds: () => NOW_SECONDS,
    jti: () => JTI,
  };
}

test('A1 token exchange validates the compatibility request before credential lookup', async () => {
  const auth = await authModule();
  assert.equal(typeof auth.createTokenExchangeHandler, 'function');
  let lookups = 0;
  const store = {
    async lookupCredentialForToken() {
      lookups += 1;
      return activeCredential();
    },
    async consumeTokenIssuance() {
      throw new Error('quota must not run for invalid requests');
    },
  };
  const handler = auth.createTokenExchangeHandler(store, handlerOptions());

  for (const invalidRequest of [
    request({ grantType: 'password' }),
    request({ publicKey: '   ' }),
    request({ publicKey: 'x'.repeat(161) }),
    request({ secretKey: '' }),
    request({ secretKey: 'x'.repeat(513) }),
  ]) {
    assert.deepEqual(await handler(invalidRequest, context()), {
      ok: false,
      error: { code: 'validation_error', message: 'Invalid token request.' },
    });
  }

  assert.equal(lookups, 0);
});

test('A1 token exchange trims publicKey but preserves secretKey as opaque plaintext', async () => {
  const auth = await authModule();
  const opaqueSecret = '  opaque secret with whitespace  ';
  let lookedUpPublicKey;
  let quotaCredentialId;
  const store = {
    async lookupCredentialForToken(publicKey) {
      lookedUpPublicKey = publicKey;
      return activeCredential(opaqueSecret);
    },
    async consumeTokenIssuance(credentialId) {
      quotaCredentialId = credentialId;
      return { allowed: true, remaining: 9, retryAfterSeconds: 0 };
    },
  };
  const handler = auth.createTokenExchangeHandler(store, handlerOptions());

  const result = await handler(
    request({ publicKey: '  pk_test_merchant  ', secretKey: opaqueSecret }),
    context(),
  );

  assert.equal(result.ok, true);
  assert.equal(lookedUpPublicKey, 'pk_test_merchant');
  assert.equal(quotaCredentialId, CREDENTIAL_ID);
});

test('A1 unknown key, wrong secret, malformed verifier, revoked credential and inactive merchant are indistinguishable', async () => {
  const auth = await authModule();
  const scenarios = [
    { row: null, secretKey: 'correct-secret' },
    { row: activeCredential(), secretKey: 'wrong-secret' },
    { row: activeCredential('correct-secret', { secretVerifier: 'malformed-verifier' }), secretKey: 'correct-secret' },
    { row: activeCredential('correct-secret', { credentialStatus: 'revoked' }), secretKey: 'correct-secret' },
    { row: activeCredential('correct-secret', { merchantLifecycleStatus: 'suspended' }), secretKey: 'correct-secret' },
  ];

  for (const scenario of scenarios) {
    let quotaCalls = 0;
    const store = {
      async lookupCredentialForToken() {
        return scenario.row;
      },
      async consumeTokenIssuance() {
        quotaCalls += 1;
        return { allowed: true, remaining: 9, retryAfterSeconds: 0 };
      },
    };
    const handler = auth.createTokenExchangeHandler(store, handlerOptions());
    const result = await handler(request({ secretKey: scenario.secretKey }), context());

    assert.deepEqual(result, {
      ok: false,
      error: { code: 'invalid_credentials', message: 'Invalid credentials.' },
    });
    assert.equal(quotaCalls, 0);
  }
});

test('A1 exact-IP policy is evaluated before quota consumption', async () => {
  const auth = await authModule();
  let quotaCalls = 0;
  const store = {
    async lookupCredentialForToken() {
      return activeCredential('correct-secret', { ipAllowlist: ['192.0.2.10'] });
    },
    async consumeTokenIssuance() {
      quotaCalls += 1;
      return { allowed: true, remaining: 9, retryAfterSeconds: 0 };
    },
  };
  const handler = auth.createTokenExchangeHandler(store, handlerOptions());

  assert.deepEqual(await handler(request(), context({ clientIp: '192.0.2.11' })), {
    ok: false,
    error: { code: 'ip_not_allowed', message: 'IP address is not allowed.' },
  });
  assert.equal(quotaCalls, 0);
});

test('A1 issuance quota denial returns deterministic retry metadata and issues no token', async () => {
  const auth = await authModule();
  const store = {
    async lookupCredentialForToken() {
      return activeCredential();
    },
    async consumeTokenIssuance() {
      return { allowed: false, remaining: 0, retryAfterSeconds: 173 };
    },
  };
  const handler = auth.createTokenExchangeHandler(store, handlerOptions());

  assert.deepEqual(await handler(request(), context()), {
    ok: false,
    error: {
      code: 'auth_rate_limit_exceeded',
      message: 'Token issuance rate limit exceeded.',
      retryAfterSeconds: 173,
    },
  });
});

test('A1 successful exchange issues the canonical 900-second machine token', async () => {
  const auth = await authModule();
  const store = {
    async lookupCredentialForToken() {
      return activeCredential();
    },
    async consumeTokenIssuance() {
      return { allowed: true, remaining: 4, retryAfterSeconds: 0 };
    },
  };
  const handler = auth.createTokenExchangeHandler(store, handlerOptions());

  const result = await handler(request(), context());
  assert.equal(result.ok, true);
  assert.equal(result.value.tokenType, 'Bearer');
  assert.equal(result.value.expiresIn, 900);
  assert.equal(result.value.environment, 'sandbox');

  const claims = await auth.verifyAccessToken(result.value.accessToken, SIGNING_KEY, NOW_SECONDS + 1);
  assert.ok(claims);
  assert.equal(claims.sub, MERCHANT_ID);
  assert.equal(claims.credential_id, CREDENTIAL_ID);
  assert.equal(claims.environment, 'sandbox');
  assert.equal(claims.secret_version, 3);
  assert.equal(claims.jti, JTI);
  assert.equal(claims.iat, NOW_SECONDS);
  assert.equal(claims.exp, NOW_SECONDS + 900);
});

test('A1 unexpected store failure returns sanitized internal_error without leaking secret material', async () => {
  const auth = await authModule();
  const secret = 'plaintext-secret-must-never-leak';
  const store = {
    async lookupCredentialForToken() {
      throw new Error(`database failed with ${secret}`);
    },
    async consumeTokenIssuance() {
      throw new Error('unreachable');
    },
  };
  const handler = auth.createTokenExchangeHandler(store, handlerOptions());

  const result = await handler(request({ secretKey: secret }), context());
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'internal_error', message: 'Authentication is unavailable.' },
  });
  assert.doesNotMatch(JSON.stringify(result), /plaintext-secret-must-never-leak/);
});
