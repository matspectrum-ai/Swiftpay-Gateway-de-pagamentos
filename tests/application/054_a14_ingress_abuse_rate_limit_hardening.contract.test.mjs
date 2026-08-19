import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const HMAC_KEY = 'a14-test-hmac-key-with-at-least-32-bytes';

async function abuseModule() {
  try {
    return await import('../../packages/abuse/dist/index.js');
  } catch {
    return {};
  }
}

async function requireA14() {
  const module = await abuseModule();
  assert.equal(typeof module.normalizeCanonicalIp, 'function');
  assert.equal(typeof module.createApiAbuseControls, 'function');
  return module;
}

async function buildApp(extra = {}) {
  const api = await import('../../apps/api/dist/app.js');
  return api.buildApp({ readinessProbe: async () => {}, ...extra });
}

function admissionStub({ network = 'allowed', machine = 'allowed', resolvedIp = '203.0.113.10' } = {}) {
  const calls = { resolve: [], network: [], machine: [] };
  const result = (kind) => kind === 'allowed'
    ? { kind: 'allowed', remaining: 10 }
    : kind === 'rate_limited'
      ? { kind: 'rate_limited', retryAfterSeconds: 17 }
      : { kind: 'unavailable' };
  return {
    calls,
    controls: {
      resolveClientIp(input) {
        calls.resolve.push(structuredClone(input));
        return resolvedIp;
      },
      async admitNetwork(input) {
        calls.network.push(structuredClone(input));
        return result(network);
      },
      async admitMachine(input) {
        calls.machine.push(structuredClone(input));
        return result(machine);
      },
    },
  };
}

function machinePrincipal() {
  return {
    merchantId: MERCHANT_ID,
    credentialId: '22222222-2222-4222-8222-222222222222',
    environment: 'sandbox',
    secretVersion: 1,
    tokenId: '33333333-3333-4333-8333-333333333333',
  };
}

test('A14 abuse package exists and exposes only the frozen ingress/admission boundary', async () => {
  const module = await requireA14();
  assert.deepEqual(
    Object.keys(module).sort(),
    ['createApiAbuseControls', 'normalizeCanonicalIp'].sort(),
  );
  const [rootTsconfig, apiPackage, abusePackage] = await Promise.all([
    readFile(path.join(ROOT, 'tsconfig.json'), 'utf8'),
    readFile(path.join(ROOT, 'apps/api/package.json'), 'utf8'),
    readFile(path.join(ROOT, 'packages/abuse/package.json'), 'utf8'),
  ]);
  assert.match(rootTsconfig, /packages\/abuse/);
  assert.match(apiPackage, /@swiftpay\/abuse/);
  assert.match(abusePackage, /"name"\s*:\s*"@swiftpay\/abuse"/);
});

test('A14 canonical IP normalization removes textual IPv6 aliases and rejects non-IP origin strings', async () => {
  const { normalizeCanonicalIp } = await requireA14();
  assert.equal(normalizeCanonicalIp('192.0.2.10'), '192.0.2.10');
  assert.equal(normalizeCanonicalIp('2001:0db8:0:0:0:0:0:1'), '2001:db8::1');
  assert.equal(normalizeCanonicalIp('::FFFF:192.0.2.1'), '::ffff:c000:201');
  for (const invalid of ['', ' 192.0.2.10 ', '10.0.0.0/8', '*', 'not-an-ip']) {
    assert.equal(normalizeCanonicalIp(invalid), null);
  }
});

test('A14 trusted-ingress resolver ignores spoofed forwarding from untrusted peers and requires one forwarded IP from trusted peers', async () => {
  const { createApiAbuseControls } = await requireA14();
  const store = { consume: async () => ({ allowed: true, remaining: 29, retryAfterSeconds: 0 }) };
  const direct = createApiAbuseControls(store, { trustedProxyIps: [], hmacKey: HMAC_KEY });
  assert.equal(direct.resolveClientIp({ remoteAddress: '198.51.100.10', xForwardedFor: '203.0.113.99' }), '198.51.100.10');

  const proxied = createApiAbuseControls(store, { trustedProxyIps: ['198.51.100.10'], hmacKey: HMAC_KEY });
  assert.equal(proxied.resolveClientIp({ remoteAddress: '198.51.100.10', xForwardedFor: '203.0.113.99' }), '203.0.113.99');
  assert.equal(proxied.resolveClientIp({ remoteAddress: '198.51.100.10', xForwardedFor: undefined }), null);
  assert.equal(proxied.resolveClientIp({ remoteAddress: '198.51.100.10', xForwardedFor: '203.0.113.99, 192.0.2.1' }), null);
});

