import assert from 'node:assert/strict';
import { generateKeyPairSync, publicEncrypt, constants } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [webhooks, workerRuntime] = await Promise.all([
  import('../../packages/webhooks/dist/index.js'),
  import('../../apps/worker/dist/runtime.js'),
]);

const endpointId = 'b5300000-0000-0000-0000-000000000001';

function base64UrlKeyFixture() {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKey: pair.publicKey.toString('base64url'),
    privateKey: pair.privateKey.toString('base64url'),
  };
}

function rsaFixture(secret, version) {
  const keys = base64UrlKeyFixture();
  const keyId = 'webhook-wrap-a7-test-v1';
  const label = Buffer.from(`swiftpay-webhook-secret-wrap-v1\n${endpointId}\n${version}\n${keyId}`, 'utf8');
  const publicKey = webhooks.parseWebhookWrappingPublicKey(keys.publicKey);
  const encrypted = publicEncrypt({
    key: publicKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
    oaepLabel: label,
  }, Buffer.from(secret, 'utf8'));
  return {
    keyId,
    ciphertext: `rsa-oaep-sha256-v1$${encrypted.toString('base64url')}`,
    privateKeyring: { [keyId]: keys.privateKey },
  };
}

function legacyCiphertext(secret) {
  return webhooks.encryptWebhookSigningSecret({
    key: Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex').toString('base64url'),
    endpointId,
    secretVersion: 1,
    secret,
    nonce: Buffer.from('000102030405060708090a0b', 'hex'),
  });
}

function claim({ version, ciphertext, format, wrappingKeyId }) {
  return {
    jobId: 'b5000000-0000-0000-0000-000000000001',
    deliveryId: 'b5100000-0000-0000-0000-000000000001',
    leaseToken: 'b5200000-0000-0000-0000-000000000001',
    attemptNumber: 1,
    maxAttempts: 8,
    leaseExpiresAt: '2030-01-01T00:00:30.000Z',
    endpoint: {
      id: endpointId,
      url: 'https://snapshot.merchant.example/webhooks',
      environment: 'sandbox',
      signingSecretVersion: version,
      signingSecretCiphertext: ciphertext,
      signingSecretCiphertextFormat: format,
      signingSecretWrappingKeyId: wrappingKeyId,
    },
    event: {
      id: 'b5400000-0000-0000-0000-000000000001',
      type: 'payment.paid',
      occurredAt: '2030-01-01T00:00:00.000Z',
      payloadVersion: 'payment-v1',
      payload: { id: 'pay_1', status: 'paid' },
    },
  };
}

async function runOne({ deliveryClaim, privateKeyring = {} }) {
  const resolutions = [];
  const requests = [];
  const runtime = workerRuntime.createWorkerRuntime({
    paidStore: { applyPaidEvidence: async () => ({ kind: 'not_used' }) },
    webhookStore: {
      claim: async () => [deliveryClaim],
      resolve: async (value) => { resolutions.push(value); return true; },
    },
    webhookEncryptionKey: Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex').toString('base64url'),
    webhookPrivateKeyring: privateKeyring,
    webhookEndpointPolicy: {
      resolveAndValidate: async (url) => ({ url, hostname: 'snapshot.merchant.example', port: 443, pinnedAddress: '93.184.216.34' }),
    },
    webhookTransport: {
      send: async (request) => { requests.push(request); return { status: 204, headers: {} }; },
    },
    webhookClock: { nowUnixSeconds: () => 2_000_000_000 },
  });
  const result = await runtime.runWebhookDeliveryBatch({ workerId: 'a7-worker', limit: 1, leaseSeconds: 30 });
  return { result, resolutions, requests };
}

test('A7 worker keeps A4 legacy AES delivery compatibility while extending claim projection', async () => {
  const secret = 'legacy-secret-material-0123456789abcdef';
  const outcome = await runOne({
    deliveryClaim: claim({ version: 1, ciphertext: legacyCiphertext(secret), format: 'aes-256-gcm-v1', wrappingKeyId: null }),
  });
  assert.equal(outcome.result.succeeded, 1);
  assert.equal(outcome.requests.length, 1);
});

test('A7 worker decrypts RSA-OAEP-SHA256 historical/current secret rows and emits immutable signature version header', async () => {
  const secret = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const rsa = rsaFixture(secret, 2);
  const outcome = await runOne({
    deliveryClaim: claim({ version: 2, ciphertext: rsa.ciphertext, format: 'rsa-oaep-sha256-v1', wrappingKeyId: rsa.keyId }),
    privateKeyring: rsa.privateKeyring,
  });
  assert.equal(outcome.result.succeeded, 1);
  assert.equal(outcome.requests.length, 1);
  assert.equal(outcome.requests[0].url, 'https://snapshot.merchant.example/webhooks');
  assert.equal(outcome.requests[0].headers['x-swiftpay-signature-version'], '2');
});

test('A7 effective delivery database claim reads endpoint_url_snapshot rather than mutable endpoint url', async () => {
  const source = await readFile('supabase/migrations/20260816073604_webhook_endpoint_management_behavior_fix.sql', 'utf8');
  assert.match(source, /endpoint_url_snapshot/);
  assert.doesNotMatch(source, /ep\.url\s+as\s+endpoint_url/i);
});

test('A7 RSA unwrap failure remains terminal before HTTP and never downgrades to legacy AES trial-decrypt', async () => {
  const rsa = rsaFixture('whsec_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', 2);
  const outcome = await runOne({
    deliveryClaim: claim({ version: 2, ciphertext: rsa.ciphertext, format: 'rsa-oaep-sha256-v1', wrappingKeyId: rsa.keyId }),
    privateKeyring: {},
  });
  assert.equal(outcome.requests.length, 0);
  assert.equal(outcome.result.terminal, 1);
  assert.equal(outcome.resolutions[0].errorClass, 'configuration');
  assert.match(outcome.resolutions[0].errorCode, /^signing_secret_(unavailable|invalid)$/);
});
