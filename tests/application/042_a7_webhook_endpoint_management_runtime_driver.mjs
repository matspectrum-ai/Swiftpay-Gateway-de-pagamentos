import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const [db, webhooks] = await Promise.all([
  import('../../packages/db/dist/index.js'),
  import('../../packages/webhooks/dist/index.js'),
]);

const API_DATABASE_URL = process.env.SWIFTPAY_API_DATABASE_URL;
const WORKER_DATABASE_URL = process.env.SWIFTPAY_WORKER_DATABASE_URL;
const WRAP_KEY_ID = process.env.SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID;
const WRAP_PUBLIC_KEY = process.env.SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY;
const WRAP_PRIVATE_KEYS = process.env.SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS;
const ADMIN_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

for (const [name, value] of Object.entries({
  SWIFTPAY_API_DATABASE_URL: API_DATABASE_URL,
  SWIFTPAY_WORKER_DATABASE_URL: WORKER_DATABASE_URL,
  SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID: WRAP_KEY_ID,
  SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY: WRAP_PUBLIC_KEY,
  SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS: WRAP_PRIVATE_KEYS,
})) {
  assert.equal(typeof value, 'string', `${name} must be configured`);
  assert.ok(value.length > 0, `${name} must be non-empty`);
}

const merchantId = randomUUID();
const adminUserId = randomUUID();
const memberUserId = randomUUID();
const URL_V1 = 'https://merchant-a7.example.invalid/webhook-v1';
const URL_V2 = 'https://merchant-a7.example.invalid/webhook-v2';
const URL_V3 = 'https://merchant-a7.example.invalid/webhook-v3';
const allowedUrls = new Set([URL_V1, URL_V2, URL_V3]);
const captures = [];

const adminPool = db.createRuntimePool({ databaseUrl: ADMIN_DATABASE_URL, workload: 'api' });
const apiPool = db.createRuntimePool({ databaseUrl: API_DATABASE_URL, workload: 'api' });
const workerPool = db.createRuntimePool({ databaseUrl: WORKER_DATABASE_URL, workload: 'worker' });

function assertPublicEndpoint(endpoint, expected = {}) {
  assert.ok(endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint));
  assert.deepEqual(Object.keys(endpoint).sort(), [
    'createdAt', 'environment', 'id', 'merchantId', 'revision', 'secretVersion',
    'status', 'subscribedEvents', 'updatedAt', 'url',
  ].sort());
  assert.equal(endpoint.merchantId, merchantId);
  assert.equal(endpoint.environment, 'sandbox');
  assert.deepEqual(endpoint.subscribedEvents, ['payment.paid']);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(endpoint[key], value, key);
  assert.doesNotMatch(JSON.stringify(endpoint), /whsec_|ciphertext|wrappingKey|secretCiphertext/i);
}

async function financialSnapshot() {
  const candidates = [
    'payments', 'provider_attempts', 'provider_events', 'accounts',
    'ledger_transactions', 'ledger_entries', 'payouts', 'refunds',
  ];
  const result = {};
  for (const table of candidates) {
    const exists = await adminPool.query('select to_regclass($1)::text as relation', [`app.${table}`]);
    if (exists.rows[0]?.relation) {
      const count = await adminPool.query(`select count(*)::bigint as count from app.${table}`);
      result[table] = String(count.rows[0].count);
    }
  }
  return result;
}

async function merchantCount(table, extra = '') {
  const result = await adminPool.query(
    `select count(*)::integer as count from app.${table} where merchant_id = $1::uuid ${extra}`,
    [merchantId],
  );
  return result.rows[0].count;
}

async function recordPaidEvent(label) {
  const resourceId = randomUUID();
  const sourceId = randomUUID();
  const result = await adminPool.query(
    `select app.record_webhook_event(
       $1::uuid, 'sandbox', 'payment.paid', 'payment', $2::uuid,
       'a7_runtime_acceptance', $3::uuid, 'payment-v1', $4::jsonb,
       pg_catalog.clock_timestamp()
     ) as event_id`,
    [merchantId, resourceId, sourceId, JSON.stringify({ id: resourceId, status: 'paid', acceptance: label })],
  );
  const eventId = result.rows[0]?.event_id;
  assert.equal(typeof eventId, 'string');
  return eventId;
}

