import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function text(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

async function json(path) {
  return JSON.parse(await text(path));
}

test('A22 frozen spec and contract preserve application-only A7/A8 composition', async () => {
  const spec = await text('docs/specs/merchant-dashboard-integration-settings-ui-v0.yaml');
  const contract = await text('docs/contracts/merchant-dashboard-integration-settings-ui-v0.md');

  assert.match(spec, /backend_changes: forbidden/);
  assert.match(spec, /database_changes: forbidden/);
  assert.match(spec, /new_runtime_capabilities: forbidden/);
  assert.match(spec, /mutation_idempotency_key_reused_across_refresh_retry: required/);
  assert.match(contract, /Autenticação adicional necessária/);
  assert.match(contract, /same.*key MUST be reused/i);
  assert.match(contract, /no A22 Supabase migration/i);
});

test('A22 activates API Credentials and Webhooks navigation with stable browser routes', async () => {
  const app = await text('apps/dashboard/src/app.tsx');

  assert.match(app, /\/settings\/api-credentials/);
  assert.match(app, /\/settings\/webhooks/);
  assert.match(app, />Credenciais API</);
  assert.match(app, />Webhooks</);
  assert.doesNotMatch(app, /Credenciais API\s*<small>em breve<\/small>/);
  assert.doesNotMatch(app, /Webhooks\s*<small>em breve<\/small>/);
});

test('A22 browser API client exposes the exact A8 credential read and mutation surface', async () => {
  const api = await text('apps/dashboard/src/api.ts');

  for (const exportName of [
    'listApiCredentials',
    'createApiCredential',
    'rotateApiCredentialSecret',
    'revokeApiCredential',
  ]) {
    assert.match(api, new RegExp(`export async function ${exportName}\\b`));
  }
  assert.match(api, /\/api-credentials/);
  assert.match(api, /\/rotate-secret/);
  assert.match(api, /\/revoke/);
  for (const field of ['publicKey', 'secretVersion', 'revision', 'ipAllowlist', 'lastUsedAt']) {
    assert.match(api, new RegExp(field));
  }
});

test('A22 browser API client exposes the exact A7 webhook read and mutation surface', async () => {
  const api = await text('apps/dashboard/src/api.ts');

  for (const exportName of [
    'listWebhookEndpoints',
    'createWebhookEndpoint',
    'updateWebhookEndpoint',
    'disableWebhookEndpoint',
    'enableWebhookEndpoint',
    'rotateWebhookEndpointSecret',
  ]) {
    assert.match(api, new RegExp(`export async function ${exportName}\\b`));
  }
  assert.match(api, /\/webhook-endpoints/);
  assert.match(api, /payment\.paid/);
  assert.match(api, /method:\s*['"]PATCH['"]/);
});

test('A22 mutations send JSON plus exact Idempotency-Key and expose sanitized step-up/conflict categories', async () => {
  const api = await text('apps/dashboard/src/api.ts');

  assert.match(api, /['"]Idempotency-Key['"]/);
  assert.match(api, /['"]Content-Type['"]\s*:\s*['"]application\/json['"]/);
  assert.match(api, /JSON\.stringify/);
  assert.match(api, /step_up/);
  assert.match(api, /step_up_required/);
  assert.match(api, /conflict/);
  assert.match(api, /validation/);
  assert.doesNotMatch(api, /throw new Error\([^)]*(?:response|body|message)/i);
});

test('A22 settings flow freezes one idempotency key per mutation across the existing one-session refresh retry', async () => {
  const app = await text('apps/dashboard/src/app.tsx');
  const api = await text('apps/dashboard/src/api.ts');
  const source = `${app}\n${api}`;

  assert.match(source, /crypto\.randomUUID\s*\(/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /withSessionRetry/);
  assert.match(source, /Idempotency-Key/);
  assert.doesNotMatch(source, /refreshSession\([^)]*\)[\s\S]{0,500}crypto\.randomUUID\s*\(/);
});

test('A22 one-time credential and webhook secrets are explicit ephemeral reveal state only', async () => {
  const app = await text('apps/dashboard/src/app.tsx');
  const api = await text('apps/dashboard/src/api.ts');
  const source = `${app}\n${api}`;

  assert.match(source, /secretKey/);
  assert.match(source, /signingSecret/);
  assert.match(source, /secretAvailable/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /Copiar/);
  assert.doesNotMatch(api, /localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:secretKey|signingSecret)/i);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*(?:secretKey|signingSecret)/i);
});

test('A22 role-aware presentation names A8/A7 mutation boundaries without becoming authority', async () => {
  const app = await text('apps/dashboard/src/app.tsx');

  assert.match(app, /canMutateApiCredentials/);
  assert.match(app, /canMutateWebhooks/);
  assert.match(app, /membershipRole/);
  assert.match(app, /Somente leitura/);
  assert.match(app, /Autenticação adicional necessária/);
  assert.doesNotMatch(app, /atob\s*\(|decode.*jwt|parse.*jwt/i);
});

test('A22 webhook UI preserves payment.paid-only and disabled-before-URL-edit UX', async () => {
  const app = await text('apps/dashboard/src/app.tsx');

  assert.match(app, /payment\.paid/);
  assert.match(app, /endpoint\.status\s*===\s*['"]disabled['"]/);
  assert.match(app, /Desativar/);
  assert.match(app, /Ativar/);
  assert.match(app, /Rotacionar segredo/);
  assert.doesNotMatch(app, /test webhook|redeliver|redelivery/i);
});

test('A22 introduces no database capability or migration and preserves 25/6 manifest', async () => {
  const manifest = await json('ops/security/runtime-capabilities-v0.json');
  assert.equal(manifest.roles.swiftpay_api.expectedCount, 25);
  assert.equal(manifest.roles.swiftpay_worker.expectedCount, 6);
  assert.equal(manifest.roles.swiftpay_api.signatures.length, 25);
  assert.equal(manifest.roles.swiftpay_worker.signatures.length, 6);

  const migrations = await readdir(new URL('../../supabase/migrations/', import.meta.url));
  assert.equal(migrations.some((name) => /a22|integration_settings|settings_ui/i.test(name)), false);
});

test('A22 browser still has no provider or financial mutation authority', async () => {
  const source = (await Promise.all([
    text('apps/dashboard/src/app.tsx'),
    text('apps/dashboard/src/api.ts'),
    text('apps/dashboard/src/auth.ts'),
  ])).join('\n');

  assert.doesNotMatch(source, /\.from\s*\(|\.rpc\s*\(/);
  assert.doesNotMatch(source, /service[_-]?role|DATABASE_URL|swiftpay_api|swiftpay_worker/i);
  assert.doesNotMatch(source, /akkad|akadpay|flevopay|provider[_-]?secret/i);
  assert.doesNotMatch(source, /\/v1\/(?:payments|pix|refunds|payouts|balance)(?:\b|\/)/i);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});