test('A14 persists only deterministic active HMAC subject hashes and validates store decisions fail-closed', async () => {
  const { createApiAbuseControls } = await requireA14();
  const inputs = [];
  const store = { consume: async (input) => { inputs.push(input); return { allowed: true, remaining: 29, retryAfterSeconds: 0 }; } };
  const controls = createApiAbuseControls(store, { trustedProxyIps: [], hmacKey: HMAC_KEY });
  const result = await controls.admitNetwork({ policy: 'token_exchange_pre_auth', clientIp: '203.0.113.10' });
  assert.deepEqual(result, { kind: 'allowed', remaining: 29 });
  assert.equal(inputs.length, 1);
  assert.deepEqual(inputs[0], {
    policy: 'token_exchange_pre_auth',
    activeSubjectHash: createHmac('sha256', HMAC_KEY).update('a14v0\nnetwork\n203.0.113.10', 'utf8').digest('hex'),
  });
  assert.doesNotMatch(JSON.stringify(inputs), /203\.0\.113\.10|Bearer|secret/i);

  const malformed = createApiAbuseControls(
    { consume: async () => ({ allowed: false, remaining: 7, retryAfterSeconds: 0 }) },
    { trustedProxyIps: [], hmacKey: HMAC_KEY },
  );
  assert.deepEqual(await malformed.admitNetwork({ policy: 'token_exchange_pre_auth', clientIp: '203.0.113.10' }), { kind: 'unavailable' });
});

test('A14 token pre-auth throttle happens before A1 handler and preserves deterministic 429 Retry-After', async () => {
  const abuse = admissionStub({ network: 'rate_limited' });
  let tokenCalls = 0;
  const app = await buildApp({
    abuseControls: abuse.controls,
    tokenExchange: async () => { tokenCalls += 1; return { ok: false, error: { code: 'invalid_credentials', message: 'Invalid credentials.' } }; },
  });
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/auth/token', payload: { grantType: 'client_credentials', publicKey: 'pk', secretKey: 'bad' } });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers['retry-after'], '17');
    assert.equal(response.json().error.code, 'rate_limit_exceeded');
    assert.equal(tokenCalls, 0);
    assert.equal(abuse.calls.network[0].policy, 'token_exchange_pre_auth');
  } finally { await app.close(); }
});

test('A14 machine pre-auth throttle happens before bearer DB revalidation', async () => {
  const abuse = admissionStub({ network: 'rate_limited' });
  let authCalls = 0;
  const app = await buildApp({ abuseControls: abuse.controls, authenticateBearer: async () => { authCalls += 1; return machinePrincipal(); }, merchantBalance: { get: async () => ({}) } });
  try {
    const response = await app.inject({ method: 'GET', url: '/v1/balance', headers: { authorization: 'Bearer token-canary' } });
    assert.equal(response.statusCode, 429);
    assert.equal(authCalls, 0);
    assert.equal(abuse.calls.network[0].policy, 'machine_request_pre_auth');
  } finally { await app.close(); }
});

test('A14 post-auth machine mutation throttle occurs before Pix/idempotency service', async () => {
  const abuse = admissionStub({ machine: 'rate_limited' });
  let createCalls = 0;
  const app = await buildApp({
    abuseControls: abuse.controls,
    authenticateBearer: async () => machinePrincipal(),
    pixPayments: {
      create: async () => { createCalls += 1; return { ok: true, httpStatus: 201, payment: {}, replayed: false }; },
      get: async () => null,
    },
  });
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/transactions', headers: { authorization: 'Bearer valid', 'idempotency-key': 'idem' }, payload: {} });
    assert.equal(response.statusCode, 429);
    assert.equal(createCalls, 0);
    assert.deepEqual(abuse.calls.machine[0], { policy: 'machine_mutation', merchantId: MERCHANT_ID, environment: 'sandbox' });
  } finally { await app.close(); }
});

