import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [runtimeSource, indexSource, appSource] = await Promise.all([
  readFile(new URL('../../apps/api/src/runtime.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../apps/api/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../apps/api/src/app.ts', import.meta.url), 'utf8'),
]);

test('A8 API runtime composes ordinary and privileged dashboard auth with the credential store', () => {
  assert.match(runtimeSource, /createSupabaseDashboardSessionVerifier/);
  assert.match(runtimeSource, /createPrivilegedDashboardSessionVerifier/);
  assert.match(runtimeSource, /createDashboardMerchantContextStore/);
  assert.match(runtimeSource, /createDashboardApiCredentialStore/);
  assert.match(runtimeSource, /createDashboardApiCredentialManagementService/);
  assert.match(runtimeSource, /dashboardApiCredentials/);
});

test('A8 runtime passes the same Supabase project boundary to privileged verification without service-role authority', () => {
  assert.match(runtimeSource, /projectUrl:\s*options\.supabaseUrl/);
  assert.match(runtimeSource, /publishableKey:\s*options\.supabasePublishableKey/);
  assert.doesNotMatch(runtimeSource, /service[_-]?role/i);
  assert.doesNotMatch(runtimeSource, /sb_secret_/i);
  assert.doesNotMatch(runtimeSource, /jwt[_-]?secret/i);
});

test('A8 production bootstrap forwards composed dashboard credential management into Fastify', () => {
  assert.match(indexSource, /dashboardApiCredentials:\s*services\.dashboardApiCredentials/);
  assert.match(appSource, /dashboardApiCredentials/);
  assert.match(appSource, /api-credentials/);
});

test('A8 dashboard credential realm remains separate from A1 machine bearer authentication', () => {
  assert.match(appSource, /\/dashboard\/v1\/merchants/);
  assert.match(appSource, /api-credentials/);
  assert.doesNotMatch(appSource, /dashboardCredentialBase[\s\S]{0,1200}authenticateBearerRequest/);
});
