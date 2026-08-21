import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FIXTURE_PATH = 'tests/application/fixtures/a1_token_exchange.sql';

async function fixtureSql() {
  return readFile(FIXTURE_PATH, 'utf8');
}

test('A1 real runtime fixture persists only a supplied scrypt verifier, never plaintext Secret Key', async () => {
  const sql = await fixtureSql();

  assert.match(sql, /insert into app\.api_credentials/i);
  assert.match(sql, /:'a1_secret_verifier'/);
  assert.doesNotMatch(sql, /secretKey/i);
  assert.doesNotMatch(sql, /swiftpay-local-a1-secret/i);
});

test('A1 real runtime fixture defines active, IP-denied, revoked and inactive-merchant credential states', async () => {
  const sql = await fixtureSql();

  for (const publicKey of [
    'pk_a1_runtime_active',
    'pk_a1_runtime_ip_denied',
    'pk_a1_runtime_revoked',
    'pk_a1_runtime_inactive_merchant',
  ]) {
    assert.match(sql, new RegExp(publicKey));
  }

  assert.match(sql, /'sandbox'/);
  assert.match(sql, /'active'/);
  assert.match(sql, /'revoked'/);
  assert.match(sql, /'suspended'/);
  assert.match(sql, /127\.0\.0\.1/);
  assert.match(sql, /192\.0\.2\.10/);
});
