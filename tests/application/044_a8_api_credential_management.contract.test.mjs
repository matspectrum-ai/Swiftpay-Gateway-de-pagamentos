import assert from 'node:assert/strict';
import test from 'node:test';

const [auth, db, api] = await Promise.all([
  import('../../packages/auth/dist/index.js'),
  import('../../packages/db/dist/index.js'),
  import('../../apps/api/dist/app.js'),
]);

const USER_ID = '10000000-0000-0000-0000-0000000000a8';
const MERCHANT_ID = '20000000-0000-0000-0000-0000000000a8';
const CREDENTIAL_ID = '30000000-0000-0000-0000-0000000000a8';
const CREATED_AT = '2026-08-17T05:00:00.000Z';

const CREDENTIAL = {
  id: CREDENTIAL_ID,
  merchantId: MERCHANT_ID,
  environment: 'sandbox',
  name: 'Primary integration',
  publicKey: 'pk_sandbox_AAAAAAAAAAAAAAAAAAAAAAAA',
  status: 'active',
  secretVersion: 1,
  revision: 1,
  ipAllowlist: null,
  lastUsedAt: null,
  createdAt: CREATED_AT,
  rotatedAt: null,
  revokedAt: null,
};

function compactJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'synthetic-signature-already-validated-online',
  ].join('.');
}

function buildPrivilegedVerifier(options = {}) {
  const aal = Object.prototype.hasOwnProperty.call(options, 'aal') ? options.aal : 'aal2';
  const sub = options.sub ?? USER_ID;
  const status = options.status ?? 200;
  const calls = [];
  const factory = auth.createPrivilegedDashboardSessionVerifier;
  if (typeof factory !== 'function') {
    return {
      calls,
      token: compactJwt({ sub, aal }),
      verifier: async () => ({ kind: 'behavior_not_implemented' }),
    };
  }

  const token = compactJwt({ sub, aal });
  const verifier = factory({
    projectUrl: 'https://swiftpay-a8.supabase.co',
    publishableKey: 'sb_publishable_a8_test',
    transport: async (request) => {
      calls.push(request);
      return { status, body: status === 200 ? { id: USER_ID } : { message: 'rejected' } };
    },
  });
  return { calls, token, verifier };
}

function recordingPool(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return { rows };
    },
  };
}

function buildCredentialStore(pool) {
  if (typeof db.createDashboardApiCredentialStore !== 'function') {
    const missing = async () => ({ kind: 'behavior_not_implemented' });
    return { list: missing, get: missing, create: missing, rotateSecret: missing, revoke: missing };
  }
  return db.createDashboardApiCredentialStore(pool);
}

