import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as db from '../../packages/db/dist/index.js';

const DATABASE_URL = process.env.SWIFTPAY_API_DATABASE_URL;
const ADMIN_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function fail(message) {
  process.stderr.write(`A14_ACCEPTANCE_FAIL ${message}\n`);
  process.exit(1);
}
if (!DATABASE_URL) fail('SWIFTPAY_API_DATABASE_URL is required');
assert.equal(typeof db.createApiAbuseRateLimitStore, 'function');

const pool = db.createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'api' });
const store = db.createApiAbuseRateLimitStore(pool);
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

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

try {
  admin(`delete from app.api_abuse_windows;`);

  for (let i = 0; i < 30; i += 1) {
    const result = await store.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: HASH_A });
    assert.equal(result.allowed, true, `token attempt ${i + 1}`);
    assert.equal(result.remaining, 29 - i, `remaining ${i + 1}`);
    assert.equal(result.retryAfterSeconds, 0);
  }
  const denied = await store.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: HASH_A });
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(Number.isInteger(denied.retryAfterSeconds), true);
  assert.equal(denied.retryAfterSeconds >= 1 && denied.retryAfterSeconds <= 60, true);
  assert.equal(adminScalar(`select request_count from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash='${HASH_A}'`), '30');

  const isolatedPolicy = await store.consume({ policy: 'readiness_probe', activeSubjectHash: HASH_A });
  assert.deepEqual(isolatedPolicy, { allowed: true, remaining: 119, retryAfterSeconds: 0 });
  const isolatedSubject = await store.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: HASH_B });
  assert.deepEqual(isolatedSubject, { allowed: true, remaining: 29, retryAfterSeconds: 0 });

  admin(`update app.api_abuse_windows set window_started_at = clock_timestamp() - interval '61 seconds' where policy='token_exchange_pre_auth' and subject_hash='${HASH_A}';`);
  const reset = await store.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: HASH_A });
  assert.deepEqual(reset, { allowed: true, remaining: 29, retryAfterSeconds: 0 });
  assert.equal(adminScalar(`select request_count from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash='${HASH_A}'`), '1');

  const raced = await Promise.all(Array.from({ length: 31 }, () =>
    store.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: HASH_C })));
  assert.equal(raced.filter((result) => result.allowed).length, 30);
  assert.equal(raced.filter((result) => !result.allowed).length, 1);
  assert.equal(adminScalar(`select request_count from app.api_abuse_windows where policy='token_exchange_pre_auth' and subject_hash='${HASH_C}'`), '30');

  admin(`
    insert into app.api_abuse_windows(policy,subject_hash,window_started_at,request_count,updated_at)
    select 'readiness_probe', md5('a14-stale-' || g::text) || md5('a14-stale-b-' || g::text),
           clock_timestamp() - interval '2 days', 1, clock_timestamp() - interval '2 days'
    from generate_series(1,40) g;
  `);
  const pruneTrigger = await store.consume({ policy: 'readiness_probe', activeSubjectHash: HASH_D });
  assert.deepEqual(pruneTrigger, { allowed: true, remaining: 119, retryAfterSeconds: 0 });
  const staleRemaining = Number(adminScalar(`select count(*) from app.api_abuse_windows where updated_at < clock_timestamp() - interval '24 hours'`));
  assert.equal(staleRemaining, 8, 'one consume prunes exactly at most 32 of 40 stale rows');

  assert.equal(adminScalar(`select has_function_privilege('swiftpay_api','app.consume_api_abuse_quota(text,text,text)','EXECUTE')`), 't');
  assert.equal(adminScalar(`select has_function_privilege('swiftpay_worker','app.consume_api_abuse_quota(text,text,text)','EXECUTE')`), 'f');

  process.stdout.write('A14_ACCEPTANCE_OK distributed fixed-window abuse behavior\n');
} finally {
  try { admin(`delete from app.api_abuse_windows;`); } catch {}
  await pool.end().catch(() => undefined);
}
