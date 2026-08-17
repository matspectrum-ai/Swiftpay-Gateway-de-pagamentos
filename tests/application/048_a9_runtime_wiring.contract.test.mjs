import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [runtimeSource, indexSource, appSource, configSource] = await Promise.all([
  readFile(new URL('../../apps/api/src/runtime.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../apps/api/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../apps/api/src/app.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../packages/config/src/index.ts', import.meta.url), 'utf8'),
]);

test('A9 config freezes a dedicated dashboard cursor HMAC key with no signing-key fallback', () => {
  assert.match(configSource, /SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY/);
  assert.match(configSource, /dashboardCursorHmacKey/);
  assert.doesNotMatch(configSource, /dashboardCursorHmacKey:\s*accessTokenSigningKey/);
});

test('A9 API runtime composes A6 member auth, A9 store, cursor codec and read service', () => {
  assert.match(runtimeSource, /createDashboardTransactionStore/);
  assert.match(runtimeSource, /createDashboardTransactionCursorCodec/);
  assert.match(runtimeSource, /createDashboardTransactionReadService/);
  assert.match(runtimeSource, /sessionVerifier:\s*dashboardSessionVerifier/);
  assert.match(runtimeSource, /contextStore:\s*dashboardContextStore/);
  assert.match(runtimeSource, /dashboardTransactions/);
});

test('A9 runtime injects the dedicated cursor key and production bootstrap forwards it', () => {
  assert.match(runtimeSource, /key:\s*options\.dashboardCursorHmacKey/);
  assert.match(indexSource, /dashboardCursorHmacKey:\s*config\.dashboardCursorHmacKey/);
  assert.match(appSource, /dashboardTransactions/);
  assert.match(indexSource, /buildApp\(services\)/);
});

test('A9 dashboard transaction realm has no machine bearer fallback or mutation handler', () => {
  assert.match(appSource, /dashboardTransactionBase/);
  assert.doesNotMatch(appSource, /dashboardTransactionBase[\s\S]{0,2200}authenticateBearerRequest/);
  assert.doesNotMatch(appSource, /app\.post\(`\$\{dashboardTransactionBase\}/);
  assert.doesNotMatch(appSource, /app\.patch\(`\$\{dashboardTransactionBase\}/);
  assert.doesNotMatch(appSource, /app\.delete\(`\$\{dashboardTransactionBase\}/);
});
