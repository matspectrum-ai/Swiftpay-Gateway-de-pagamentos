import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const [auth, db, apiModule] = await Promise.all([
  import('../../packages/auth/dist/index.js'),
  import('../../packages/db/dist/index.js'),
  import('../../apps/api/dist/app.js'),
]);

async function text(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

async function json(path) {
  return JSON.parse(await text(path));
}

const WEB_FILES = [
  'apps/dashboard/package.json',
  'apps/dashboard/index.html',
  'apps/dashboard/vite.config.ts',
  'apps/dashboard/tsconfig.json',
  'apps/dashboard/src/main.tsx',
  'apps/dashboard/src/app-base.tsx',
  'apps/dashboard/src/auth.ts',
  'apps/dashboard/src/api-base.ts',
  'apps/dashboard/src/styles.css',
];

const USER_ID = '21100000-0000-0000-0000-00000000a021';
const MERCHANT_ID = '21000000-0000-0000-0000-00000000a021';
const CONTEXT = {
  merchantId: MERCHANT_ID,
  merchantName: 'SwiftPay Merchant',
  lifecycleStatus: 'active',
  membershipRole: 'owner',
  environments: ['sandbox', 'production'],
};

test('A21 frozen spec and contract name the browser-only dashboard boundary', async () => {
  const spec = await text('docs/specs/merchant-dashboard-web-foundation-v0.yaml');
  const contract = await text('docs/contracts/merchant-dashboard-web-foundation-v0.md');
  assert.match(spec, /path: apps\/dashboard/);
  assert.match(spec, /rendering: browser_spa/);
  assert.match(spec, /value: \/api/);
  assert.match(contract, /GET \/dashboard\/v1\/contexts/);
  assert.match(contract, /Supabase browser client is Auth-only/);
});

test('A21 real dashboard workspace exists with the frozen minimal files and dependencies', async () => {
  for (const path of WEB_FILES) await readFile(new URL(`../../${path}`, import.meta.url));

  const manifest = await json('apps/dashboard/package.json');
  assert.equal(manifest.name, '@swiftpay/dashboard');
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies.react, '19.2.8');
  assert.equal(manifest.dependencies['react-dom'], '19.2.8');
  assert.equal(manifest.dependencies['@supabase/supabase-js'], '2.112.1');
  assert.equal(manifest.devDependencies.vite, '8.2.1');
  assert.equal(manifest.scripts.build, 'tsc -b && vite build');
});

