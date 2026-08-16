import { generateKeyPairSync } from 'node:crypto';

const keyId = 'webhook-wrap-a7-ci-v1';
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
});

process.stdout.write(`SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID=${keyId}\n`);
process.stdout.write(`SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY=${pair.publicKey.toString('base64url')}\n`);
process.stdout.write(`SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS=${JSON.stringify({ [keyId]: pair.privateKey.toString('base64url') })}\n`);
