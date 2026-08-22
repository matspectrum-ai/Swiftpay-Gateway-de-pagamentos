import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

async function text(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

async function allMigrations() {
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  return (await Promise.all(names.map(async (name) => `${name}\n${await readFile(new URL(name, directory), 'utf8')}`))).join('\n');
}

test('A25 frozen artifacts keep runtime LOGIN bootstrap outside Supabase migrations', async () => {
  const [problem, spec, contract] = await Promise.all([
    text('docs/design/a25-hosted-runtime-identity-sandbox-e2e-problem-analysis.md'),
    text('docs/specs/hosted-runtime-identity-sandbox-e2e-v0.yaml'),
    text('docs/contracts/hosted-runtime-identity-sandbox-e2e-v0.md'),
  ]);

  assert.match(problem, /deployment concerns.*must not be committed in migrations/is);
  assert.match(spec, /artifact: ops\/sql\/bootstrap-hosted-runtime-identities\.sql/);
  assert.match(spec, /supabase_migration: forbidden/);
  assert.match(contract, /operational SQL, not migration history/i);
  assert.match(contract, /current_user = swiftpay_api_runtime/);
});

test('A25 provides one credentialless hosted-safe runtime identity bootstrap artifact', async () => {
  const bootstrap = await text('ops/sql/bootstrap-hosted-runtime-identities.sql');

  assert.match(bootstrap, /create role swiftpay_api_runtime\s+login\s+inherit/is);
  assert.match(bootstrap, /create role swiftpay_worker_runtime\s+login\s+inherit/is);
  assert.match(bootstrap, /nosuperuser/is);
  assert.match(bootstrap, /nocreatedb/is);
  assert.match(bootstrap, /nocreaterole/is);
  assert.match(bootstrap, /noreplication/is);
  assert.match(bootstrap, /nobypassrls/is);
  assert.match(bootstrap, /grant swiftpay_api to swiftpay_api_runtime/i);
  assert.match(bootstrap, /grant swiftpay_worker to swiftpay_worker_runtime/i);
  assert.match(bootstrap, /revoke swiftpay_worker from swiftpay_api_runtime/i);
  assert.match(bootstrap, /revoke swiftpay_api from swiftpay_worker_runtime/i);
  assert.match(bootstrap, /revoke all on schema app from swiftpay_api_runtime, swiftpay_worker_runtime/i);
  assert.match(bootstrap, /revoke all on all tables in schema app from swiftpay_api_runtime, swiftpay_worker_runtime/i);
  assert.match(bootstrap, /revoke all on all sequences in schema app from swiftpay_api_runtime, swiftpay_worker_runtime/i);
  assert.match(bootstrap, /revoke all on all routines in schema app from swiftpay_api_runtime, swiftpay_worker_runtime/i);

  assert.doesNotMatch(bootstrap, /local_api_runtime_only|local_worker_runtime_only/);
  assert.doesNotMatch(bootstrap, /password\s+['"]/i);
});

test('A25 K6 local provisioner reuses shared bootstrap while preserving fixed-loopback isolation', async () => {
  const local = await text('scripts/provision-local-runtime-identities');

  assert.match(local, /127\.0\.0\.1:54322/);
  assert.match(local, /ops\/sql\/bootstrap-hosted-runtime-identities\.sql/);
  assert.match(local, /local_api_runtime_only/);
  assert.match(local, /local_worker_runtime_only/);
  assert.doesNotMatch(local, /SUPABASE_DB_URL|DATABASE_URL|PROJECT_REF|project-ref/i);
});

test('A25 does not move deployment LOGIN identity creation into schema migration history', async () => {
  const migrations = await allMigrations();
  assert.doesNotMatch(migrations, /create\s+role\s+swiftpay_api_runtime/i);
  assert.doesNotMatch(migrations, /create\s+role\s+swiftpay_worker_runtime/i);
  assert.doesNotMatch(migrations, /alter\s+role\s+swiftpay_(?:api|worker)_runtime\s+password/i);
});
