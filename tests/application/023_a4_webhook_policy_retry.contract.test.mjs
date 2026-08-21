import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE = '../../packages/webhooks/dist/index.js';
async function webhooks() { return import(MODULE); }

test('A4 HTTP outcome classification is explicit and redirect-safe', async () => {
  const { classifyWebhookOutcome } = await webhooks();
  assert.deepEqual(classifyWebhookOutcome({ status: 200 }), { kind: 'success' });
  assert.deepEqual(classifyWebhookOutcome({ status: 299 }), { kind: 'success' });
  assert.deepEqual(classifyWebhookOutcome({ status: 302 }), { kind: 'terminal', errorClass: 'permanent', errorCode: 'redirect_disallowed' });
  assert.deepEqual(classifyWebhookOutcome({ status: 400 }), { kind: 'terminal', errorClass: 'permanent', errorCode: 'http_400' });
  assert.deepEqual(classifyWebhookOutcome({ status: 408 }), { kind: 'retry', errorClass: 'transient', errorCode: 'http_408' });
  assert.deepEqual(classifyWebhookOutcome({ status: 425 }), { kind: 'retry', errorClass: 'transient', errorCode: 'http_425' });
  assert.deepEqual(classifyWebhookOutcome({ status: 429 }), { kind: 'retry', errorClass: 'rate_limited', errorCode: 'http_429' });
  assert.deepEqual(classifyWebhookOutcome({ status: 503 }), { kind: 'retry', errorClass: 'transient', errorCode: 'http_503' });
  assert.deepEqual(classifyWebhookOutcome({ networkError: true }), { kind: 'retry', errorClass: 'transient', errorCode: 'network_error' });
  assert.deepEqual(classifyWebhookOutcome({ timeout: true }), { kind: 'retry', errorClass: 'transient', errorCode: 'timeout' });
});

test('A4 deterministic jittered retry policy matches the frozen delivery vector and attempt eight has no retry', async () => {
  const { computeWebhookRetryDelay } = await webhooks();
  const deliveryId = 'b4100000-0000-0000-0000-000000000001';
  assert.deepEqual(
    [1,2,3,4,5,6,7].map((attemptNumber) => computeWebhookRetryDelay({ deliveryId, attemptNumber })),
    [5,34,123,630,1808,3612,7200],
  );
  assert.equal(computeWebhookRetryDelay({ deliveryId, attemptNumber: 8 }), null);
});

test('A4 bounded integer Retry-After is honored only for 429', async () => {
  const { computeWebhookRetryDelay } = await webhooks();
  const deliveryId = 'b4100000-0000-0000-0000-000000000001';
  assert.equal(computeWebhookRetryDelay({ deliveryId, attemptNumber: 2, status: 429, retryAfter: '4000' }), 4000);
  assert.equal(computeWebhookRetryDelay({ deliveryId, attemptNumber: 2, status: 503, retryAfter: '4000' }), 34);
  assert.equal(computeWebhookRetryDelay({ deliveryId, attemptNumber: 2, status: 429, retryAfter: 'Wed, 21 Oct 2030 07:28:00 GMT' }), 34);
  assert.equal(computeWebhookRetryDelay({ deliveryId, attemptNumber: 2, status: 429, retryAfter: '9000' }), 34);
});

test('A4 strict endpoint policy accepts one pinned public HTTPS destination', async () => {
  const { validateWebhookEndpoint } = await webhooks();
  const result = validateWebhookEndpoint({
    url: 'https://merchant.example/webhooks/swiftpay?source=pix',
    environment: 'sandbox',
    resolvedAddresses: ['8.8.8.8'],
  });
  assert.equal(result.hostname, 'merchant.example');
  assert.equal(result.port, 443);
  assert.equal(result.pinnedAddress, '8.8.8.8');
});

test('A4 endpoint policy rejects SSRF targets, mixed DNS answers, credentials, fragments, HTTP and non-443 ports', async () => {
  const { validateWebhookEndpoint } = await webhooks();
  const blocked = [
    { url: 'https://merchant.example/webhook', resolvedAddresses: ['127.0.0.1'] },
    { url: 'https://merchant.example/webhook', resolvedAddresses: ['10.0.0.1'] },
    { url: 'https://merchant.example/webhook', resolvedAddresses: ['169.254.169.254'] },
    { url: 'https://merchant.example/webhook', resolvedAddresses: ['100.64.0.1'] },
    { url: 'https://merchant.example/webhook', resolvedAddresses: ['::1'] },
    { url: 'https://merchant.example/webhook', resolvedAddresses: ['fc00::1'] },
    { url: 'https://merchant.example/webhook', resolvedAddresses: ['8.8.8.8', '10.0.0.1'] },
    { url: 'https://user:pass@merchant.example/webhook', resolvedAddresses: ['8.8.8.8'] },
    { url: 'https://merchant.example/webhook#fragment', resolvedAddresses: ['8.8.8.8'] },
    { url: 'http://merchant.example/webhook', resolvedAddresses: ['8.8.8.8'] },
    { url: 'https://merchant.example:8443/webhook', resolvedAddresses: ['8.8.8.8'] },
  ];
  for (const input of blocked) {
    assert.throws(
      () => validateWebhookEndpoint({ ...input, environment: 'sandbox' }),
      (error) => {
        assert.doesNotMatch(String(error), /user:pass/);
        return true;
      },
    );
  }
});
