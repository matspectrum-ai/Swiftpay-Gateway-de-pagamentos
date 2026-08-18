import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  authenticateAccessToken,
  createAccessTokenSigningAuthority,
  verifyAccessToken,
} from '../../packages/auth/dist/index.js';
import { createApiCredentialAuthStore, createRuntimePool } from '../../packages/db/dist/index.js';

const [mode, responsePath] = process.argv.slice(2);
if (mode !== 'valid' && mode !== 'invalid') {
  throw new Error('usage: node tests/application/a1_bearer_runtime_check.mjs <valid|invalid> <token-response.json>');
}
if (!responsePath) {
  throw new Error('token response path is required');
}

const databaseUrl = process.env.SWIFTPAY_API_DATABASE_URL;
const activeKeyId = process.env.SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID;
const rawSigningKeys = process.env.SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS;
const legacyNoKidKey = process.env.SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY;
if (!databaseUrl || !activeKeyId || !rawSigningKeys) {
  throw new Error('A1 bearer runtime probe configuration is incomplete');
}

let signingKeys;
try {
  signingKeys = JSON.parse(rawSigningKeys);
} catch {
  throw new Error('A1 bearer runtime probe configuration is invalid');
}
const signingAuthority = createAccessTokenSigningAuthority({
  activeKeyId,
  keys: signingKeys,
  ...(legacyNoKidKey === undefined ? {} : { legacyNoKidKey }),
});

const response = JSON.parse(await readFile(responsePath, 'utf8'));
assert.equal(typeof response.accessToken, 'string');
assert.equal(response.tokenType, 'Bearer');
assert.equal(response.expiresIn, 900);
assert.equal(response.environment, 'sandbox');

const claims = await verifyAccessToken(response.accessToken, signingAuthority);
assert.ok(claims, 'issued JWT must remain signature-valid during runtime acceptance');
assert.equal(claims.sub, '60000000-0000-0000-0000-000000000001');
assert.equal(claims.credential_id, '61000000-0000-0000-0000-000000000001');
assert.equal(claims.environment, 'sandbox');
assert.equal(claims.secret_version, 3);
assert.equal(Object.hasOwn(claims, 'secretKey'), false);
assert.equal(Object.hasOwn(claims, 'secret_key'), false);
assert.equal(Object.hasOwn(claims, 'secret_verifier'), false);

const pool = createRuntimePool({ databaseUrl, workload: 'api' });
try {
  const store = createApiCredentialAuthStore(pool);
  const principal = await authenticateAccessToken(response.accessToken, signingAuthority, store);

  if (mode === 'valid') {
    assert.deepEqual(principal, {
      merchantId: '60000000-0000-0000-0000-000000000001',
      credentialId: '61000000-0000-0000-0000-000000000001',
      environment: 'sandbox',
      secretVersion: 3,
      tokenId: claims.jti,
    });
  } else {
    assert.equal(principal, null);
  }
} finally {
  await pool.end();
}