test('A21 browser source is Auth/API-only and contains no trusted database or provider authority', async () => {
  const source = (await Promise.all([
    text('apps/dashboard/src/app-base.tsx'),
    text('apps/dashboard/src/auth.ts'),
    text('apps/dashboard/src/api-base.ts'),
  ])).join('\n');

  assert.match(source, /VITE_SUPABASE_URL/);
  assert.match(source, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(source, /signInWithPassword/);
  assert.match(source, /\/api\/dashboard\/v1\/contexts/);
  assert.match(source, /\/transactions/);
  assert.match(source, /cache:\s*['"]no-store['"]/);
  assert.doesNotMatch(source, /\.from\s*\(/);
  assert.doesNotMatch(source, /\.rpc\s*\(/);
  assert.doesNotMatch(source, /service[_-]?role/i);
  assert.doesNotMatch(source, /DATABASE_URL/);
  assert.doesNotMatch(source, /swiftpay_api|swiftpay_worker/);
  assert.doesNotMatch(source, /akkad|akadpay|flevopay|provider[_-]?secret/i);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});

test('A21 dashboard context store uses only the trusted discovery routine and validates its public projection', async () => {
  assert.equal(typeof db.createDashboardContextDiscoveryStore, 'function');
  if (typeof db.createDashboardContextDiscoveryStore !== 'function') return;

  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return {
        rows: [{
          merchant_id: MERCHANT_ID,
          merchant_name: 'SwiftPay Merchant',
          lifecycle_status: 'active',
          membership_role: 'owner',
        }],
      };
    },
  };
  const store = db.createDashboardContextDiscoveryStore(pool);
  assert.deepEqual(await store.listForUser(USER_ID), [CONTEXT]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /app\.list_dashboard_merchant_contexts/);
  assert.deepEqual(calls[0].params, [USER_ID]);
  assert.doesNotMatch(calls[0].sql.toLowerCase(), /from\s+app\.merchant_members|from\s+app\.merchants/);
});

test('A21 context discovery service derives database user authority only from verified A6 session', async () => {
  assert.equal(typeof auth.createDashboardContextDiscoveryService, 'function');
  if (typeof auth.createDashboardContextDiscoveryService !== 'function') return;

  const calls = { auth: [], db: [] };
  const service = auth.createDashboardContextDiscoveryService({
    sessionVerifier: async (authorization) => {
      calls.auth.push(authorization);
      return { kind: 'authenticated', principal: { userId: USER_ID } };
    },
    store: {
      listForUser: async (userId) => {
        calls.db.push(userId);
        return [CONTEXT];
      },
    },
  });
  assert.deepEqual(await service.list('Bearer dashboard-session'), { kind: 'ok', contexts: [CONTEXT] });
  assert.deepEqual(calls.auth, ['Bearer dashboard-session']);
  assert.deepEqual(calls.db, [USER_ID]);

  let blockedDbCalls = 0;
  const invalidService = auth.createDashboardContextDiscoveryService({
    sessionVerifier: async () => ({ kind: 'invalid_session' }),
    store: { listForUser: async () => { blockedDbCalls += 1; return []; } },
  });
  assert.deepEqual(await invalidService.list('Bearer invalid'), { kind: 'invalid_session' });
  assert.equal(blockedDbCalls, 0);
});

test('A21 dashboard API exposes context discovery and wires a dedicated service without machine-auth fallback', async () => {
  const app = await text('apps/api/src/app-base.ts');
  const runtime = await text('apps/api/src/runtime-base.ts');
  const authIndex = await text('packages/auth/src/index.ts');
  const dbIndex = await text('packages/db/src/index.ts');

  assert.match(app, /dashboardContextDiscovery/);
  assert.match(app, /['"]\/dashboard\/v1\/contexts['"]/);
  assert.match(app, /Cache-Control/);
  assert.match(runtime, /createDashboardContextDiscoveryService/);
  assert.match(runtime, /createDashboardContextDiscoveryStore/);
  assert.match(authIndex, /createDashboardContextDiscoveryService/);
  assert.match(dbIndex, /createDashboardContextDiscoveryStore/);
});

test('A21 context discovery HTTP maps success and auth/service failures with no-store semantics', async () => {
  const successApp = apiModule.buildApp({
    readinessProbe: async () => {},
    dashboardContextDiscovery: { list: async () => ({ kind: 'ok', contexts: [CONTEXT] }) },
  });
  const success = await successApp.inject({
    method: 'GET',
    url: '/dashboard/v1/contexts',
    headers: { authorization: 'Bearer dashboard-session' },
  });
  assert.equal(success.statusCode, 200);
  assert.equal(success.headers['cache-control'], 'private, no-store');
  assert.deepEqual(success.json(), { object: 'list', data: [CONTEXT] });
  await successApp.close();

  for (const [kind, status, code] of [
    ['invalid_session', 401, 'invalid_dashboard_session'],
    ['authentication_unavailable', 503, 'dashboard_authentication_unavailable'],
    ['internal_error', 500, 'internal_error'],
  ]) {
    const app = apiModule.buildApp({
      readinessProbe: async () => {},
      dashboardContextDiscovery: { list: async () => ({ kind }) },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/dashboard/v1/contexts',
      headers: { authorization: 'Bearer dashboard-session' },
    });
    assert.equal(response.statusCode, status, kind);
    assert.equal(response.headers['cache-control'], 'private, no-store', kind);
    assert.equal(response.json().error.code, code, kind);
    assert.equal(typeof response.json().error.requestId, 'string', kind);
    await app.close();
  }
});

test('A21 context capability remains present after the later A23 expansion to 30/6', async () => {
  const manifest = await json('ops/security/runtime-capabilities-v0.json');
  assert.equal(manifest.roles.swiftpay_api.expectedCount, 30);
  assert.equal(manifest.roles.swiftpay_worker.expectedCount, 6);
  assert.ok(manifest.roles.swiftpay_api.signatures.includes('app.list_dashboard_merchant_contexts(uuid)'));
  assert.equal(manifest.roles.swiftpay_api.signatures.length, 30);
  assert.equal(manifest.roles.swiftpay_worker.signatures.length, 6);
});

test('A21 dashboard web shell freezes visible login, context, list, detail and failure states', async () => {
  const app = await text('apps/dashboard/src/app-base.tsx');
  for (const marker of [
    'Entrar',
    'Transações',
    'Sandbox',
    'Produção',
    'Nenhuma transação',
    'Sessão expirada',
    'Acesso não autorizado',
    'Serviço temporariamente indisponível',
  ]) {
    assert.match(app, new RegExp(marker));
  }
});

test('A21 preserves no provider or financial browser mutation authority as later dashboard administration views are added', async () => {
  const source = (await Promise.all([
    text('apps/dashboard/src/app-base.tsx'),
    text('apps/dashboard/src/api-base.ts'),
  ])).join('\n');

  assert.doesNotMatch(source, /\/v1\/(?:payments|pix|refunds|payouts|balance)(?:\b|\/)/i);
  assert.doesNotMatch(source, /\/provider(?:s)?\//i);
  assert.doesNotMatch(source, /akkad|akadpay|flevopay/i);
});
