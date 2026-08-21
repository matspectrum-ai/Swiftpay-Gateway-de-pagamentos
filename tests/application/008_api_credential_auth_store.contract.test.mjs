import assert from 'node:assert/strict';
import test from 'node:test';

const CREDENTIAL_ID = '61000000-0000-0000-0000-000000000001';
const MERCHANT_ID = '60000000-0000-0000-0000-000000000001';

async function dbModule() {
  return import('../../packages/db/dist/index.js');
}

function fakePool(rowsByRoutine) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const routine = Object.keys(rowsByRoutine).find((name) => String(sql).includes(name));
      if (!routine) throw new Error('unexpected SQL');
      return { rows: rowsByRoutine[routine] };
    },
  };
}

test('A1 database adapter uses only the trusted lookup routine and maps credential auth state', async () => {
  const db = await dbModule();
  assert.equal(typeof db.createApiCredentialAuthStore, 'function');
  const pool = fakePool({
    lookup_api_credential_for_token: [{
      credential_id: CREDENTIAL_ID,
      merchant_id: MERCHANT_ID,
      environment: 'sandbox',
      credential_status: 'active',
      secret_verifier: 'scrypt-v1$16384$8$1$stored-salt$stored-key',
      secret_version: 3,
      ip_allowlist: ['127.0.0.1'],
      merchant_lifecycle_status: 'active',
    }],
  });
  const store = db.createApiCredentialAuthStore(pool);

  assert.deepEqual(await store.lookupCredentialForToken('pk_test'), {
    credentialId: CREDENTIAL_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    credentialStatus: 'active',
    secretVerifier: 'scrypt-v1$16384$8$1$stored-salt$stored-key',
    secretVersion: 3,
    ipAllowlist: ['127.0.0.1'],
    merchantLifecycleStatus: 'active',
  });
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /app\.lookup_api_credential_for_token/);
  assert.doesNotMatch(pool.calls[0].sql, /app\.api_credentials\b/);
  assert.deepEqual(pool.calls[0].params, ['pk_test']);
});

test('A1 database adapter returns null when credential lookup has no row', async () => {
  const db = await dbModule();
  const pool = fakePool({ lookup_api_credential_for_token: [] });
  const store = db.createApiCredentialAuthStore(pool);
  assert.equal(await store.lookupCredentialForToken('missing'), null);
});

test('A1 database adapter consumes quota only through the trusted issuance routine', async () => {
  const db = await dbModule();
  const pool = fakePool({
    consume_api_token_issuance: [{
      allowed: false,
      remaining: 0,
      retry_after_seconds: 173,
    }],
  });
  const store = db.createApiCredentialAuthStore(pool);

  assert.deepEqual(await store.consumeTokenIssuance(CREDENTIAL_ID), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 173,
  });
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /app\.consume_api_token_issuance/);
  assert.doesNotMatch(pool.calls[0].sql, /app\.api_credential_token_windows\b/);
  assert.deepEqual(pool.calls[0].params, [CREDENTIAL_ID]);
});

test('A1 database adapter exposes bearer revalidation state through the trusted routine', async () => {
  const db = await dbModule();
  const pool = fakePool({
    get_api_credential_auth_state: [{
      credential_id: CREDENTIAL_ID,
      merchant_id: MERCHANT_ID,
      environment: 'production',
      credential_status: 'active',
      secret_version: 4,
      merchant_lifecycle_status: 'active',
    }],
  });
  const store = db.createApiCredentialAuthStore(pool);

  assert.deepEqual(await store.getCredentialAuthState(CREDENTIAL_ID), {
    credentialId: CREDENTIAL_ID,
    merchantId: MERCHANT_ID,
    environment: 'production',
    credentialStatus: 'active',
    secretVersion: 4,
    merchantLifecycleStatus: 'active',
  });
  assert.match(pool.calls[0].sql, /app\.get_api_credential_auth_state/);
  assert.deepEqual(pool.calls[0].params, [CREDENTIAL_ID]);
});

test('A1 database adapter fails with a sanitized error when trusted routines return malformed shapes', async () => {
  const db = await dbModule();
  const pool = fakePool({ consume_api_token_issuance: [] });
  const store = db.createApiCredentialAuthStore(pool);

  await assert.rejects(
    () => store.consumeTokenIssuance(CREDENTIAL_ID),
    (error) => {
      assert.equal(error?.name, 'RuntimeAuthStoreError');
      assert.equal(error?.message, 'Runtime authentication database operation failed');
      assert.doesNotMatch(String(error), /credential_token_windows|postgresql:\/\//);
      return true;
    },
  );
});
