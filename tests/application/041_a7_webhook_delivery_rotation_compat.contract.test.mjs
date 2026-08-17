import assert from 'node:assert/strict';
import {
  createCipheriv,
  generateKeyPairSync,
  publicEncrypt,
  constants,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const webhooks = await import('../../packages/webhooks/dist/index.js');

const ENDPOINT_ID = '70000000-0000-0000-0000-0000000000a7';
const DELIVERY_ID = '71000000-0000-0000-0000-0000000000a7';
const EVENT_ID = '72000000-0000-0000-0000-0000000000a7';
const JOB_ID = '73000000-0000-0000-0000-0000000000a7';
const LEASE = '74000000-0000-0000-0000-0000000000a7';
const LEGACY_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i));

function legacyCiphertext(secret, version = 1) {
  const nonce = Buffer.alloc(12, 7);
  const aad = Buffer.from(`swiftpay-webhook-secret-v1\n${ENDPOINT_ID}\n${version}`, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', LEGACY_KEY, nonce);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `aes-256-gcm-v1$${nonce.toString('base64url')}$${encrypted.toString('base64url')}$${cipher.getAuthTag().toString('base64url')}`;
}

function rsaFixture(secret, version = 2, keyId = 'webhook-wrap-a7-v1') {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const label = Buffer.from(`swiftpay-webhook-secret-wrap-v1\n${ENDPOINT_ID}\n${version}\n${keyId}`, 'utf8');
  const encrypted = publicEncrypt({
    key: pair.publicKey,
    format: 'der',
    type: 'spki',
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
    oaepLabel: label,
  }, Buffer.from(secret, 'utf8'));
  return {
    privateKeyring: { [keyId]: pair.privateKey.toString('base64url') },
    ciphertext: `rsa-oaep-sha256-v1$${encrypted.toString('base64url')}`,
    keyId,
  };
}

function claim({ version, ciphertext, format, wrappingKeyId }) {
  return {
    jobId: JOB_ID,
    deliveryId: DELIVERY_ID,
    leaseToken: LEASE,
    attemptNumber: 1,
    maxAttempts: 8,
    leaseExpiresAt: '2026-08-16T06:00:30.000Z',
    endpoint: {
      id: ENDPOINT_ID,
      url: 'https://snapshot.merchant.example/webhooks',
      environment: 'sandbox',
      signingSecretVersion: version,
      signingSecretCiphertext: ciphertext,
      signingSecretCiphertextFormat: format,
      signingSecretWrappingKeyId: wrappingKeyId ?? null,
    },
    event: {
      id: EVENT_ID,
      type: 'payment.paid',
      occurredAt: '2026-08-16T06:00:00.000Z',
      payloadVersion: 'payment-v1',
      payload: { id: 'payment-a7', status: 'paid' },
    },
  };
}

async function runOne({ deliveryClaim, privateKeyring = {} }) {
  const resolutions = [];
  const requests = [];
  const service = webhooks.createWebhookDeliveryService({
    store: {
      claim: async () => [deliveryClaim],
      resolve: async (input) => { resolutions.push(input); return true; },
    },
    encryptionKey: LEGACY_KEY,
    privateKeyring,
    endpointPolicy: {
      resolveAndValidate: async (url) => ({ url, hostname: 'snapshot.merchant.example', port: 443, pinnedAddress: '93.184.216.34' }),
    },
    transport: {
      send: async (request) => { requests.push(request); return { status: 204, headers: {} }; },
    },
    clock: { nowUnixSeconds: () => 1_900_000_000 },
  });
  const result = await service.runBatch({ workerId: 'worker-a7', limit: 1, leaseSeconds: 30 });
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
