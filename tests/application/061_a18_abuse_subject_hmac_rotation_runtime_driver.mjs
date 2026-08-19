import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as db from '../../packages/db/dist/index.js';

const DATABASE_URL = process.env.SWIFTPAY_API_DATABASE_URL;
const ADMIN_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function fail(message) {
  process.stderr.write(`A18_ACCEPTANCE_FAIL ${message}\n`);
  process.exit(1);
}
if (!DATABASE_URL) fail('SWIFTPAY_API_DATABASE_URL is required');
assert.equal(typeof db.createApiAbuseRateLimitStore, 'function');

const pool = db.createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'api' });
const store = db.createApiAbuseRateLimitStore(pool);
const HASH_1 = '1'.repeat(64);
const HASH_2 = '2'.repeat(64);
const HASH_3 = '3'.repeat(64);
const HASH_4 = '4'.repeat(64);

function adminScalar(sql) {
  return execFileSync('psql', [ADMIN_DB_URL, '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1', '--command', sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function admin(sql) {
  execFileSync('psql', [ADMIN_DB_URL, '--set', 'ON_ERROR_STOP=1', '--command', sql], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function legacyConsume(subjectHash) {
  const result = await pool.query(
    'select * from app.consume_api_abuse_quota($1::text, $2::text)',
    ['token_exchange_pre_auth', subjectHash],
  );
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    retryAfterSeconds: row.retry_after_seconds,
  };
}

try {
  admin('delete from app.api_abuse_windows;');

  const reversedDual = await Promise.all(Array.from({ length: 31 }, (_, index) => (
    index % 2 === 0
      ? store.consume({
          policy: 'token_exchange_pre_auth',
          activeSubjectHash: HASH_1,
          previousSubjectHash: HASH_2,
        })
      : store.consume({
          policy: 'token_exchange_pre_auth',
          activeSubjectHash: HASH_2,
          previousSubjectHash: HASH_1,
        })
  )));

  assert.equal(reversedDual.filter((result) => result.allowed).length, 30);
  assert.equal(reversedDual.filter((result) => !result.allowed).length, 1);
  assert.equal(
    adminScalar(`select min(request_count) from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash in ('${HASH_1}','${HASH_2}')`),
    '30',
  );
  assert.equal(
    adminScalar(`select max(request_count) from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash in ('${HASH_1}','${HASH_2}')`),
    '30',
  );
  assert.equal(
    adminScalar(`select count(distinct window_started_at) from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash in ('${HASH_1}','${HASH_2}')`),
    '1',
  );

  admin(`delete from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash in ('${HASH_3}','${HASH_4}');`);

  const mixed = await Promise.all(Array.from({ length: 31 }, (_, index) => (
    index % 2 === 0
      ? legacyConsume(HASH_3)
      : store.consume({
          policy: 'token_exchange_pre_auth',
          activeSubjectHash: HASH_4,
          previousSubjectHash: HASH_3,
        })
  )));

  assert.equal(mixed.filter((result) => result.allowed).length, 30);
  assert.equal(mixed.filter((result) => !result.allowed).length, 1);

  const reconciled = await store.consume({
    policy: 'token_exchange_pre_auth',
    activeSubjectHash: HASH_4,
    previousSubjectHash: HASH_3,
  });
  assert.equal(reconciled.allowed, false);
  assert.equal(reconciled.remaining, 0);
  assert.equal(reconciled.retryAfterSeconds >= 1 && reconciled.retryAfterSeconds <= 60, true);

  assert.equal(
    adminScalar(`select min(request_count) from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash in ('${HASH_3}','${HASH_4}')`),
    '30',
  );
  assert.equal(
    adminScalar(`select max(request_count) from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash in ('${HASH_3}','${HASH_4}')`),
    '30',
  );
  assert.equal(
    adminScalar(`select count(distinct window_started_at) from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash in ('${HASH_3}','${HASH_4}')`),
    '1',
  );

  assert.equal(
    adminScalar(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='consume_api_abuse_quota'`),
    '1',
  );
  assert.equal(
    adminScalar(`select pronargdefaults from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and p.proname='consume_api_abuse_quota'`),
    '1',
  );
  assert.equal(
    adminScalar(`select count(*) from information_schema.routine_privileges where routine_schema='app' and grantee='swiftpay_api' and privilege_type='EXECUTE'`),
    '24',
  );
  assert.equal(
    adminScalar(`select count(*) from information_schema.routine_privileges where routine_schema='app' and grantee='swiftpay_worker' and privilege_type='EXECUTE'`),
    '6',
  );
  assert.equal(
    adminScalar(`select has_function_privilege('swiftpay_api','app.consume_api_abuse_quota(text,text,text)','EXECUTE')`),
    't',
  );
  assert.equal(
    adminScalar(`select has_function_privilege('swiftpay_worker','app.consume_api_abuse_quota(text,text,text)','EXECUTE')`),
    'f',
  );

  process.stdout.write('A18_ACCEPTANCE_OK atomic abuse HMAC rotation concurrency\n');
} finally {
  try { admin('delete from app.api_abuse_windows;'); } catch {}
  await pool.end().catch(() => undefined);
}
