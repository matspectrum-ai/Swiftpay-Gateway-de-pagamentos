import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

const webhooks = await import('../../packages/webhooks/dist/index.js');

const ENDPOINT_ID = '70000000-0000-0000-0000-0000000000a7';
const KEY_ID = 'webhook-wrap-a7-v1';

function fixtureKeys(modulusLength = 2048) {
  const pair = generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKey: pair.publicKey.toString('base64url'),
    privateKey: pair.privateKey.toString('base64url'),
  };
}

function generateSecret() {
  return typeof webhooks.generateWebhookSigningSecret === 'function'
    ? webhooks.generateWebhookSigningSecret()
    : 'not_implemented';
}

function wrap(input) {
  if (typeof webhooks.wrapWebhookSigningSecret !== 'function') return { kind: 'not_implemented' };
  return webhooks.wrapWebhookSigningSecret(input);
}

function unwrap(input) {
  if (typeof webhooks.unwrapWebhookSigningSecret !== 'function') return { kind: 'not_implemented' };
  return webhooks.unwrapWebhookSigningSecret(input);
}

test('A7 webhooks package exports the frozen signing-secret wrapping boundary', () => {
  assert.equal(typeof webhooks.generateWebhookSigningSecret, 'function');
  assert.equal(typeof webhooks.wrapWebhookSigningSecret, 'function');
  assert.equal(typeof webhooks.unwrapWebhookSigningSecret, 'function');
  assert.equal(typeof webhooks.parseWebhookWrappingPublicKey, 'function');
  assert.equal(typeof webhooks.parseWebhookWrappingPrivateKeyring, 'function');
});

test('A7 signing secret is whsec_ plus exactly 32 CSPRNG bytes encoded base64url without padding', () => {
  const first = generateSecret();
  const second = generateSecret();
  assert.match(first, /^whsec_[A-Za-z0-9_-]+$/);
  assert.equal(first.includes('='), false);
  assert.equal(Buffer.from(first.slice(6), 'base64url').length, 32);
  assert.notEqual(first, second);
});

test('A7 RSA-OAEP-SHA256 wrapping round-trips only with exact endpoint version and wrapping key identity', () => {
  const keys = fixtureKeys();
  const secret = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const wrapped = wrap({
    publicKey: keys.publicKey,
    wrappingKeyId: KEY_ID,
    endpointId: ENDPOINT_ID,
    secretVersion: 3,
    secret,
  });

  assert.deepEqual(Object.keys(wrapped).sort(), ['ciphertext', 'format', 'wrappingKeyId']);
  assert.equal(wrapped.format, 'rsa-oaep-sha256-v1');
  assert.equal(wrapped.wrappingKeyId, KEY_ID);
  assert.match(wrapped.ciphertext, /^rsa-oaep-sha256-v1\$[A-Za-z0-9_-]+$/);
  assert.equal(wrapped.ciphertext.includes('='), false);

  const plaintext = unwrap({
    privateKeyring: { [KEY_ID]: keys.privateKey },
    wrappingKeyId: KEY_ID,
    endpointId: ENDPOINT_ID,
    secretVersion: 3,
    ciphertext: wrapped.ciphertext,
  });
  assert.equal(plaintext, secret);

  for (const changed of [
    { endpointId: '70000000-0000-0000-0000-0000000000ff', secretVersion: 3, wrappingKeyId: KEY_ID },
    { endpointId: ENDPOINT_ID, secretVersion: 4, wrappingKeyId: KEY_ID },
    { endpointId: ENDPOINT_ID, secretVersion: 3, wrappingKeyId: 'other-key' },
  ]) {
    assert.throws(() => unwrap({
      privateKeyring: { [KEY_ID]: keys.privateKey, 'other-key': keys.privateKey },
      ciphertext: wrapped.ciphertext,
      ...changed,
    }));
  }
});

test('A7 wrapping rejects undersized or malformed key authority without secret or key leakage', () => {
  const weak = fixtureKeys(1024);
  const secret = 'whsec_sensitive_a7_secret_material_should_never_echo';
  for (const publicKey of [weak.publicKey, 'not-base64url']) {
    assert.throws(
      () => wrap({
        publicKey,
        wrappingKeyId: KEY_ID,
        endpointId: ENDPOINT_ID,
        secretVersion: 1,
        secret,
      }),
      (error) => {
        const message = String(error?.message ?? error);
        assert.equal(message.includes(secret), false);
        assert.equal(message.includes(weak.privateKey), false);
        return true;
      },
    );
  }
});
