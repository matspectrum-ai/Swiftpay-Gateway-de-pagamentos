import assert from 'node:assert/strict';
import test from 'node:test';

const webhooks = await import('../../packages/webhooks/dist/index.js');

const USER_ID = '10000000-0000-0000-0000-0000000007a1';
const MERCHANT_ID = '20000000-0000-0000-0000-0000000007a1';
const ENDPOINT_ID = '30000000-0000-0000-0000-0000000007a1';

function projection(revision, secretVersion) {
  return {
    id: ENDPOINT_ID,
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    url: 'https://merchant.example/webhooks',
    status: 'active',
    subscribedEvents: ['payment.paid'],
    secretVersion,
    revision,
    createdAt: '2026-08-16T06:00:00.000Z',
    updatedAt: '2026-08-16T06:00:00.000Z',
  };
}

test('A7 completed secret-rotation replay succeeds without returning a newly generated plaintext, while a new stale request still conflicts', async () => {
  let current = projection(1, 1);
  let completed = null;
  let generated = 0;

  const store = {
    list: async () => [],
    get: async () => current,
    create: async () => ({ kind: 'not_used' }),
    update: async () => ({ kind: 'not_used' }),
    disable: async () => ({ kind: 'not_used' }),
    enable: async () => ({ kind: 'not_used' }),
    async rotateSecret(input) {
      if (completed !== null
          && input.idempotencyKey === completed.idempotencyKey
          && input.requestHash === completed.requestHash) {
        return { kind: 'ok', replayed: true, endpoint: completed.endpoint };
      }
      if (input.command.expectedRevision !== current.revision) {
        return { kind: 'resource_conflict' };
      }
      assert.equal(input.command.newSecretVersion, current.secretVersion + 1);
      current = projection(current.revision + 1, current.secretVersion + 1);
      completed = {
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        endpoint: current,
      };
      return { kind: 'ok', replayed: false, endpoint: current };
    },
  };

  const service = webhooks.createDashboardWebhookEndpointManagementService({
    sessionVerifier: async () => ({ kind: 'authenticated', principal: { userId: USER_ID } }),
    contextStore: {
      requireContext: async () => ({
        kind: 'authorized',
        context: { merchantId: MERCHANT_ID, environment: 'sandbox', membershipRole: 'admin' },
      }),
    },
    endpointPolicy: {
      resolveAndValidate: async (url) => ({ url, hostname: 'merchant.example', port: 443, pinnedAddress: '93.184.216.34' }),
    },
    store,
    wrappingKeyId: 'webhook-wrap-a7-test',
    wrappingPublicKey: 'synthetic-public-key',
    secretGenerator: () => {
      generated += 1;
      return `whsec_${String(generated).padStart(43, 'A')}`;
    },
    secretWrapper: ({ wrappingKeyId }) => ({
      format: 'rsa-oaep-sha256-v1',
      wrappingKeyId,
      ciphertext: `rsa-oaep-sha256-v1$synthetic_${generated}`,
    }),
  });

  const request = {
    authorization: 'Bearer admin',
    merchantId: MERCHANT_ID,
    environment: 'sandbox',
    endpointId: ENDPOINT_ID,
    idempotencyKey: 'rotate-a7-replay-001',
    request: { expectedRevision: 1 },
  };

  const first = await service.rotateSecret(request);
  assert.equal(first.kind, 'ok');
  assert.equal(first.replayed, false);
  assert.equal(first.secretAvailable, true);
  assert.equal(typeof first.signingSecret, 'string');
  assert.equal(current.revision, 2);
  assert.equal(current.secretVersion, 2);

  const replay = await service.rotateSecret(request);
  assert.equal(replay.kind, 'ok');
  assert.equal(replay.replayed, true);
  assert.equal(replay.secretAvailable, false);
  assert.equal(replay.signingSecret, null);
  assert.equal(current.revision, 2);
  assert.equal(current.secretVersion, 2);

  const stale = await service.rotateSecret({ ...request, idempotencyKey: 'rotate-a7-stale-new-key' });
  assert.deepEqual(stale, { kind: 'resource_conflict' });
  assert.equal(current.revision, 2);
  assert.equal(current.secretVersion, 2);
});
