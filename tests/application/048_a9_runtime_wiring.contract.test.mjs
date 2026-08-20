import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [runtimeSource, indexSource, appSource, configSource] = await Promise.all([
  readFile(new URL('../../apps/api/src/runtime-base.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../apps/api/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../apps/api/src/app-base.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../packages/config/src/index.ts', import.meta.url), 'utf8'),
]);

test('A9/A16 config freezes dedicated dashboard cursor HMAC keyring authority with no access-token fallback', () => {
  assert.match(configSource, /SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID/);
  assert.match(configSource, /SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS/);
  assert.match(configSource, /SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY/);
  assert.doesNotMatch(configSource, /['"]SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY['"]/);
  assert.doesNotMatch(configSource, /dashboardCursorHmacKeys:\s*accessTokenSigningKeys/);
});

test('A9 API runtime composes A6 member auth, A9 store, cursor codec and read service', () => {
  assert.match(runtimeSource, /createDashboardTransactionStore/);
  assert.match(runtimeSource, /createDashboardTransactionCursorCodec/);
  assert.match(runtimeSource, /createDashboardTransactionReadService/);
  assert.match(runtimeSource, /sessionVerifier:\s*dashboardSessionVerifier/);
  assert.match(runtimeSource, /contextStore:\s*dashboardContextStore/);
  assert.match(runtimeSource, /dashboardTransactions/);
});

test('A9/A16 runtime injects the dedicated cursor keyring and production bootstrap forwards it', () => {
  assert.match(runtimeSource, /activeKeyId:\s*options\.dashboardCursorActiveKeyId/);
  assert.match(runtimeSource, /keys:\s*options\.dashboardCursorHmacKeys/);
  assert.match(runtimeSource, /legacyV0Key:\s*options\.dashboardCursorLegacyV0Key/);
  assert.match(indexSource, /dashboardCursorActiveKeyId:\s*config\.dashboardCursorActiveKeyId/);
  assert.match(indexSource, /dashboardCursorHmacKeys:\s*config\.dashboardCursorHmacKeys/);
  assert.match(indexSource, /dashboardCursorLegacyV0Key/);
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