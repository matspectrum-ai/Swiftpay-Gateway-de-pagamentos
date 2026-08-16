import assert from 'node:assert/strict';
import test from 'node:test';

const auth = await import('../../packages/auth/dist/index.js');

const USER_ID = '10000000-0000-0000-0000-0000000000a6';
const MERCHANT_ID = '20000000-0000-0000-0000-0000000000a6';

const factory = auth.createDashboardAuthorizationService;

function buildService(sessionVerifier, contextStore) {
  if (typeof factory !== 'function') {
    return async () => ({ kind: 'not_implemented' });
  }
  return factory({ sessionVerifier, contextStore });
}

const request = {
  authorization: 'Bearer dashboard-session-token',
  merchantId: MERCHANT_ID,
  environment: 'sandbox',
  requiredRole: 'admin',
};

test('A6 auth package exports createDashboardAuthorizationService', () => {
  assert.equal(typeof factory, 'function');
});

test('A6 authorization service short-circuits database when session verifier returns invalid_session', async () => {
  let dbCalls = 0;
  const authorize = buildService(
    async () => ({ kind: 'invalid_session' }),
    { requireContext: async () => { dbCalls += 1; return { kind: 'authorized', context: {} }; } },
  );
  assert.deepEqual(await authorize(request), { kind: 'invalid_session' });
  assert.equal(dbCalls, 0);
});

test('A6 authorization service short-circuits database when Supabase Auth is unavailable', async () => {
  let dbCalls = 0;
  const authorize = buildService(
    async () => ({ kind: 'authentication_unavailable' }),
    { requireContext: async () => { dbCalls += 1; return { kind: 'authorized', context: {} }; } },
  );
  assert.deepEqual(await authorize(request), { kind: 'authentication_unavailable' });
  assert.equal(dbCalls, 0);
});

test('A6 authorization service passes only verified userId plus route-scoped context to K4 store', async () => {
  const calls = [];
  const authorize = buildService(
    async () => ({
      kind: 'authenticated',
      principal: {
        userId: USER_ID,
        merchantId: 'attacker-supplied-merchant',
        role: 'owner',
        environment: 'production',
      },
    }),
    {
      requireContext: async (input) => {
        calls.push(input);
        return {
          kind: 'authorized',
          context: {
            merchantId: MERCHANT_ID,
            environment: 'sandbox',
            membershipRole: 'admin',
          },
        };
      },
    },
  );

  const result = await authorize(request);
  assert.deepEqual(calls, [{
    userId: USER_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    requiredRole: 'admin',
  }]);
  assert.deepEqual(result, {
    kind: 'authorized',
    context: {
      merchantId: MERCHANT_ID,
      environment: 'sandbox',
      membershipRole: 'admin',
    },
  });
});

test('A6 authorization service preserves K4 mapped forbidden validation and internal errors', async () => {
  for (const kind of ['forbidden', 'validation_error', 'internal_error']) {
    const authorize = buildService(
      async () => ({ kind: 'authenticated', principal: { userId: USER_ID } }),
      { requireContext: async () => ({ kind }) },
    );
    assert.deepEqual(await authorize(request), { kind });
  }
});

test('A6 authorization service invokes session verifier and K4 store exactly once on success', async () => {
  let authCalls = 0;
  let dbCalls = 0;
  const authorize = buildService(
    async (authorization) => {
      authCalls += 1;
      assert.equal(authorization, request.authorization);
      return { kind: 'authenticated', principal: { userId: USER_ID } };
    },
    {
      requireContext: async () => {
        dbCalls += 1;
        return {
          kind: 'authorized',
          context: { merchantId: MERCHANT_ID, environment: 'sandbox', membershipRole: 'admin' },
        };
      },
    },
  );
  const result = await authorize(request);
  assert.equal(result.kind, 'authorized');
  assert.equal(authCalls, 1);
  assert.equal(dbCalls, 1);
});

test('A6 authorization service has no machine-auth fallback path', async () => {
  let dbCalls = 0;
  const authorize = buildService(
    async () => ({ kind: 'invalid_session' }),
    { requireContext: async () => { dbCalls += 1; return { kind: 'forbidden' }; } },
  );
  const result = await authorize({
    ...request,
    authorization: 'Bearer token-that-could-be-a-swiftpay-machine-token',
  });
  assert.deepEqual(result, { kind: 'invalid_session' });
  assert.equal(dbCalls, 0);
});
