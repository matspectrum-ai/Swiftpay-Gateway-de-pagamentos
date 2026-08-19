import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

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
  'apps/dashboard/src/app.tsx',
  'apps/dashboard/src/auth.ts',
  'apps/dashboard/src/api.ts',
  'apps/dashboard/src/styles.css',
];

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
    text('apps/dashboard/src/app.tsx'),
    text('apps/dashboard/src/auth.ts'),
    text('apps/dashboard/src/api.ts'),
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

test('A21 dashboard API exposes context discovery and wires a dedicated service without machine-auth fallback', async () => {
  const app = await text('apps/api/src/app.ts');
  const runtime = await text('apps/api/src/runtime.ts');
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

test('A21 exact runtime capability manifest adds only list_dashboard_merchant_contexts to API', async () => {
  const manifest = await json('ops/security/runtime-capabilities-v0.json');
  assert.equal(manifest.roles.swiftpay_api.expectedCount, 25);
  assert.equal(manifest.roles.swiftpay_worker.expectedCount, 6);
  assert.ok(manifest.roles.swiftpay_api.signatures.includes('app.list_dashboard_merchant_contexts(uuid)'));
  assert.equal(manifest.roles.swiftpay_api.signatures.length, 25);
  assert.equal(manifest.roles.swiftpay_worker.signatures.length, 6);
});

test('A21 dashboard web shell freezes visible login, context, list, detail and failure states', async () => {
  const app = await text('apps/dashboard/src/app.tsx');
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

test('A21 changes no provider bridge or browser financial mutation authority', async () => {
  const api = await text('apps/dashboard/src/api.ts');
  assert.doesNotMatch(api, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(api, /method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(api, /method:\s*['"]PUT['"]/);
  assert.doesNotMatch(api, /method:\s*['"]DELETE['"]/);
  assert.doesNotMatch(api, /\/v1\/transactions['"`]/);
});
