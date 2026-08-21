import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

const MODULE = '../../packages/webhooks/dist/index.js';

async function webhooks() {
  return import(MODULE);
}

function fixtureKeys() {
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

test('A4/A17 RSA wrapping preserves endpoint/version/key-bound signing-secret recovery', async () => {
  const { wrapWebhookSigningSecret, unwrapWebhookSigningSecret } = await webhooks();
  const keys = fixtureKeys();
  const secret = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const endpointId = 'b4200000-0000-0000-0000-000000000001';
  const wrappingKeyId = 'webhook-wrap-a4-v1';
  const wrapped = wrapWebhookSigningSecret({
    publicKey: keys.publicKey,
    wrappingKeyId,
    endpointId,
    secretVersion: 7,
    secret,
  });

  assert.equal(wrapped.format, 'rsa-oaep-sha256-v1');
  assert.equal(wrapped.wrappingKeyId, wrappingKeyId);
  assert.match(wrapped.ciphertext, /^rsa-oaep-sha256-v1\$[A-Za-z0-9_-]+$/);
  assert.equal(unwrapWebhookSigningSecret({
    privateKeyring: { [wrappingKeyId]: keys.privateKey },
    wrappingKeyId,
    endpointId,
    secretVersion: 7,
    ciphertext: wrapped.ciphertext,
  }), secret);
});

test('A4/A17 RSA secret unwrap fails closed on endpoint/version/key/ciphertext drift without material leakage', async () => {
  const { wrapWebhookSigningSecret, unwrapWebhookSigningSecret } = await webhooks();
  const keys = fixtureKeys();
  const secret = 'whsec_QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI';
  const endpointId = 'b4200000-0000-0000-0000-000000000001';
  const wrappingKeyId = 'webhook-wrap-a4-v1';
  const wrapped = wrapWebhookSigningSecret({
    publicKey: keys.publicKey,
    wrappingKeyId,
    endpointId,
    secretVersion: 7,
    secret,
  });

  const mutations = [
    { endpointId: 'b4200000-0000-0000-0000-000000000002', secretVersion: 7, wrappingKeyId, ciphertext: wrapped.ciphertext },
    { endpointId, secretVersion: 8, wrappingKeyId, ciphertext: wrapped.ciphertext },
    { endpointId, secretVersion: 7, wrappingKeyId: 'webhook-wrap-a4-other', ciphertext: wrapped.ciphertext },
    { endpointId, secretVersion: 7, wrappingKeyId, ciphertext: `${wrapped.ciphertext}x` },
  ];

  for (const mutation of mutations) {
    assert.throws(
      () => unwrapWebhookSigningSecret({
        privateKeyring: {
          [wrappingKeyId]: keys.privateKey,
          'webhook-wrap-a4-other': keys.privateKey,
        },
        ...mutation,
      }),
      (error) => {
        const text = String(error);
        assert.doesNotMatch(text, /whsec_QkJC/);
        assert.equal(text.includes(keys.privateKey), false);
        assert.equal(text.includes(wrapped.ciphertext), false);
        return true;
      },
    );
  }
});

test('A4 canonical event serialization produces the frozen exact bytes', async () => {
  const { serializeWebhookEvent } = await webhooks();
  const bytes = serializeWebhookEvent({
    id: 'b4000000-0000-0000-0000-000000000001',
    type: 'payment.paid',
    occurredAt: '2030-01-01T00:00:00.000Z',
    payloadVersion: 'payment-v1',
    payload: { status: 'paid', id: 'pay_1', amount: 12345 },
  });
  assert.ok(Buffer.isBuffer(bytes));
  assert.equal(
    bytes.toString('utf8'),
    '{"createdAt":"2030-01-01T00:00:00.000Z","data":{"amount":12345,"id":"pay_1","status":"paid"},"id":"b4000000-0000-0000-0000-000000000001","object":"event","type":"payment.paid"}',
  );
});

test('A4 HMAC-SHA256 signature matches the frozen versioned exact-byte vector', async () => {
  const { signWebhookRequest } = await webhooks();
  const body = Buffer.from('{"createdAt":"2030-01-01T00:00:00.000Z","data":{"amount":12345,"id":"pay_1","status":"paid"},"id":"b4000000-0000-0000-0000-000000000001","object":"event","type":"payment.paid"}');
  const signature = signWebhookRequest({
    secret: 'whsec_test_0123456789abcdef0123456789abcdef',
    timestamp: 1893456000,
    eventId: 'b4000000-0000-0000-0000-000000000001',
    deliveryId: 'b4100000-0000-0000-0000-000000000001',
    body,
  });
  assert.equal(signature, 'v1=c9800ffc34a3e3452c1a98ec17f93730c365c72ba3e70a57d8e42753d197e1a8');
});

test('A4 verification rejects stale timestamps, byte mutation and signature mutation using the exact delivery identity', async () => {
  const { signWebhookRequest, verifyWebhookSignature } = await webhooks();
  const body = Buffer.from('{"a":1}');
  const input = {
    secret: 'whsec_test_0123456789abcdef0123456789abcdef',
    timestamp: 1_893_456_000,
    eventId: 'b4000000-0000-0000-0000-000000000001',
    deliveryId: 'b4100000-0000-0000-0000-000000000001',
    body,
  };
  const signature = signWebhookRequest(input);
  assert.equal(verifyWebhookSignature({ ...input, signature, nowUnixSeconds: 1_893_456_200, replayWindowSeconds: 300 }), true);
  assert.equal(verifyWebhookSignature({ ...input, signature, nowUnixSeconds: 1_893_456_301, replayWindowSeconds: 300 }), false);
  assert.equal(verifyWebhookSignature({ ...input, signature, body: Buffer.from('{"a":2}'), nowUnixSeconds: 1_893_456_200, replayWindowSeconds: 300 }), false);
  assert.equal(verifyWebhookSignature({ ...input, signature: `${signature.slice(0, -1)}0`, nowUnixSeconds: 1_893_456_200, replayWindowSeconds: 300 }), false);
});