async function deliveryForEvent(eventId) {
  const result = await adminPool.query(
    `select d.id::text as delivery_id,
            d.endpoint_url_snapshot,
            d.signing_secret_version,
            d.state,
            j.state as job_state
       from app.webhook_deliveries d
       join app.jobs j
         on j.resource_id = d.id
        and j.kind = 'merchant_webhook_delivery'
        and j.resource_type = 'webhook_delivery'
      where d.webhook_event_id = $1::uuid`,
    [eventId],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

function verifyCapturedRequest(request, secret, expectedUrl, expectedVersion) {
  assert.equal(request.url, expectedUrl);
  assert.equal(request.method, 'POST');
  assert.equal(request.redirects, 'manual');
  assert.equal(request.timeoutMs, 5000);
  assert.equal(request.headers['x-swiftpay-signature-version'], String(expectedVersion));
  const timestamp = Number(request.headers['x-swiftpay-timestamp']);
  assert.equal(Number.isSafeInteger(timestamp), true);
  assert.equal(webhooks.verifyWebhookSignature({
    secret,
    timestamp,
    eventId: request.headers['x-swiftpay-event'],
    deliveryId: request.headers['x-swiftpay-delivery'],
    body: request.body,
    signature: request.headers['x-swiftpay-signature'],
    nowUnixSeconds: timestamp,
    replayWindowSeconds: 0,
  }), true);
}

try {
  const financialBefore = await financialSnapshot();

  await adminPool.query(
    `insert into app.merchants (id, name, lifecycle_status)
     values ($1::uuid, 'A7 Runtime Acceptance Merchant', 'active')`,
    [merchantId],
  );
  await adminPool.query(
    `insert into auth.users (
       id, aud, role, email, raw_user_meta_data, raw_app_meta_data,
       is_anonymous, deleted_at, created_at, updated_at
     ) values
       ($1::uuid, 'authenticated', 'authenticated', $3, '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
       ($2::uuid, 'authenticated', 'authenticated', $4, '{}'::jsonb, '{}'::jsonb, false, null, now(), now())`,
    [
      adminUserId,
      memberUserId,
      `a7-admin-${adminUserId}@example.test`,
      `a7-member-${memberUserId}@example.test`,
    ],
  );
  await adminPool.query(
    `insert into app.merchant_members (merchant_id, user_id, role, status) values
       ($1::uuid, $2::uuid, 'admin', 'active'),
       ($1::uuid, $3::uuid, 'member', 'active')`,
    [merchantId, adminUserId, memberUserId],
  );

  await assert.rejects(
    apiPool.query('select count(*) from app.webhook_endpoints'),
    (error) => error?.code === '42501',
  );
  await assert.rejects(
    workerPool.query('select count(*) from app.webhook_endpoint_secret_versions'),
    (error) => error?.code === '42501',
  );

  const contextStore = db.createDashboardMerchantContextStore(apiPool);
  const endpointStore = db.createDashboardWebhookEndpointStore(apiPool);
  const endpointPolicy = {
    async resolveAndValidate(url, environment) {
      assert.equal(environment, 'sandbox');
      if (!allowedUrls.has(url)) throw new Error('acceptance endpoint denied');
      return {
        url,
        hostname: new URL(url).hostname,
        port: 443,
        pinnedAddress: '93.184.216.34',
      };
    },
  };
  const sessionVerifier = async (authorization) => {
    if (authorization === 'Bearer a7-admin') {
      return { kind: 'authenticated', principal: { userId: adminUserId } };
    }
    if (authorization === 'Bearer a7-member') {
      return { kind: 'authenticated', principal: { userId: memberUserId } };
    }
    return { kind: 'invalid_session' };
  };
  const service = webhooks.createDashboardWebhookEndpointManagementService({
    sessionVerifier,
    contextStore,
    endpointPolicy,
    store: endpointStore,
    wrappingKeyId: WRAP_KEY_ID,
    wrappingPublicKey: WRAP_PUBLIC_KEY,
  });

  const emptyList = await service.list({
    authorization: 'Bearer a7-member', merchantId, environment: 'sandbox',
  });
  assert.deepEqual(emptyList, { kind: 'ok', endpoints: [] });

  const memberCreate = await service.create({
    authorization: 'Bearer a7-member', merchantId, environment: 'sandbox',
    idempotencyKey: 'a7-member-create-denied',
    request: { url: URL_V1, subscribedEvents: ['payment.paid'] },
  });
  assert.deepEqual(memberCreate, { kind: 'forbidden' });
  assert.equal(await merchantCount('webhook_endpoints'), 0);

  const createRequest = {
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox',
    idempotencyKey: 'a7-create-001',
    request: { url: URL_V1, subscribedEvents: ['payment.paid'] },
  };
  const created = await service.create(createRequest);
  assert.equal(created.kind, 'created');
  assert.equal(created.replayed, false);
  assert.equal(created.secretAvailable, true);
  assert.match(created.signingSecret, /^whsec_[A-Za-z0-9_-]{43}$/);
  assertPublicEndpoint(created.endpoint, { revision: 1, secretVersion: 1, status: 'active', url: URL_V1 });
  const endpointId = created.endpoint.id;
  const secretV1 = created.signingSecret;

  const createReplay = await service.create(createRequest);
  assert.equal(createReplay.kind, 'created');
  assert.equal(createReplay.replayed, true);
  assert.equal(createReplay.secretAvailable, false);
  assert.equal(createReplay.signingSecret, null);
  assert.equal(createReplay.endpoint.id, endpointId);
  assert.equal(await merchantCount('webhook_endpoints'), 1);

  const createConflict = await service.create({
    ...createRequest,
    request: { url: URL_V2, subscribedEvents: ['payment.paid'] },
  });
  assert.deepEqual(createConflict, { kind: 'idempotency_conflict' });
  assert.equal(await merchantCount('webhook_endpoints'), 1);

  const activeUrlUpdate = await service.update({
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox', endpointId,
    idempotencyKey: 'a7-active-url-update-conflict',
    request: { expectedRevision: 1, url: URL_V2 },
  });
  assert.deepEqual(activeUrlUpdate, { kind: 'resource_conflict' });

  const disable1Request = {
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox', endpointId,
    idempotencyKey: 'a7-disable-001', request: { expectedRevision: 1 },
  };
  const disabled1 = await service.disable(disable1Request);
  assert.equal(disabled1.kind, 'ok');
  assert.equal(disabled1.replayed, false);
  assertPublicEndpoint(disabled1.endpoint, { revision: 2, status: 'disabled', url: URL_V1 });
  const disabled1Replay = await service.disable(disable1Request);
  assert.equal(disabled1Replay.kind, 'ok');
  assert.equal(disabled1Replay.replayed, true);
  assert.equal(disabled1Replay.endpoint.revision, 2);

  const updated1 = await service.update({
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox', endpointId,
    idempotencyKey: 'a7-update-001', request: { expectedRevision: 2, url: URL_V2 },
  });
  assert.equal(updated1.kind, 'ok');
  assert.equal(updated1.replayed, false);
  assertPublicEndpoint(updated1.endpoint, { revision: 3, status: 'disabled', url: URL_V2 });

  const enabled1 = await service.enable({
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox', endpointId,
    idempotencyKey: 'a7-enable-001', request: { expectedRevision: 3 },
  });
  assert.equal(enabled1.kind, 'ok');
  assertPublicEndpoint(enabled1.endpoint, { revision: 4, status: 'active', url: URL_V2 });

  const memberRead = await service.get({
    authorization: 'Bearer a7-member', merchantId, environment: 'sandbox', endpointId,
  });
  assert.equal(memberRead.kind, 'ok');
  assertPublicEndpoint(memberRead.endpoint, { revision: 4, status: 'active', url: URL_V2 });

  const event1 = await recordPaidEvent('before-rotation');
  const delivery1 = await deliveryForEvent(event1);
  assert.equal(delivery1.endpoint_url_snapshot, URL_V2);
  assert.equal(delivery1.signing_secret_version, 1);
  assert.equal(delivery1.state, 'pending');

  const rotateRequest = {
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox', endpointId,
    idempotencyKey: 'a7-rotate-001', request: { expectedRevision: 4 },
  };
  const rotated = await service.rotateSecret(rotateRequest);
  assert.equal(rotated.kind, 'ok');
  assert.equal(rotated.replayed, false);
  assert.equal(rotated.secretAvailable, true);
  assert.match(rotated.signingSecret, /^whsec_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(rotated.signingSecret, secretV1);
  assertPublicEndpoint(rotated.endpoint, { revision: 5, secretVersion: 2, status: 'active', url: URL_V2 });
  const secretV2 = rotated.signingSecret;

  const rotateReplay = await service.rotateSecret(rotateRequest);
  assert.equal(rotateReplay.kind, 'ok');
  assert.equal(rotateReplay.replayed, true);
  assert.equal(rotateReplay.secretAvailable, false);
  assert.equal(rotateReplay.signingSecret, null);
  assert.equal(rotateReplay.endpoint.revision, 5);
  assert.equal(rotateReplay.endpoint.secretVersion, 2);

  const staleRotation = await service.rotateSecret({
    ...rotateRequest,
    idempotencyKey: 'a7-rotate-stale-new-key',
  });
  assert.deepEqual(staleRotation, { kind: 'resource_conflict' });

  const secretHistory = await adminPool.query(
    `select secret_version, ciphertext_format, wrapping_key_id, secret_ciphertext,
            usable_until is not null and usable_until > now() as still_usable
       from app.webhook_endpoint_secret_versions
      where webhook_endpoint_id = $1::uuid
      order by secret_version`,
    [endpointId],
  );
  assert.equal(secretHistory.rows.length, 2);
  assert.deepEqual(secretHistory.rows.map((row) => row.secret_version), [1, 2]);
  assert.deepEqual(secretHistory.rows.map((row) => row.ciphertext_format), ['rsa-oaep-sha256-v1', 'rsa-oaep-sha256-v1']);
  assert.deepEqual(secretHistory.rows.map((row) => row.wrapping_key_id), [WRAP_KEY_ID, WRAP_KEY_ID]);
  assert.equal(secretHistory.rows[0].still_usable, true);
  for (const row of secretHistory.rows) {
    assert.doesNotMatch(row.secret_ciphertext, /whsec_/);
    assert.notEqual(row.secret_ciphertext, secretV1);
    assert.notEqual(row.secret_ciphertext, secretV2);
  }

  const event2 = await recordPaidEvent('after-rotation');
  const delivery2 = await deliveryForEvent(event2);
  assert.equal(delivery2.endpoint_url_snapshot, URL_V2);
  assert.equal(delivery2.signing_secret_version, 2);

  const workerStore = db.createMerchantWebhookDeliveryStore(workerPool);
  const deliveryService = webhooks.createWebhookDeliveryService({
    store: workerStore,
    privateKeyring: WRAP_PRIVATE_KEYS,
    endpointPolicy,
    transport: {
      async send(request) {
        captures.push(request);
        return { status: 204, headers: {} };
      },
    },
    clock: { nowUnixSeconds: () => 2_000_000_000 },
  });

  const firstBatch = await deliveryService.runBatch({ workerId: 'a7-runtime-worker', limit: 10, leaseSeconds: 30 });
  assert.deepEqual(firstBatch, { claimed: 2, succeeded: 2, retried: 0, terminal: 0 });
  assert.equal(captures.length, 2);
  const requestV1 = captures.find((request) => request.headers['x-swiftpay-signature-version'] === '1');
  const requestV2 = captures.find((request) => request.headers['x-swiftpay-signature-version'] === '2');
  assert.ok(requestV1);
  assert.ok(requestV2);
  verifyCapturedRequest(requestV1, secretV1, URL_V2, 1);
  verifyCapturedRequest(requestV2, secretV2, URL_V2, 2);

  const completed1 = await deliveryForEvent(event1);
  const completed2 = await deliveryForEvent(event2);
  assert.equal(completed1.state, 'succeeded');
  assert.equal(completed1.job_state, 'completed');
  assert.equal(completed2.state, 'succeeded');
  assert.equal(completed2.job_state, 'completed');

  const disabled2 = await service.disable({
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox', endpointId,
    idempotencyKey: 'a7-disable-002', request: { expectedRevision: 5 },
  });
  assert.equal(disabled2.kind, 'ok');
  assert.equal(disabled2.endpoint.revision, 6);

  const updated2 = await service.update({
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox', endpointId,
    idempotencyKey: 'a7-update-002', request: { expectedRevision: 6, url: URL_V3 },
  });
  assert.equal(updated2.kind, 'ok');
  assertPublicEndpoint(updated2.endpoint, { revision: 7, status: 'disabled', url: URL_V3, secretVersion: 2 });

  const enabled2 = await service.enable({
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox', endpointId,
    idempotencyKey: 'a7-enable-002', request: { expectedRevision: 7 },
  });
  assert.equal(enabled2.kind, 'ok');
  assertPublicEndpoint(enabled2.endpoint, { revision: 8, status: 'active', url: URL_V3, secretVersion: 2 });

  const snapshotsAfterUrlMutation = await adminPool.query(
    `select endpoint_url_snapshot, signing_secret_version
       from app.webhook_deliveries
      where webhook_event_id = any($1::uuid[])
      order by signing_secret_version`,
    [[event1, event2]],
  );
  assert.deepEqual(snapshotsAfterUrlMutation.rows, [
    { endpoint_url_snapshot: URL_V2, signing_secret_version: 1 },
    { endpoint_url_snapshot: URL_V2, signing_secret_version: 2 },
  ]);

  const event3 = await recordPaidEvent('after-url-mutation');
  const delivery3 = await deliveryForEvent(event3);
  assert.equal(delivery3.endpoint_url_snapshot, URL_V3);
  assert.equal(delivery3.signing_secret_version, 2);
  const secondBatch = await deliveryService.runBatch({ workerId: 'a7-runtime-worker', limit: 10, leaseSeconds: 30 });
  assert.deepEqual(secondBatch, { claimed: 1, succeeded: 1, retried: 0, terminal: 0 });
  assert.equal(captures.length, 3);
  verifyCapturedRequest(captures[2], secretV2, URL_V3, 2);

  const event4 = await recordPaidEvent('disabled-terminalization');
  const beforeDisable4 = await deliveryForEvent(event4);
  assert.equal(beforeDisable4.state, 'pending');
  const disable3Request = {
    authorization: 'Bearer a7-admin', merchantId, environment: 'sandbox', endpointId,
    idempotencyKey: 'a7-disable-003', request: { expectedRevision: 8 },
  };
  const disabled3 = await service.disable(disable3Request);
  assert.equal(disabled3.kind, 'ok');
  assertPublicEndpoint(disabled3.endpoint, { revision: 9, status: 'disabled', url: URL_V3, secretVersion: 2 });
  const disabled3Replay = await service.disable(disable3Request);
  assert.equal(disabled3Replay.kind, 'ok');
  assert.equal(disabled3Replay.replayed, true);

  const disabledDelivery = await deliveryForEvent(event4);
  assert.equal(disabledDelivery.state, 'disabled');
  assert.equal(disabledDelivery.job_state, 'completed');
  const afterDisableBatch = await deliveryService.runBatch({ workerId: 'a7-runtime-worker', limit: 10, leaseSeconds: 30 });
  assert.deepEqual(afterDisableBatch, { claimed: 0, succeeded: 0, retried: 0, terminal: 0 });
  assert.equal(captures.length, 3);

  const audits = await adminPool.query(
    `select action, count(*)::integer as count
       from app.audit_events
      where merchant_id = $1::uuid
        and resource_type = 'webhook_endpoint'
      group by action
      order by action`,
    [merchantId],
  );
  const auditCounts = Object.fromEntries(audits.rows.map((row) => [row.action, row.count]));
  assert.deepEqual(auditCounts, {
    'webhook_endpoint.created': 1,
    'webhook_endpoint.disabled': 3,
    'webhook_endpoint.enabled': 2,
    'webhook_endpoint.secret_rotated': 1,
    'webhook_endpoint.updated': 2,
  });

  const idempotency = await adminPool.query(
    `select state, response_snapshot::text as response_snapshot
       from app.request_idempotency
      where merchant_id = $1::uuid
        and operation like 'dashboard_webhook_endpoint_%'`,
    [merchantId],
  );
  assert.equal(idempotency.rows.length, 9);
  assert.equal(idempotency.rows.every((row) => row.state === 'completed'), true);
  for (const row of idempotency.rows) {
    assert.doesNotMatch(row.response_snapshot, /whsec_|ciphertext|wrappingKey|secretCiphertext/i);
  }

  const endpointSecrets = await adminPool.query(
    `select secret_ciphertext, previous_secret_ciphertext
       from app.webhook_endpoints
      where id = $1::uuid`,
    [endpointId],
  );
  assert.equal(endpointSecrets.rows.length, 1);
  for (const value of Object.values(endpointSecrets.rows[0])) {
    if (value !== null) {
      assert.doesNotMatch(value, /whsec_/);
      assert.notEqual(value, secretV1);
      assert.notEqual(value, secretV2);
    }
  }

  const financialAfter = await financialSnapshot();
  assert.deepEqual(financialAfter, financialBefore);

  process.stdout.write('SwiftPay A7 webhook endpoint management real-database acceptance: OK\n');
} finally {
  await Promise.allSettled([adminPool.end(), apiPool.end(), workerPool.end()]);
}