test('A14 post-auth machine reads share merchant/environment subject independent of credential', async () => {
  const abuse = admissionStub();
  const app = await buildApp({ abuseControls: abuse.controls, authenticateBearer: async () => machinePrincipal(), merchantBalance: { get: async () => ({ available: 0 }) } });
  try {
    const response = await app.inject({ method: 'GET', url: '/v1/balance', headers: { authorization: 'Bearer valid' } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(abuse.calls.machine[0], { policy: 'machine_read', merchantId: MERCHANT_ID, environment: 'sandbox' });
  } finally { await app.close(); }
});

test('A14 dashboard network throttle occurs before any dashboard/Supabase service boundary', async () => {
  const abuse = admissionStub({ network: 'rate_limited' });
  let dashboardCalls = 0;
  const app = await buildApp({ abuseControls: abuse.controls, dashboardTransactions: { list: async () => { dashboardCalls += 1; return { kind: 'ok', transactions: [] }; } } });
  try {
    const response = await app.inject({ method: 'GET', url: `/dashboard/v1/merchants/${MERCHANT_ID}/environments/sandbox/transactions`, headers: { authorization: 'Bearer dashboard-canary' } });
    assert.equal(response.statusCode, 429);
    assert.equal(dashboardCalls, 0);
    assert.equal(abuse.calls.network[0].policy, 'dashboard_request_pre_auth');
  } finally { await app.close(); }
});

test('A14 readiness throttle prevents DB probe while liveness remains independent', async () => {
  const abuse = admissionStub({ network: 'rate_limited' });
  let readinessCalls = 0;
  const app = await buildApp({ abuseControls: abuse.controls, readinessProbe: async () => { readinessCalls += 1; } });
  try {
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(ready.statusCode, 429);
    assert.equal(readinessCalls, 0);
    assert.equal(abuse.calls.network[0].policy, 'readiness_probe');
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(live.statusCode, 200);
    assert.equal(abuse.calls.network.length, 1);
  } finally { await app.close(); }
});

test('A14 admission unavailability fails closed as sanitized 503 without limiter identity disclosure', async () => {
  const abuse = admissionStub({ network: 'unavailable' });
  const app = await buildApp({ abuseControls: abuse.controls, readinessProbe: async () => {} });
  try {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(response.statusCode, 503);
    const body = response.json();
    assert.equal(body.error.code, 'request_admission_unavailable');
    const encoded = JSON.stringify(body);
    assert.doesNotMatch(encoded, /203\.0\.113\.10|activeSubjectHash|previousSubjectHash|HMAC_KEY|secret/i);
  } finally { await app.close(); }
});

test('A14 config freezes exact trusted proxies plus dedicated HMAC authority without generic trustProxy', async () => {
  const [configSource, appSource] = await Promise.all([
    readFile(path.join(ROOT, 'packages/config/src/core.ts'), 'utf8'),
    readFile(path.join(ROOT, 'apps/api/src/app.ts'), 'utf8'),
  ]);
  assert.match(configSource, /SWIFTPAY_TRUSTED_PROXY_IPS/);
  assert.match(configSource, /SWIFTPAY_ABUSE_HMAC_KEY/);
  assert.match(configSource, /trustedProxyIps/);
  assert.match(configSource, /abuseHmacKey/);
  assert.doesNotMatch(appSource, /trustProxy:\s*true/);
});

test('A14 production runtime wires trusted DB store and abuse controls while worker gets no abuse authority', async () => {
  const [apiIndex, apiRuntime, workerIndex, dbIndex] = await Promise.all([
    readFile(path.join(ROOT, 'apps/api/src/index.ts'), 'utf8'),
    readFile(path.join(ROOT, 'apps/api/src/runtime.ts'), 'utf8'),
    readFile(path.join(ROOT, 'apps/worker/src/index.ts'), 'utf8'),
    readFile(path.join(ROOT, 'packages/db/src/index.ts'), 'utf8'),
  ]);
  assert.match(apiIndex + apiRuntime, /createApiAbuseControls/);
  assert.match(apiIndex + apiRuntime, /createApiAbuseRateLimitStore/);
  assert.match(apiIndex, /trustedProxyIps:\s*config\.trustedProxyIps|config\.trustedProxyIps/);
  assert.match(apiIndex, /abuseHmacKey:\s*config\.abuseHmacKey|config\.abuseHmacKey/);
  assert.match(dbIndex, /api-abuse-rate-limit/);
  assert.doesNotMatch(workerIndex, /@swiftpay\/abuse|createApiAbuseRateLimitStore|SWIFTPAY_ABUSE_HMAC_KEY/);
});

test('A14 preserves the exact A1 successful issuance quota and privacy/authority boundaries', async () => {
  const [a1Spec, migration, obsSource, metricsSource] = await Promise.all([
    readFile(path.join(ROOT, 'docs/specs/api-credential-token-exchange-v0.yaml'), 'utf8'),
    readFile(path.join(ROOT, 'supabase/migrations/20260815054302_api_credential_token_auth_behavior.sql'), 'utf8'),
    readFile(path.join(ROOT, 'packages/observability/src/index.ts'), 'utf8'),
    readFile(path.join(ROOT, 'packages/metrics/src/index.ts'), 'utf8'),
  ]);
  assert.match(a1Spec, /limit:\s*10/);
  assert.match(a1Spec, /window_seconds:\s*3600/);
  assert.match(a1Spec, /Invalid-secret abuse protection remains a deployment\/WAF concern/);
  assert.match(migration, /if v_issued_count < 10/);
  assert.doesNotMatch(obsSource, /activeSubjectHash|previousSubjectHash|x-forwarded-for|clientIp/);
  assert.doesNotMatch(metricsSource, /activeSubjectHash|previousSubjectHash|x-forwarded-for|clientIp/);
});
