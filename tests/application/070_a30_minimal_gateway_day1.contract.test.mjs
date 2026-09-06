import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('A30 freezes problem analysis, spec, contract and canonical public OpenAPI', async () => {
  const [problem, spec, contract, openapi] = await Promise.all([
    text('docs/design/a30-minimal-gateway-day1-problem-analysis.md'),
    text('docs/specs/minimal-gateway-day1-v0.yaml'),
    text('docs/contracts/minimal-gateway-day1-v0.md'),
    text('openapi/swiftpay-v1.yaml'),
  ]);

  assert.match(problem, /smallest merchant-usable Pix gateway/i);
  assert.match(spec, /status:\s*frozen/i);
  assert.match(contract, /ledger remains the financial authority/i);
  assert.match(openapi, /^openapi:\s*3\.1\.0/m);

  for (const route of [
    '/v1/auth/token',
    '/v1/transactions',
    '/v1/balance',
    '/v1/accounts',
    '/v1/accounts/{id}/statement',
    '/v1/payouts',
    '/v1/payouts/{id}',
    '/v1/customers',
    '/v1/customers/{id}',
  ]) assert.match(openapi, new RegExp(route.replace(/[{}]/g, '\\$&')));

  assert.match(openapi, /Idempotency-Key/);
  assert.match(openapi, /integer centavos/i);
  assert.match(openapi, /execution_unknown/);
  assert.doesNotMatch(openapi, /service_role_key|sb_secret_[A-Za-z0-9_-]{8,}|sk_live_/i);
});

test('A30 registers account, payout and customer surfaces behind machine authentication', async () => {
  const source = `${await text('apps/api/src/app-base.ts')}\n${await text('apps/api/src/app.ts')}`;

  for (const route of [
    '/v1/accounts',
    '/v1/accounts/:id/statement',
    '/v1/payouts',
    '/v1/payouts/:id',
    '/v1/customers',
    '/v1/customers/:id',
  ]) {
    assert.match(source, new RegExp(route.replace(/[/:]/g, (m) => `\\${m}`)), `missing A30 route ${route}`);
  }

  assert.match(source, /authenticateGatewayRequest/);
  assert.match(source, /admitA14MachineRequest/);
  assert.match(source, /idempotency-key/i);
});

test('A30 organization and customer persistence is merchant-owned and server-private', async () => {
  const migration = await text('supabase/migrations/20260905000000_a30_organizations_customers.sql');

  assert.match(migration, /create table app\.organizations/i);
  assert.match(migration, /merchant_id uuid not null references app\.merchants/i);
  assert.match(migration, /create table app\.customers/i);
  assert.match(migration, /foreign key \(organization_id, merchant_id\)/i);
  assert.match(migration, /revoke all on app\.organizations, app\.customers, app\.customer_mutation_idempotency\s+from anon, authenticated, service_role/i);
  assert.match(migration, /organizations_merchant_slug_uq unique \(merchant_id, slug\)/i);
  assert.match(migration, /grant execute on function app\.create_api_customer[\s\S]*to swiftpay_api/i);
});

test('A30 keeps payout creation on the canonical reservation primitive and Production fail-closed', async () => {
  const [migration, service] = await Promise.all([
    text('supabase/migrations/20260905000000_a30_organizations_customers.sql'),
    text('apps/api/src/a30-gateway-resources.ts'),
  ]);
  assert.match(migration, /v_payout_id := app\.reserve_payout\(/i);
  assert.match(migration, /if p_environment <> 'sandbox'/i);
  assert.match(service, /principal\.environment !== 'sandbox'/);
  assert.match(service, /requestFingerprint: fingerprint\('payout\.create'/);
});

test('A30 runtime wires the private gateway resource store without direct browser table authority', async () => {
  const [runtime, store] = await Promise.all([
    text('apps/api/src/runtime.ts'),
    text('packages/db/src/gateway-resources.ts'),
  ]);
  assert.match(runtime, /createGatewayResourceStore/);
  assert.match(runtime, /createA30GatewayResourcesService/);
  assert.match(store, /select app\.create_api_sandbox_payout/);
  assert.match(store, /select app\.create_api_customer/);
});

test('A30 no public/admin route introduces direct balance mutation authority', async () => {
  const source = `${await text('apps/api/src/app-base.ts')}\n${await text('apps/api/src/app.ts')}`;
  assert.doesNotMatch(source, /(?:post|patch|put)\(['"]\/v1\/(?:balance|accounts)\/[^'"]*(?:credit|debit|set|adjust)/i);
  assert.doesNotMatch(source, /setBalance|creditBalance|debitBalance/);
});
