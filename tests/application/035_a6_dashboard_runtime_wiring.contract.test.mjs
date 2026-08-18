import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [configCoreSource, configA16Source, runtimeSource, appSource, authSource, dbIndexSource, dbCoreSource] = await Promise.all([
  readFile(new URL('../../packages/config/src/core.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../packages/config/src/a16-api-config.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../apps/api/src/runtime.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../apps/api/src/app.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../packages/auth/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../packages/db/src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../packages/db/src/core.ts', import.meta.url), 'utf8'),
]);
const configSource = `${configCoreSource}\n${configA16Source}`;
const dbSource = `${dbIndexSource}\n${dbCoreSource}`;

test('A6 API config requires only Supabase project URL and modern publishable key for dashboard authentication', () => {
  assert.match(configSource, /SWIFTPAY_SUPABASE_URL/);
  assert.match(configSource, /SWIFTPAY_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(configSource, /sb_publishable_/);
  assert.match(configSource, /supabaseUrl/);
  assert.match(configSource, /supabasePublishableKey/);
});

test('A6 dashboard verification configuration does not introduce service-role secret or JWT-secret authority', () => {
  const dashboardConfigRegion = configSource.match(/interface ApiConfig[\s\S]*?interface WorkerConfig/)?.[0] ?? configSource;
  assert.doesNotMatch(dashboardConfigRegion, /service[_-]?role/i);
  assert.doesNotMatch(dashboardConfigRegion, /sb_secret_/i);
  assert.doesNotMatch(dashboardConfigRegion, /jwt[_-]?secret/i);
  assert.doesNotMatch(dashboardConfigRegion, /supabaseSecret/i);
});

test('A6 auth and db packages expose the frozen dashboard boundary factories', () => {
  assert.match(authSource, /export\s+(?:function|const)\s+createSupabaseDashboardSessionVerifier/);
  assert.match(authSource, /export\s+(?:function|const)\s+createDashboardAuthorizationService/);
  assert.match(dbSource, /createDashboardMerchantContextStore/);
});

test('A6 API runtime composes Supabase session verifier with K4 dashboard context store', () => {
  assert.match(runtimeSource, /createSupabaseDashboardSessionVerifier/);
  assert.match(runtimeSource, /createDashboardMerchantContextStore/);
  assert.match(runtimeSource, /createDashboardAuthorizationService/);
  assert.match(runtimeSource, /dashboardAuthorization/);
});

test('A6 preserves the A1 machine authenticator as a separate runtime capability', () => {
  assert.match(runtimeSource, /authenticateAccessToken/);
  assert.match(runtimeSource, /authenticateBearer/);
  assert.doesNotMatch(runtimeSource, /authenticateAccessToken[\s\S]{0,400}createSupabaseDashboardSessionVerifier[\s\S]{0,400}(fallback|catch)/i);
});

test('A6 dashboard authentication boundary is reused by later dashboard resources rather than machine auth', () => {
  assert.match(appSource, /dashboardWebhookEndpoints/);
  assert.match(appSource, /\/dashboard\/v1\/merchants/);
  assert.doesNotMatch(appSource, /dashboardWebhookEndpoints[\s\S]{0,500}authenticateBearerRequest/i);
});

test('A6 keeps machine and dashboard route realms explicitly separate in application source', () => {
  assert.match(appSource, /\/v1\/auth\/token/);
  assert.match(appSource, /\/v1\/transactions/);
  assert.doesNotMatch(appSource, /dashboard[\s\S]{0,300}authenticateBearerRequest/i);
});
