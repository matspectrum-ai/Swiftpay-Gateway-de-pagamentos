import { appendFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

const keyId = 'webhook-wrap-a7-ci-v1';
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
});

const publicKey = pair.publicKey.toString('base64url');
const privateKey = pair.privateKey.toString('base64url');
const privateKeyring = JSON.stringify({ [keyId]: privateKey });
const githubEnv = process.env.GITHUB_ENV;

if (githubEnv) {
  process.stdout.write(`::add-mask::${privateKey}\n`);
  process.stdout.write(`::add-mask::${privateKeyring}\n`);
  appendFileSync(githubEnv, `SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID=${keyId}\n`, 'utf8');
  appendFileSync(githubEnv, `SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY=${publicKey}\n`, 'utf8');
  appendFileSync(githubEnv, `SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS=${privateKeyring}\n`, 'utf8');
} else {
  process.stdout.write(`SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID=${keyId}\n`);
  process.stdout.write(`SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY=${publicKey}\n`);
  process.stdout.write(`SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS=${privateKeyring}\n`);
}
