import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const [payments, db, apiModule, providers] = await Promise.all([
  import('../../packages/payments/dist/index.js'),
  import('../../packages/db/dist/index.js'),
  import('../../apps/api/dist/app.js'),
  import('../../packages/providers/dist/index.js'),
]);

async function text(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

async function json(path) {
  return JSON.parse(await text(path));
}

async function allMigrations() {
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  return (await Promise.all(names.map(async (name) => `${name}\n${await readFile(new URL(name, directory), 'utf8')}`))).join('\n');
}

test('A23 frozen problem/spec/contract define a Sandbox-only payment_link checkout origin', async () => {
  const [problem, spec, contract] = await Promise.all([
    text('docs/design/a23-hosted-pix-checkout-payment-links-problem-analysis.md'),
    text('docs/specs/hosted-pix-checkout-payment-links-v0.yaml'),
    text('docs/contracts/hosted-pix-checkout-payment-links-v0.md'),
  ]);
  assert.match(problem, /source='payment_link'/);
  assert.match(problem, /must \*\*not\*\* call `prepare_api_pix_payment`/);
  assert.match(spec, /source: payment_link/);
  assert.match(spec, /production checkout/i);
  assert.match(contract, /apps\/checkout/);
  assert.match(contract, /exactly 30 API \/ 6 worker/);
});

test('A23 database migration creates only the frozen payment_links table and trusted routine surface', async () => {
  const migrations = await allMigrations();
  assert.match(migrations, /create table app\.payment_links/i);
  for (const signature of [
    'list_dashboard_payment_links',
    'create_dashboard_payment_link',
    'disable_dashboard_payment_link',
    'get_public_payment_link',
    'prepare_payment_link_pix_payment',
  ]) {
    assert.match(migrations, new RegExp(`create(?: or replace)? function app\\.${signature}\\b`, 'i'), signature);
  }
  assert.match(migrations, /source_resource_id/i);
  assert.match(migrations, /'payment_link'/);
});

test('A23 exact runtime capability manifest expands API from 25 to 30 and leaves worker at 6', async () => {
  const manifest = await json('ops/security/runtime-capabilities-v0.json');
  assert.equal(manifest.roles.swiftpay_api.expectedCount, 30);
  assert.equal(manifest.roles.swiftpay_worker.expectedCount, 6);
  for (const signature of [
    'app.list_dashboard_payment_links(uuid,uuid,text)',
    'app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)',
    'app.disable_dashboard_payment_link(uuid,uuid,text,uuid,text,text,jsonb)',
    'app.get_public_payment_link(text)',
    'app.prepare_payment_link_pix_payment(text,text,text)',
  ]) {
    assert.ok(manifest.roles.swiftpay_api.signatures.includes(signature), signature);
  }
  assert.equal(manifest.roles.swiftpay_api.signatures.length, 30);
  assert.equal(manifest.roles.swiftpay_worker.signatures.length, 6);
});

test('A23 abuse controls add checkout_request_pre_auth through the existing A14/A18 distributed boundary', async () => {
  const [abuse, admission] = await Promise.all([
    text('packages/abuse/src/index.ts'),
    text('apps/api/src/a14-admission.ts'),
  ]);
  assert.match(abuse, /checkout_request_pre_auth/);
  assert.match(abuse, /checkout_request_pre_auth:\s*120/);
  assert.match(admission, /\/checkout\/v1\//);
  assert.match(admission, /checkout_request_pre_auth/);
});

test('A23 payments package exposes a separate hosted-checkout service instead of weakening A2 machine creation', async () => {
  assert.equal(typeof payments.generatePaymentLinkPublicToken, 'function');
  assert.equal(typeof payments.createHostedCheckoutService, 'function');
  assert.equal(typeof payments.createDashboardPaymentLinksService, 'function');

  const core = await text('packages/payments/src/core.ts');
  assert.match(core, /createPixPaymentService/);
  assert.doesNotMatch(core, /source:\s*['"]payment_link['"]/);
});

test('A23 database package exposes payment-link stores while retaining existing A2 pix store', async () => {
  assert.equal(typeof db.createDashboardPaymentLinkStore, 'function');
  assert.equal(typeof db.createHostedCheckoutStore, 'function');
  assert.equal(typeof db.createRuntimePixPaymentStore, 'function');
});

test('A23 Fastify composition exposes dashboard payment-link and anonymous checkout routes with no auth fallback', async () => {
  const appSource = await text('apps/api/src/app.ts');
  const runtime = await text('apps/api/src/runtime.ts');
  assert.match(appSource, /dashboardPaymentLinks/);
  assert.match(appSource, /hostedCheckout/);
  assert.match(appSource, /\/dashboard\/v1\/merchants\/:merchantId\/environments\/:environment\/payment-links/);
  assert.match(appSource, /\/checkout\/v1\/payment-links\/:publicToken/);
  assert.match(appSource, /\/checkout\/v1\/payment-links\/:publicToken\/payments/);
  assert.match(runtime, /createHostedCheckoutService/);
  assert.match(runtime, /createDashboardPaymentLinksService/);

  const app = apiModule.buildApp({
    readinessProbe: async () => {},
    hostedCheckout: {
      getLink: async () => ({ kind: 'not_found' }),
      createPayment: async () => ({ kind: 'not_found' }),
    },
  });
  const response = await app.inject({ method: 'GET', url: '/checkout/v1/payment-links/plink_sandbox_missing' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.json().error.code, 'checkout_not_found');
  await app.close();
});

test('A23 merchant dashboard exposes Links de pagamento management without pretending Production is enabled', async () => {
  const [app, api] = await Promise.all([
    text('apps/dashboard/src/app.tsx'),
    text('apps/dashboard/src/api.ts'),
  ]);
  assert.match(app, /Links de pagamento/);
  assert.match(app, /\/payment-links/);
  assert.match(app, /Produção.*indisponível|indisponível.*Produção/is);
  assert.match(app, /Copiar link/);
  assert.match(app, /Desativar/);
  assert.match(api, /listPaymentLinks/);
  assert.match(api, /createPaymentLink/);
  assert.match(api, /disablePaymentLink/);
});

test('A23 separate checkout SPA is anonymous same-origin API-only and visibly non-payable', async () => {
  const paths = [
    'apps/checkout/package.json',
    'apps/checkout/index.html',
    'apps/checkout/vite.config.ts',
    'apps/checkout/tsconfig.json',
    'apps/checkout/src/main.tsx',
    'apps/checkout/src/app.tsx',
    'apps/checkout/src/api.ts',
    'apps/checkout/src/styles.css',
  ];
  const source = (await Promise.all(paths.map((path) => text(path)))).join('\n');
  assert.match(source, /Gerar Pix de teste/);
  assert.match(source, /Ambiente de teste|Sandbox/);
  assert.match(source, /\/api\/checkout\/v1\/payment-links/);
  assert.match(source, /Idempotency-Key/);
  assert.doesNotMatch(source, /@supabase\/supabase-js|createClient|\.from\s*\(|\.rpc\s*\(/);
  assert.doesNotMatch(source, /service[_-]?role|DATABASE_URL|swiftpay_api|swiftpay_worker/i);
  assert.doesNotMatch(source, /akkad|akadpay|flevopay|provider[_-]?secret/i);
});

test('A23 preserves zero retained-provider authority and machine A2 source semantics', async () => {
  const [manifest, a2Migration, checkoutSpec] = await Promise.all([
    json('ops/security/runtime-capabilities-v0.json'),
    text('supabase/migrations/20260815101609_pix_create_get_emulator_behavior.sql'),
    text('docs/specs/hosted-pix-checkout-payment-links-v0.yaml'),
  ]);
  assert.match(a2Migration, /'api'/);
  assert.match(a2Migration, /prepare_api_pix_payment/);
  assert.match(checkoutSpec, /prepare_api_pix_payment_reuse: forbidden/);
  assert.equal(manifest.roles.swiftpay_worker.expectedCount, 6);
  assert.ok(Array.isArray(providers.DEFAULT_PROVIDER_ACTIVATION_REGISTRY.records));
  const liveAuthority = providers.DEFAULT_PROVIDER_ACTIVATION_REGISTRY.records.filter(
    (record) => record.state === 'sandbox_proven' || record.state === 'production_enabled',
  );
  assert.equal(liveAuthority.length, 0);
});
