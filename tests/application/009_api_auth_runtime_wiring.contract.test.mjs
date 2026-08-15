import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

test('A1 API runtime composition drives the public token route through trusted DB routines', async () => {
  const [{ buildApp }, runtime, auth] = await Promise.all([
    import('../../apps/api/dist/app.js'),
    import('../../apps/api/dist/runtime.js'),
    import('../../packages/auth/dist/index.js'),
  ]);
  assert.equal(typeof runtime.createApiRuntimeServices, 'function');

  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes('lookup_api_credential_for_token')) {
        return {
          rows: [{
            credential_id: CREDENTIAL_ID,
            merchant_id: MERCHANT_ID,
            environment: 'sandbox',
            credential_status: 'active',
            secret_verifier: verifierFor('correct-secret'),
            secret_version: 3,
            ip_allowlist: null,
            merchant_lifecycle_status: 'active',
          }],
        };
      }
      if (String(sql).includes('consume_api_token_issuance')) {
        return { rows: [{ allowed: true, remaining: 9, retry_after_seconds: 0 }] };
      }
      throw new Error('unexpected SQL');
    },
  };

  const services = runtime.createApiRuntimeServices(pool, {
    signingKey: SIGNING_KEY,
    nowSeconds: () => NOW_SECONDS,
    jti: () => JTI,
  });
  const app = buildApp(services);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/token',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-a1-runtime-001' },
      payload: {
        grantType: 'client_credentials',
        publicKey: 'pk_runtime',
        secretKey: 'correct-secret',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.tokenType, 'Bearer');
    assert.equal(body.expiresIn, 900);
    assert.equal(body.environment, 'sandbox');
    assert.equal(response.headers['x-request-id'], 'req-a1-runtime-001');

    const claims = await auth.verifyAccessToken(body.accessToken, SIGNING_KEY, NOW_SECONDS + 1);
    assert.ok(claims);
    assert.equal(claims.sub, MERCHANT_ID);
    assert.equal(claims.credential_id, CREDENTIAL_ID);
    assert.equal(claims.secret_version, 3);
    assert.equal(claims.jti, JTI);

    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /app\.lookup_api_credential_for_token/);
    assert.match(calls[1].sql, /app\.consume_api_token_issuance/);
  } finally {
    await app.close();
  }
});

test('A1 production API bootstrap wires the runtime services with the configured signing key', async () => {
  const source = await readFile('apps/api/src/index.ts', 'utf8');
  assert.match(source, /createApiRuntimeServices/);
  assert.match(source, /accessTokenSigningKey/);
  assert.match(source, /tokenExchange/);
});
