import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = path.join(ROOT, 'ops/security/runtime-capabilities-v0.json');
const SQL_PATH = path.join(ROOT, 'supabase/tests/runtime/002_exact_runtime_capability_allowlist.test.sql');

const API = Object.freeze([
  'app.claim_api_pix_attempt(uuid,text,uuid,uuid)',
  'app.consume_api_abuse_quota(text,text,text)',
  'app.consume_api_token_issuance(uuid)',
  'app.create_dashboard_api_credential(uuid,uuid,text,text,text,jsonb)',
  'app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)',
  'app.create_dashboard_webhook_endpoint(uuid,uuid,text,text,text,jsonb)',
  'app.disable_dashboard_payment_link(uuid,uuid,text,uuid,text,text,jsonb)',
  'app.disable_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)',
  'app.enable_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)',
  'app.get_api_balance(uuid,text)',
  'app.get_api_credential_auth_state(uuid)',
  'app.get_api_payment(uuid,text,uuid)',
  'app.get_dashboard_api_credential(uuid,uuid,text,uuid)',
  'app.get_dashboard_transaction(uuid,uuid,text,uuid)',
  'app.get_dashboard_webhook_endpoint(uuid,uuid,text,uuid)',
  'app.get_public_payment_link(text)',
  'app.list_dashboard_api_credentials(uuid,uuid,text)',
  'app.list_dashboard_merchant_contexts(uuid)',
  'app.list_dashboard_payment_links(uuid,uuid,text)',
  'app.list_dashboard_transactions(uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,integer)',
  'app.list_dashboard_webhook_endpoints(uuid,uuid,text)',
  'app.lookup_api_credential_for_token(text)',
  'app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)',
  'app.prepare_payment_link_pix_payment(text,text,text)',
  'app.require_dashboard_merchant_context(uuid,uuid,text,text)',
  'app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)',
  'app.revoke_dashboard_api_credential(uuid,uuid,text,uuid,text,text,jsonb)',
  'app.rotate_dashboard_api_credential_secret(uuid,uuid,text,uuid,text,text,jsonb)',
  'app.rotate_dashboard_webhook_endpoint_secret(uuid,uuid,text,uuid,text,text,jsonb)',
  'app.update_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)',
]);

const WORKER = Object.freeze([
  'app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamp with time zone)',
  'app.claim_jobs(text,integer,integer)',
  'app.claim_merchant_webhook_deliveries(text,integer,integer)',
  'app.complete_job(uuid,uuid)',
  'app.reschedule_job(uuid,uuid,text,text,integer)',
  'app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)',
]);

function assertSortedUnique(values) {
  assert.deepEqual(values, [...values].sort(), 'capability signatures must be lexically sorted');
  assert.equal(new Set(values).size, values.length, 'capability signatures must be unique');
}

async function loadManifest() {
  const raw = await readFile(MANIFEST_PATH, 'utf8');
  return { raw, manifest: JSON.parse(raw) };
}

function extractSqlManifest(sql) {
  const roles = { swiftpay_api: [], swiftpay_worker: [] };
  const pattern = /\('(swiftpay_api|swiftpay_worker)'\s*,\s*'(app\.[^']+)'\)/g;
  for (const match of sql.matchAll(pattern)) roles[match[1]].push(match[2]);
  return roles;
}

test('A20 canonical runtime capability manifest freezes exact API/worker signatures', async () => {
  const { manifest } = await loadManifest();
  assert.deepEqual(Object.keys(manifest).sort(), ['canonicalSchema', 'roles', 'schemaVersion']);
  assert.equal(manifest.schemaVersion, 'swiftpay-runtime-capabilities-v0');
  assert.equal(manifest.canonicalSchema, 'app');
  assert.deepEqual(Object.keys(manifest.roles).sort(), ['swiftpay_api', 'swiftpay_worker']);

  assert.equal(manifest.roles.swiftpay_api.expectedCount, 30);
  assert.equal(manifest.roles.swiftpay_worker.expectedCount, 6);
  assert.deepEqual(manifest.roles.swiftpay_api.signatures, API);
  assert.deepEqual(manifest.roles.swiftpay_worker.signatures, WORKER);
  assertSortedUnique(manifest.roles.swiftpay_api.signatures);
  assertSortedUnique(manifest.roles.swiftpay_worker.signatures);

  for (const signature of [...API, ...WORKER]) {
    assert.match(signature, /^app\.[a-z0-9_]+\([^)]*\)$/);
    assert.doesNotMatch(signature, /_[0-9]{4,}$|specific_name|oid/i);
  }
});

test('A20 runtime pgTAP mirrors the manifest and asserts exact nominal sets rather than counts alone', async () => {
  const [{ manifest }, sql] = await Promise.all([loadManifest(), readFile(SQL_PATH, 'utf8')]);

  assert.match(sql, /swiftpay_api/);
  assert.match(sql, /swiftpay_worker/);
  assert.match(sql, /regprocedure/);
  assert.match(sql, /array_agg/i);
  assert.match(sql, /order by/i);
  assert.match(sql, /prosecdef/i);
  assert.match(sql, /search_path/i);
  assert.match(sql, /anon/);
  assert.match(sql, /authenticated/);
  assert.match(sql, /service_role/);

  const sqlManifest = extractSqlManifest(sql);
  assert.deepEqual(sqlManifest.swiftpay_api, manifest.roles.swiftpay_api.signatures);
  assert.deepEqual(sqlManifest.swiftpay_worker, manifest.roles.swiftpay_worker.signatures);
  assert.doesNotMatch(sql, /specific_name\s*=|_[0-9]{4,}/i);
});

test('A20 existing database workflow already executes all runtime topology pgTAP files', async () => {
  const workflow = await readFile(path.join(ROOT, '.github/workflows/database-contracts.yml'), 'utf8');
  assert.match(workflow, /supabase test db supabase\/tests\/runtime/);
  assert.doesNotMatch(workflow, /002_exact_runtime_capability_allowlist\.test\.sql/);
});

test('A20 guardrail introduces no migration, provider, application or financial runtime authority', async () => {
  const [{ raw }, sql] = await Promise.all([loadManifest(), readFile(SQL_PATH, 'utf8')]);
  const combined = `${raw}\n${sql}`;
  assert.doesNotMatch(combined, /grant\s+execute|revoke\s+execute|create\s+function|alter\s+function/i);
  assert.doesNotMatch(combined, /ProviderAttempt|createPayment|post_ledger_transaction|retained-provider/i);
});
