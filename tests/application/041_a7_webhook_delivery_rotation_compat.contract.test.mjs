import assert from 'node:assert/strict';
import {
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

test('A7/A17 worker rejects historical AES delivery material before endpoint policy or transport', async () => {
  const outcome = await runOne({
    deliveryClaim: claim({
      version: 1,
      ciphertext: 'aes-256-gcm-v1$historical$fixture$only',
      format: 'aes-256-gcm-v1',
      wrappingKeyId: null,
    }),
  });
  assert.deepEqual(outcome.result, { claimed: 1, succeeded: 0, retried: 0, terminal: 1 });
  assert.equal(outcome.requests.length, 0);
  assert.equal(outcome.resolutions[0].outcome, 'terminal');
  assert.equal(outcome.resolutions[0].errorClass, 'configuration');
  assert.match(outcome.resolutions[0].errorCode, /^signing_secret_(unavailable|invalid)$/);
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

test('A7/A17 old and new retained RSA keys are selected only by exact persisted key ID', async () => {
  const oldRsa = rsaFixture('whsec_Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M', 2, 'webhook-wrap-a7-old');
  const newRsa = rsaFixture('whsec_REREREREREREREREREREREREREREREREREREREREREQ', 3, 'webhook-wrap-a7-new');
  const retained = { ...oldRsa.privateKeyring, ...newRsa.privateKeyring };

  const oldOutcome = await runOne({
    deliveryClaim: claim({ version: 2, ciphertext: oldRsa.ciphertext, format: 'rsa-oaep-sha256-v1', wrappingKeyId: oldRsa.keyId }),
    privateKeyring: retained,
  });
  assert.equal(oldOutcome.result.succeeded, 1);

  const newOutcome = await runOne({
    deliveryClaim: claim({ version: 3, ciphertext: newRsa.ciphertext, format: 'rsa-oaep-sha256-v1', wrappingKeyId: newRsa.keyId }),
    privateKeyring: retained,
  });
  assert.equal(newOutcome.result.succeeded, 1);

  const mismatched = await runOne({
    deliveryClaim: claim({ version: 2, ciphertext: oldRsa.ciphertext, format: 'rsa-oaep-sha256-v1', wrappingKeyId: newRsa.keyId }),
    privateKeyring: retained,
  });
  assert.equal(mismatched.requests.length, 0);
  assert.equal(mismatched.result.terminal, 1);
});

test('A7 effective delivery database claim reads endpoint_url_snapshot rather than mutable endpoint url', async () => {
  const source = await readFile('supabase/migrations/20260816073604_webhook_endpoint_management_behavior_fix.sql', 'utf8');
  assert.match(source, /endpoint_url_snapshot/);
  assert.doesNotMatch(source, /ep\.url\s+as\s+endpoint_url/i);
});

test('A7 RSA unwrap failure remains terminal before HTTP and never trial-decrypts another retained key', async () => {
  const rsa = rsaFixture('whsec_QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI', 2);
  const unrelated = rsaFixture('whsec_RUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUU', 2, 'webhook-wrap-a7-other');
  const outcome = await runOne({
    deliveryClaim: claim({ version: 2, ciphertext: rsa.ciphertext, format: 'rsa-oaep-sha256-v1', wrappingKeyId: rsa.keyId }),
    privateKeyring: unrelated.privateKeyring,
  });
  assert.equal(outcome.requests.length, 0);
  assert.equal(outcome.result.terminal, 1);
  assert.equal(outcome.resolutions[0].errorClass, 'configuration');
  assert.match(outcome.resolutions[0].errorCode, /^signing_secret_(unavailable|invalid)$/);
});
