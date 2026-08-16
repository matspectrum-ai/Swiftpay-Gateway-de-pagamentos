import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE = '../../packages/webhooks/dist/index.js';

async function webhooks() {
  return import(MODULE);
}

test('A4 AES-256-GCM decrypts the frozen endpoint/version-bound ciphertext vector', async () => {
  const { decodeWebhookEncryptionKey, decryptWebhookSigningSecret } = await webhooks();
  const key = decodeWebhookEncryptionKey('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
  const secret = decryptWebhookSigningSecret({
    encryptionKey: key,
    endpointId: 'b4200000-0000-0000-0000-000000000001',
    secretVersion: 7,
    ciphertext: 'aes-256-gcm-v1$AAECAwQFBgcICQoL$MGqlfqa6oy_Scaa5gt1NW7TuvlWSGDsZXlfUty5dNYQ2KJedzaJ2_RI$JHRLQtcGf8jjgEcrEbBimQ',
  });
  assert.equal(secret, 'whsec_a4_0123456789abcdef0123456789abcdef');
});

test('A4 webhook secret decryption fails closed on malformed key, AAD, nonce, ciphertext or tag without echoing secret material', async () => {
  const { decodeWebhookEncryptionKey, decryptWebhookSigningSecret } = await webhooks();
  assert.throws(() => decodeWebhookEncryptionKey('too-short'), /webhook/i);
  const key = decodeWebhookEncryptionKey('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8');
  const vector = {
    encryptionKey: key,
    endpointId: 'b4200000-0000-0000-0000-000000000001',
    secretVersion: 7,
    ciphertext: 'aes-256-gcm-v1$AAECAwQFBgcICQoL$MGqlfqa6oy_Scaa5gt1NW7TuvlWSGDsZXlfUty5dNYQ2KJedzaJ2_RI$JHRLQtcGf8jjgEcrEbBimQ',
  };
  for (const mutation of [
    { ...vector, endpointId: 'b4200000-0000-0000-0000-000000000002' },
    { ...vector, secretVersion: 8 },
    { ...vector, ciphertext: vector.ciphertext.replace('AAECAwQFBgcICQoL', 'AAECAwQFBgcICQoM') },
    { ...vector, ciphertext: vector.ciphertext.replace('MGqlf', 'NGqlf') },
    { ...vector, ciphertext: vector.ciphertext.replace('JHRLQ', 'KHRLQ') },
  ]) {
    assert.throws(() => decryptWebhookSigningSecret(mutation), (error) => {
      assert.doesNotMatch(String(error), /whsec_a4|MGqlfqa6|JHRLQtcG/);
      return true;
    });
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
