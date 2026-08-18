import assert from 'node:assert/strict';
import test from 'node:test';

const SIGNING_KEY = '0123456789abcdef0123456789abcdef';
const SIGNING_KEY_ID = 'machine-a1-bearer';
const NOW_SECONDS = 1_900_000_000;
const MERCHANT_ID = '60000000-0000-0000-0000-000000000001';
const CREDENTIAL_ID = '61000000-0000-0000-0000-000000000001';
const JTI = '62000000-0000-0000-0000-000000000001';

async function authModule() {
  return import('../../packages/auth/dist/index.js');
}

function authority(auth, secret = SIGNING_KEY) {
  return auth.createAccessTokenSigningAuthority({
    activeKeyId: SIGNING_KEY_ID,
    keys: [{ id: SIGNING_KEY_ID, secret }],
  });
}

async function token(auth, signingAuthority, overrides = {}) {
  return auth.issueAccessToken({
    merchantId: MERCHANT_ID,
    credentialId: CREDENTIAL_ID,
    environment: 'sandbox',
    secretVersion: 3,
    jti: JTI,
    nowSeconds: NOW_SECONDS,
    ...overrides,
  }, signingAuthority);
}

function activeState(overrides = {}) {
  return {
    credentialId: CREDENTIAL_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    credentialStatus: 'active',
    secretVersion: 3,
    merchantLifecycleStatus: 'active',
    ...overrides,
  };
}

test('A1 bearer authentication returns a canonical machine principal only after DB revalidation', async () => {
  const auth = await authModule();
  assert.equal(typeof auth.authenticateAccessToken, 'function');
  const signingAuthority = authority(auth);
  const accessToken = await token(auth, signingAuthority);
  let lookedUpCredentialId;
  const store = {
    async getCredentialAuthState(credentialId) {
      lookedUpCredentialId = credentialId;
      return activeState();
    },
  };

  assert.deepEqual(
    await auth.authenticateAccessToken(accessToken, signingAuthority, store, NOW_SECONDS + 1),
    {
      merchantId: MERCHANT_ID,
      credentialId: CREDENTIAL_ID,
      environment: 'sandbox',
      secretVersion: 3,
      tokenId: JTI,
    },
  );
  assert.equal(lookedUpCredentialId, CREDENTIAL_ID);
});

test('A1 bearer revalidation rejects revocation, merchant suspension and identity/version drift immediately', async () => {
  const auth = await authModule();
  const signingAuthority = authority(auth);
  const accessToken = await token(auth, signingAuthority);
  const invalidStates = [
    null,
    activeState({ credentialStatus: 'revoked' }),
    activeState({ merchantLifecycleStatus: 'suspended' }),
    activeState({ secretVersion: 4 }),
    activeState({ merchantId: '60000000-0000-0000-0000-000000000002' }),
    activeState({ environment: 'production' }),
    activeState({ credentialId: '61000000-0000-0000-0000-000000000002' }),
  ];

  for (const state of invalidStates) {
    const store = { async getCredentialAuthState() { return state; } };
    assert.equal(
      await auth.authenticateAccessToken(accessToken, signingAuthority, store, NOW_SECONDS + 1),
      null,
    );
  }
});

test('A1 bearer authentication rejects invalid or expired JWT before touching PostgreSQL', async () => {
  const auth = await authModule();
  const signingAuthority = authority(auth);
  const accessToken = await token(auth, signingAuthority);
  let stateLookups = 0;
  const store = {
    async getCredentialAuthState() {
      stateLookups += 1;
      return activeState();
    },
  };

  assert.equal(
    await auth.authenticateAccessToken(
      accessToken,
      authority(auth, 'abcdef0123456789abcdef0123456789'),
      store,
      NOW_SECONDS + 1,
    ),
    null,
  );
  assert.equal(
    await auth.authenticateAccessToken(accessToken, signingAuthority, store, NOW_SECONDS + 901),
    null,
  );
  assert.equal(stateLookups, 0);
});

test('A1 bearer DB failure remains distinguishable from an invalid credential and is not swallowed', async () => {
  const auth = await authModule();
  const signingAuthority = authority(auth);
  const accessToken = await token(auth, signingAuthority);
  const databaseFailure = new Error('sanitized-runtime-auth-store-failure');
  const store = {
    async getCredentialAuthState() {
      throw databaseFailure;
    },
  };

  await assert.rejects(
    () => auth.authenticateAccessToken(accessToken, signingAuthority, store, NOW_SECONDS + 1),
    (error) => error === databaseFailure,
  );
});
