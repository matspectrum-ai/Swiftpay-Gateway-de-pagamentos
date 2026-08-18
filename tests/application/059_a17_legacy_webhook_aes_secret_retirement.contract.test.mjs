import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const LEGACY_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const LEGACY_CIPHERTEXT = 'aes-256-gcm-v1$AAECAwQFBgcICQoL$MGqlfqa6oy_Scaa5gt1NW7TuvlWSGDsZXlfUty5dNYQ2KJedzaJ2_RI$JHRLQtcGf8jjgEcrEbBimQ';

function legacyClaim(format = 'aes-256-gcm-v1') {
  return {
    jobId: 'a1700000-0000-4000-8000-000000000001',
    deliveryId: 'a1700000-0000-4000-8000-000000000002',
    leaseToken: 'a1700000-0000-4000-8000-000000000003',
    attemptNumber: 1,
    maxAttempts: 8,
    leaseExpiresAt: '2030-01-01T00:00:30.000Z',
    endpoint: {
      id: 'b4200000-0000-0000-0000-000000000001',
      url: 'https://merchant.example/webhook',
      environment: 'sandbox',
      signingSecretVersion: 7,
      signingSecretCiphertext: LEGACY_CIPHERTEXT,
      ...(format === undefined ? {} : { signingSecretCiphertextFormat: format }),
      signingSecretWrappingKeyId: null,
    },
    event: {
      id: 'a1700000-0000-4000-8000-000000000004',
      type: 'payment.paid',
      occurredAt: '2030-01-01T00:00:00.000Z',
      payloadVersion: 'payment-v1',
      payload: { id: 'pay_a17_legacy', status: 'paid' },
    },
  };
}

async function runLegacyClaim(format = 'aes-256-gcm-v1') {
  const webhooks = await import('../../packages/webhooks/dist/index.js');
  const resolutions = [];
  let sends = 0;
  const service = webhooks.createWebhookDeliveryService({
    store: {
      claim: async () => [legacyClaim(format)],
      resolve: async (input) => { resolutions.push(input); return true; },
    },
    encryptionKey: LEGACY_KEY,
    privateKeyring: {},
    endpointPolicy: {
      resolveAndValidate: async (url) => ({ url, hostname: 'merchant.example', port: 443, pinnedAddress: '93.184.216.34' }),
    },
    transport: {
      send: async () => { sends += 1; return { status: 204, headers: {} }; },
    },
    clock: { nowUnixSeconds: () => 1_893_456_000 },
  });
  const result = await service.runBatch({ workerId: 'worker-a17-red', limit: 1, leaseSeconds: 30 });
  return { result, resolutions, sends };
}

test('A17 worker config removes the legacy AES environment authority and requires RSA private-keyring authority', async () => {
  const source = await readFile('packages/config/src/core.ts', 'utf8');
  assert.doesNotMatch(source, /SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY/);
  assert.doesNotMatch(source, /webhookSecretEncryptionKey|webhookEncryptionKey/);
  assert.match(source, /SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS/);
  assert.match(source, /parseWebhookWrappingPrivateKeyring/);
});

test('A17 worker runtime composition has no legacy AES option and requires the RSA private keyring', async () => {
  const runtime = await readFile('apps/worker/src/runtime.ts', 'utf8');
  const bootstrap = await readFile('apps/worker/src/index.ts', 'utf8');
  assert.doesNotMatch(runtime, /webhookEncryptionKey|encryptionKey:\s*options\.webhookEncryptionKey/);
  assert.doesNotMatch(bootstrap, /webhookSecretEncryptionKey|webhookEncryptionKey/);
  assert.match(runtime, /webhookPrivateKeyring/);
  assert.match(bootstrap, /webhookSecretWrapPrivateKeys/);
});

test('A17 production webhooks package no longer exports persisted-secret AES decrypt authority', async () => {
  const webhooks = await import('../../packages/webhooks/dist/index.js');
  assert.equal(webhooks.decodeWebhookEncryptionKey, undefined);
  assert.equal(webhooks.decryptWebhookSigningSecret, undefined);

  const indexSource = await readFile('packages/webhooks/src/index.ts', 'utf8');
  const legacySource = await readFile('packages/webhooks/src/legacy.ts', 'utf8');
  assert.doesNotMatch(indexSource, /export \* from ['"]\.\/legacy\.js['"]/);
  assert.doesNotMatch(legacySource, /createDecipheriv|aes-256-gcm|decryptWebhookSigningSecret|decodeWebhookEncryptionKey/);
});

test('A17 explicit AES claim material is terminal before endpoint policy or network transport', async () => {
  const outcome = await runLegacyClaim('aes-256-gcm-v1');
  assert.equal(outcome.sends, 0);
  assert.deepEqual(outcome.result, { claimed: 1, succeeded: 0, retried: 0, terminal: 1 });
  assert.equal(outcome.resolutions.length, 1);
  assert.equal(outcome.resolutions[0].outcome, 'terminal');
  assert.equal(outcome.resolutions[0].errorClass, 'configuration');
  assert.match(outcome.resolutions[0].errorCode, /^signing_secret_(unavailable|invalid)$/);
});

test('A17 missing ciphertext format never defaults to legacy AES', async () => {
  const outcome = await runLegacyClaim(undefined);
  assert.equal(outcome.sends, 0);
  assert.deepEqual(outcome.result, { claimed: 1, succeeded: 0, retried: 0, terminal: 1 });
  assert.equal(outcome.resolutions.length, 1);
  assert.equal(outcome.resolutions[0].outcome, 'terminal');
  assert.equal(outcome.resolutions[0].errorClass, 'configuration');
});

test('A17 A4 and A7 runtime acceptances no longer require the retired AES environment variable', async () => {
  const a4Shell = await readFile('tests/application/027_a4_real_runtime_acceptance.sh', 'utf8');
  const a4Driver = await readFile('tests/application/027_a4_real_runtime_driver.mjs', 'utf8');
  const a7Shell = await readFile('tests/application/042_a7_webhook_endpoint_management_runtime_acceptance.sh', 'utf8');
  const a7Driver = await readFile('tests/application/042_a7_webhook_endpoint_management_runtime_driver.mjs', 'utf8');

  for (const source of [a4Shell, a4Driver, a7Shell, a7Driver]) {
    assert.doesNotMatch(source, /SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY|LEGACY_ENCRYPTION_KEY|webhookEncryptionKey/);
  }
  assert.match(a4Shell, /SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS/);
  assert.match(a7Shell, /SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS/);
});

test('A17 keeps A14/A15/A16 and provider authority boundaries independent', async () => {
  const coreSource = await readFile('packages/config/src/core.ts', 'utf8');
  const a16ConfigSource = await readFile('packages/config/src/a16-api-config.ts', 'utf8');
  const providerSource = await readFile('packages/providers/src/activation.ts', 'utf8');
  assert.match(coreSource, /SWIFTPAY_ABUSE_HMAC_KEY/);
  assert.match(coreSource, /SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS/);
  assert.match(a16ConfigSource, /SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS/);
  assert.doesNotMatch(providerSource, /aes-256-gcm-v1|WEBHOOK_SECRET_ENCRYPTION_KEY/);
});