function buildManagementService(overrides = {}) {
  const calls = {
    ordinaryAuth: [], privilegedAuth: [], context: [], store: [], material: 0,
  };

  const options = {
    ordinarySessionVerifier: async (authorization) => {
      calls.ordinaryAuth.push(authorization);
      return { kind: 'authenticated', principal: { userId: USER_ID } };
    },
    privilegedSessionVerifier: async (authorization) => {
      calls.privilegedAuth.push(authorization);
      return { kind: 'authenticated', principal: { userId: USER_ID, assuranceLevel: 'aal2' } };
    },
    contextStore: {
      requireContext: async (input) => {
        calls.context.push(input);
        return {
          kind: 'authorized',
          context: {
            merchantId: MERCHANT_ID,
            environment: input.environment,
            membershipRole: input.requiredRole,
          },
        };
      },
    },
    store: {
      list: async (input) => { calls.store.push({ method: 'list', input }); return [CREDENTIAL]; },
      get: async (input) => { calls.store.push({ method: 'get', input }); return CREDENTIAL; },
      create: async (input) => {
        calls.store.push({ method: 'create', input });
        return { kind: 'created', replayed: false, credential: CREDENTIAL };
      },
      rotateSecret: async (input) => {
        calls.store.push({ method: 'rotateSecret', input });
        return {
          kind: 'ok', replayed: false,
          credential: { ...CREDENTIAL, secretVersion: 2, revision: 2, rotatedAt: CREATED_AT },
        };
      },
      revoke: async (input) => {
        calls.store.push({ method: 'revoke', input });
        return {
          kind: 'ok', replayed: false,
          credential: { ...CREDENTIAL, status: 'revoked', revision: 2, revokedAt: CREATED_AT },
        };
      },
    },
    materialFactory: async (environment) => {
      calls.material += 1;
      return {
        publicKey: `pk_${environment}_candidate_public`,
        secretKey: `sk_${environment}_candidate_plaintext`,
        secretVerifier: 'scrypt-v1$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      };
    },
    idFactory: () => CREDENTIAL_ID,
    ...overrides,
  };

  if (typeof auth.createDashboardApiCredentialManagementService !== 'function') {
    const missing = async () => ({ kind: 'behavior_not_implemented' });
    return { service: { list: missing, get: missing, create: missing, rotateSecret: missing, revoke: missing }, calls };
  }

  return { service: auth.createDashboardApiCredentialManagementService(options), calls };
}

test('A8 auth package exports the privileged verifier, secret verifier factory, material factory and management service', () => {
  assert.equal(typeof auth.createPrivilegedDashboardSessionVerifier, 'function');
  assert.equal(typeof auth.createCredentialSecretVerifier, 'function');
  assert.equal(typeof auth.generateApiCredentialMaterial, 'function');
  assert.equal(typeof auth.createDashboardApiCredentialManagementService, 'function');
});

test('A8 privileged verifier validates online first and accepts only matching aal2 subject authority', async () => {
  const { calls, token, verifier } = buildPrivilegedVerifier();
  const result = await verifier(`Bearer ${token}`);

  assert.deepEqual(result, {
    kind: 'authenticated',
    principal: { userId: USER_ID, assuranceLevel: 'aal2' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://swiftpay-a8.supabase.co/auth/v1/user');
  assert.equal(calls[0].headers.authorization, `Bearer ${token}`);
});

test('A8 aal1 or missing aal is step_up_required only after successful online validation', async () => {
  for (const aal of ['aal1', undefined]) {
    const { calls, token, verifier } = buildPrivilegedVerifier({ aal });
    const result = await verifier(`Bearer ${token}`);
    assert.deepEqual(result, { kind: 'step_up_required' });
    assert.equal(calls.length, 1);
  }
});

test('A8 privileged verifier rejects malformed bearer before transport and rejects subject mismatch after online validation', async () => {
  const malformed = buildPrivilegedVerifier();
  assert.deepEqual(await malformed.verifier('Basic invalid'), { kind: 'invalid_session' });
  assert.equal(malformed.calls.length, 0);

  const mismatch = buildPrivilegedVerifier({ sub: '90000000-0000-0000-0000-0000000000a8' });
  assert.deepEqual(await mismatch.verifier(`Bearer ${mismatch.token}`), { kind: 'invalid_session' });
  assert.equal(mismatch.calls.length, 1);
});

test('A8 credential material has exact environment prefixes and CSPRNG byte lengths without padding', async () => {
  assert.equal(typeof auth.generateApiCredentialMaterial, 'function');
  const sizes = [];
  const material = await auth.generateApiCredentialMaterial('sandbox', {
    randomBytes: (size) => {
      sizes.push(size);
      return Buffer.alloc(size, size);
    },
    verifierFactory: async (secret) => `verifier-for:${secret}`,
  });

  assert.deepEqual(sizes, [18, 32]);
  assert.match(material.publicKey, /^pk_sandbox_[A-Za-z0-9_-]+$/);
  assert.match(material.secretKey, /^sk_sandbox_[A-Za-z0-9_-]+$/);
  assert.equal(material.publicKey.includes('='), false);
  assert.equal(material.secretKey.includes('='), false);
  assert.equal(Buffer.from(material.publicKey.slice('pk_sandbox_'.length), 'base64url').length, 18);
  assert.equal(Buffer.from(material.secretKey.slice('sk_sandbox_'.length), 'base64url').length, 32);
  assert.equal(material.secretVerifier, `verifier-for:${material.secretKey}`);
});

test('A8 createCredentialSecretVerifier produces the frozen A1 scrypt-v1 representation and verifies exact plaintext', async () => {
  assert.equal(typeof auth.createCredentialSecretVerifier, 'function');
  const verifier = await auth.createCredentialSecretVerifier(
    'sk_sandbox_exact-opaque-secret',
    { salt: Buffer.alloc(16, 7) },
  );
  assert.match(verifier, /^scrypt-v1\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await auth.verifyCredentialSecret('sk_sandbox_exact-opaque-secret', verifier), true);
  assert.equal(await auth.verifyCredentialSecret('sk_sandbox_wrong-secret', verifier), false);
});

test('A8 db package exports store and maps only the five frozen trusted routines', async () => {
  assert.equal(typeof db.createDashboardApiCredentialStore, 'function');
  const pool = recordingPool([{ credential: CREDENTIAL, result: { kind: 'ok', replayed: false, credential: CREDENTIAL } }]);
  const store = buildCredentialStore(pool);

  const common = { userId: USER_ID, merchantId: MERCHANT_ID, environment: 'sandbox' };
  await store.list(common);
  await store.get({ ...common, credentialId: CREDENTIAL_ID });
  await store.create({ ...common, idempotencyKey: 'create-a8', requestHash: 'a'.repeat(64), command: { credentialId: CREDENTIAL_ID } });
  await store.rotateSecret({ ...common, credentialId: CREDENTIAL_ID, idempotencyKey: 'rotate-a8', requestHash: 'b'.repeat(64), command: { expectedRevision: 1 } });
  await store.revoke({ ...common, credentialId: CREDENTIAL_ID, idempotencyKey: 'revoke-a8', requestHash: 'c'.repeat(64), command: { expectedRevision: 1 } });

  assert.equal(pool.calls.length, 5);
  for (const name of [
    'list_dashboard_api_credentials',
    'get_dashboard_api_credential',
    'create_dashboard_api_credential',
    'rotate_dashboard_api_credential_secret',
    'revoke_dashboard_api_credential',
  ]) {
    assert.equal(pool.calls.some((call) => call.sql.includes(`app.${name}`)), true, name);
  }
});

test('A8 reads use ordinary A6 session/member authority and never privileged step-up', async () => {
  const { service, calls } = buildManagementService();
  const listed = await service.list({
    authorization: 'Bearer ordinary-aal1', merchantId: MERCHANT_ID, environment: 'sandbox',
  });
  const got = await service.get({
    authorization: 'Bearer ordinary-aal1', merchantId: MERCHANT_ID, environment: 'sandbox', credentialId: CREDENTIAL_ID,
  });

  assert.equal(listed.kind, 'ok');
  assert.equal(got.kind, 'ok');
  assert.deepEqual(calls.ordinaryAuth, ['Bearer ordinary-aal1', 'Bearer ordinary-aal1']);
  assert.deepEqual(calls.privilegedAuth, []);
  assert.equal(calls.context.every((input) => input.requiredRole === 'member'), true);
});

test('A8 mutations require privileged AAL2 and environment-sensitive role before validation/material/store side effects', async () => {
  const stepped = buildManagementService({
    privilegedSessionVerifier: async () => ({ kind: 'step_up_required' }),
  });
  assert.deepEqual(await stepped.service.create({
    authorization: 'Bearer aal1', merchantId: MERCHANT_ID, environment: 'sandbox',
    idempotencyKey: 'create-a8', request: { name: 'Primary' },
  }), { kind: 'step_up_required' });
  assert.equal(stepped.calls.context.length, 0);
  assert.equal(stepped.calls.material, 0);
  assert.equal(stepped.calls.store.length, 0);

  const sandbox = buildManagementService();
  await sandbox.service.create({
    authorization: 'Bearer aal2', merchantId: MERCHANT_ID, environment: 'sandbox',
    idempotencyKey: 'create-a8-sandbox', request: { name: 'Primary' },
  });
  assert.equal(sandbox.calls.context[0].requiredRole, 'admin');

  const production = buildManagementService();
  await production.service.create({
    authorization: 'Bearer aal2', merchantId: MERCHANT_ID, environment: 'production',
    idempotencyKey: 'create-a8-production', request: { name: 'Primary' },
  });
  assert.equal(production.calls.context[0].requiredRole, 'owner');
});

test('A8 create validates exact input, normalizes exact-IP policy and returns candidate secret only for winning mutation', async () => {
  const { service, calls } = buildManagementService();
  const result = await service.create({
    authorization: 'Bearer aal2', merchantId: MERCHANT_ID, environment: 'sandbox',
    idempotencyKey: ' create-a8-001 ',
    request: { name: '  Primary integration  ', ipAllowlist: [] },
  });

  assert.equal(result.kind, 'created');
  assert.equal(result.secretAvailable, true);
  assert.equal(result.secretKey, 'sk_sandbox_candidate_plaintext');
  assert.equal(result.replayed, false);
  assert.equal(calls.material, 1);
  assert.equal(calls.store.length, 1);
  const command = calls.store[0].input.command;
  assert.equal(command.name, 'Primary integration');
  assert.equal(command.ipAllowlist, null);
  assert.equal(command.publicKey, 'pk_sandbox_candidate_public');
  assert.equal(typeof command.secretVerifier, 'string');
  assert.equal(JSON.stringify(calls.store[0].input).includes('candidate_plaintext'), false);
});

test('A8 completed create/rotate replay never re-discloses generated candidate secret', async () => {
  const replayStore = {
    list: async () => [],
    get: async () => CREDENTIAL,
    create: async () => ({ kind: 'created', replayed: true, credential: CREDENTIAL }),
    rotateSecret: async () => ({ kind: 'ok', replayed: true, credential: { ...CREDENTIAL, secretVersion: 2, revision: 2 } }),
    revoke: async () => ({ kind: 'not_used' }),
  };
  const { service } = buildManagementService({ store: replayStore });

  const created = await service.create({
    authorization: 'Bearer aal2', merchantId: MERCHANT_ID, environment: 'sandbox',
    idempotencyKey: 'create-a8-replay', request: { name: 'Primary' },
  });
  assert.equal(created.replayed, true);
  assert.equal(created.secretAvailable, false);
  assert.equal(created.secretKey, null);

  const rotated = await service.rotateSecret({
    authorization: 'Bearer aal2', merchantId: MERCHANT_ID, environment: 'sandbox', credentialId: CREDENTIAL_ID,
    idempotencyKey: 'rotate-a8-replay', request: { expectedRevision: 1 },
  });
  assert.equal(rotated.replayed, true);
  assert.equal(rotated.secretAvailable, false);
  assert.equal(rotated.secretKey, null);
});

test('A8 revoke never generates secret material and forwards only expectedRevision under idempotency fencing', async () => {
  const { service, calls } = buildManagementService();
  const result = await service.revoke({
    authorization: 'Bearer aal2', merchantId: MERCHANT_ID, environment: 'sandbox', credentialId: CREDENTIAL_ID,
    idempotencyKey: ' revoke-a8-001 ', request: { expectedRevision: 1 },
  });

  assert.equal(result.kind, 'ok');
  assert.equal(calls.material, 0);
  assert.equal(calls.store.length, 1);
  assert.equal(calls.store[0].method, 'revoke');
  assert.deepEqual(calls.store[0].input.command, { expectedRevision: 1 });
  assert.equal(calls.store[0].input.idempotencyKey, 'revoke-a8-001');
});

test('A8 Fastify exposes dashboard credential routes and maps step-up without machine-realm fallback', async () => {
  const calls = [];
  const app = api.buildApp({
    readinessProbe: async () => {},
    authenticateBearer: async () => ({
      merchantId: MERCHANT_ID, credentialId: CREDENTIAL_ID, environment: 'sandbox', secretVersion: 1, tokenId: CREDENTIAL_ID,
    }),
    dashboardApiCredentials: {
      list: async () => ({ kind: 'ok', credentials: [CREDENTIAL] }),
      get: async () => ({ kind: 'ok', credential: CREDENTIAL }),
      create: async (input) => { calls.push(input); return { kind: 'step_up_required' }; },
      rotateSecret: async () => ({ kind: 'ok', replayed: false, credential: { ...CREDENTIAL, secretVersion: 2, revision: 2 }, secretKey: 'sk_sandbox_once', secretAvailable: true }),
      revoke: async () => ({ kind: 'ok', replayed: false, credential: { ...CREDENTIAL, status: 'revoked', revision: 2 } }),
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: `/dashboard/v1/merchants/${MERCHANT_ID}/environments/sandbox/api-credentials`,
    headers: { authorization: 'Bearer dashboard-aal1', 'idempotency-key': 'create-a8-http' },
    payload: { name: 'Primary' },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'step_up_required');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].authorization, 'Bearer dashboard-aal1');

  const machineNamespace = await app.inject({
    method: 'POST',
    url: `/v1/merchants/${MERCHANT_ID}/api-credentials`,
    headers: { authorization: 'Bearer machine-token', 'idempotency-key': 'forbidden-machine-route' },
    payload: { name: 'Nope' },
  });
  assert.equal(machineNamespace.statusCode, 404);

  await app.close();
});
