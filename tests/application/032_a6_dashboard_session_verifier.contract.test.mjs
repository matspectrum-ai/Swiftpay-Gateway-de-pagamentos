import assert from 'node:assert/strict';
import test from 'node:test';

const auth = await import('../../packages/auth/dist/index.js');

const USER_ID = '10000000-0000-0000-0000-0000000000a6';
const PROJECT_URL = 'https://project-a6.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_a6_test_key';
const ACCESS_TOKEN = 'a6-user-access-token';

const factory = auth.createSupabaseDashboardSessionVerifier;

function buildVerifier(transport) {
  if (typeof factory !== 'function') {
    return async () => ({ kind: 'not_implemented' });
  }
  return factory({
    projectUrl: PROJECT_URL,
    publishableKey: PUBLISHABLE_KEY,
    transport,
  });
}

function response(status, body = null) {
  return { status, body };
}

test('A6 auth package exports createSupabaseDashboardSessionVerifier', () => {
  assert.equal(typeof factory, 'function');
});

test('A6 verifier performs one exact Supabase Auth user request and returns only verified userId authority', async () => {
  const requests = [];
  const verifier = buildVerifier(async (request) => {
    requests.push(request);
    return response(200, {
      id: USER_ID,
      raw_user_meta_data: { merchant_id: 'attacker-merchant', role: 'owner' },
      raw_app_meta_data: { environment: 'production' },
    });
  });

  const result = await verifier(`Bearer ${ACCESS_TOKEN}`);

  assert.deepEqual(result, {
    kind: 'authenticated',
    principal: { userId: USER_ID },
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    method: 'GET',
    url: `${PROJECT_URL}/auth/v1/user`,
    headers: {
      accept: 'application/json',
      apikey: PUBLISHABLE_KEY,
      authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    timeoutMs: 5000,
    redirect: 'manual',
  });
});

test('A6 verifier rejects malformed Bearer headers without any Auth transport call', async (t) => {
  const invalidHeaders = [
    undefined,
    null,
    '',
    'Bearer',
    'Bearer ',
    'Bearer token extra',
    'Basic token',
    ' Bearer token',
    'Bearer token ',
  ];

  for (const authorization of invalidHeaders) {
    await t.test(String(authorization), async () => {
      let calls = 0;
      const verifier = buildVerifier(async () => {
        calls += 1;
        return response(200, { id: USER_ID });
      });
      assert.deepEqual(await verifier(authorization), { kind: 'invalid_session' });
      assert.equal(calls, 0);
    });
  }

  let calls = 0;
  const verifier = buildVerifier(async () => {
    calls += 1;
    return response(200, { id: USER_ID });
  });
  assert.deepEqual(await verifier(`bEaReR ${ACCESS_TOKEN}`), {
    kind: 'authenticated',
    principal: { userId: USER_ID },
  });
  assert.equal(calls, 1);
});

test('A6 verifier maps Supabase 401 and 403 to invalid_session', async () => {
  for (const status of [401, 403]) {
    const verifier = buildVerifier(async () => response(status, { message: 'credential body must stay private' }));
    assert.deepEqual(await verifier(`Bearer ${ACCESS_TOKEN}`), { kind: 'invalid_session' });
  }
});

test('A6 verifier maps redirects, rate limits, unexpected 4xx and 5xx to authentication_unavailable', async () => {
  for (const status of [302, 400, 404, 429, 500, 503, 599]) {
    const verifier = buildVerifier(async () => response(status, { message: 'upstream body must stay private' }));
    assert.deepEqual(await verifier(`Bearer ${ACCESS_TOKEN}`), { kind: 'authentication_unavailable' });
  }
});

test('A6 verifier maps timeout and network failures to authentication_unavailable without retry', async () => {
  for (const error of [new Error('network down'), Object.assign(new Error('timeout'), { name: 'AbortError' })]) {
    let calls = 0;
    const verifier = buildVerifier(async () => {
      calls += 1;
      throw error;
    });
    assert.deepEqual(await verifier(`Bearer ${ACCESS_TOKEN}`), { kind: 'authentication_unavailable' });
    assert.equal(calls, 1);
  }
});

test('A6 verifier treats malformed 200 responses as authentication_unavailable', async () => {
  const malformed = [
    null,
    {},
    { id: '' },
    { id: 'not-a-uuid' },
    { id: 123 },
  ];
  for (const body of malformed) {
    const verifier = buildVerifier(async () => response(200, body));
    assert.deepEqual(await verifier(`Bearer ${ACCESS_TOKEN}`), { kind: 'authentication_unavailable' });
  }
});

test('A6 verifier performs exactly one transport attempt for one authentication', async () => {
  let calls = 0;
  const verifier = buildVerifier(async () => {
    calls += 1;
    return response(503, null);
  });
  await verifier(`Bearer ${ACCESS_TOKEN}`);
  assert.equal(calls, 1);
});

test('A6 verifier results do not expose access token, authorization header, publishable key or upstream body', async () => {
  const sensitiveBody = `private-body-${ACCESS_TOKEN}`;
  const verifier = buildVerifier(async () => response(503, { message: sensitiveBody }));
  const result = await verifier(`Bearer ${ACCESS_TOKEN}`);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(ACCESS_TOKEN), false);
  assert.equal(serialized.includes(PUBLISHABLE_KEY), false);
  assert.equal(serialized.includes(sensitiveBody), false);
  assert.equal(serialized.includes('authorization'), false);
});
