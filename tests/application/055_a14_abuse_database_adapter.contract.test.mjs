import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const VALID_HASH = 'a'.repeat(64);

async function requireStoreFactory() {
  const db = await import('../../packages/db/dist/index.js');
  assert.equal(typeof db.createApiAbuseRateLimitStore, 'function');
  return db.createApiAbuseRateLimitStore;
}

test('A14 DB adapter still calls only the trusted quota routine with exact policy/active-hash order', async () => {
  const createApiAbuseRateLimitStore = await requireStoreFactory();
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ allowed: true, remaining: 29, retry_after_seconds: 0 }] };
    },
  };
  const store = createApiAbuseRateLimitStore(pool);
  const result = await store.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: VALID_HASH });
  assert.deepEqual(result, { allowed: true, remaining: 29, retryAfterSeconds: 0 });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /app\.consume_api_abuse_quota\(\$1::text,\s*\$2::text,\s*\$3::text\)/);
  assert.deepEqual(calls[0].params, ['token_exchange_pre_auth', VALID_HASH, null]);
  assert.doesNotMatch(calls[0].sql, /api_abuse_windows|insert\s+into|update\s+app\./i);
});

test('A14 DB adapter still rejects unknown policy and malformed active subject hash before PostgreSQL', async () => {
  const createApiAbuseRateLimitStore = await requireStoreFactory();
  let calls = 0;
  const store = createApiAbuseRateLimitStore({ query: async () => { calls += 1; return { rows: [] }; } });
  await assert.rejects(store.consume({ policy: 'attacker_policy', activeSubjectHash: VALID_HASH }));
  await assert.rejects(store.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: 'NOT_A_HASH' }));
  assert.equal(calls, 0);
});

test('A14 DB adapter still validates exact decision shape and sanitizes database failures', async () => {
  const createApiAbuseRateLimitStore = await requireStoreFactory();
  const malformedRows = [
    { allowed: true, remaining: 29, retry_after_seconds: 1 },
    { allowed: false, remaining: 1, retry_after_seconds: 17 },
    { allowed: false, remaining: 0, retry_after_seconds: 0 },
    { allowed: false, remaining: 0, retry_after_seconds: 61 },
    { allowed: true, remaining: -1, retry_after_seconds: 0 },
    { allowed: true, remaining: 29, retry_after_seconds: 0, extra: 'forbidden' },
  ];
  for (const row of malformedRows) {
    const store = createApiAbuseRateLimitStore({ query: async () => ({ rows: [row] }) });
    await assert.rejects(store.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: VALID_HASH }));
  }

  const canary = 'postgresql://user:super-secret@example/db';
  const failed = createApiAbuseRateLimitStore({ query: async () => { throw new Error(canary); } });
  await assert.rejects(
    failed.consume({ policy: 'token_exchange_pre_auth', activeSubjectHash: VALID_HASH }),
    (error) => {
      assert.doesNotMatch(String(error?.message), /super-secret|postgresql:\/\//i);
      assert.doesNotMatch(String(error?.stack), /super-secret|postgresql:\/\//i);
      return true;
    },
  );
});

test('A14 DB adapter source still contains no direct abuse-table DML or identity logging', async () => {
  const source = await readFile(new URL('../../packages/db/src/api-abuse-rate-limit.ts', import.meta.url), 'utf8');
  assert.match(source, /consume_api_abuse_quota/);
  assert.doesNotMatch(source, /insert\s+into\s+app\.api_abuse_windows/i);
  assert.doesNotMatch(source, /update\s+app\.api_abuse_windows/i);
  assert.doesNotMatch(source, /delete\s+from\s+app\.api_abuse_windows/i);
  assert.doesNotMatch(source, /console\.|activeSubjectHash.*log|previousSubjectHash.*log|clientIp/i);
});
