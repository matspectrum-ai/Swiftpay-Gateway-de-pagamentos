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

test('A30 RED: public API registers account, payout and customer surfaces behind machine authentication', async () => {
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

  assert.match(source, /authenticatePaymentRequest/);
  assert.match(source, /idempotency-key/i);
});

test('A30 RED: organization and customer persistence is merchant-owned and server-private', async () => {
  let migration;
  try {
    migration = await text('supabase/migrations/20260905000000_a30_organizations_customers.sql');
  } catch (error) {
    assert.fail(`A30 organization/customer migration missing: ${error?.code ?? error}`);
  }

  assert.match(migration, /create table app\.organizations/i);
  assert.match(migration, /merchant_id uuid not null references app\.merchants/i);
  assert.match(migration, /create table app\.customers/i);
  assert.match(migration, /organization_id uuid/i);
  assert.match(migration, /revoke all on app\.organizations, app\.customers from anon, authenticated, service_role/i);
  assert.match(migration, /unique.*merchant_id.*slug/is);
});

test('A30 RED: no public/admin route introduces direct balance mutation authority', async () => {
  const source = `${await text('apps/api/src/app-base.ts')}\n${await text('apps/api/src/app.ts')}`;
  assert.doesNotMatch(source, /(?:post|patch|put)\(['"]\/v1\/(?:balance|accounts)\/[^'"]*(?:credit|debit|set|adjust)/i);
  assert.doesNotMatch(source, /setBalance|creditBalance|debitBalance/);
});
