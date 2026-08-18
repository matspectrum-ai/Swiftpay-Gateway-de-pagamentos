import { createRuntimePool, createMerchantWebhookDeliveryStore } from '../../packages/db/dist/index.js';
import { createWorkerRuntimeServices } from '../../apps/worker/dist/runtime.js';
import { verifyWebhookSignature } from '../../packages/webhooks/dist/index.js';

const DATABASE_URL = process.env.SWIFTPAY_WORKER_DATABASE_URL;
const PRIVATE_KEYRING = process.env.SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS;
const MODE = process.argv[2];
const SIGNING_SECRET = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OLD_STALE_TOKEN = 'b4ff0000-0000-0000-0000-000000000001';
const FIXED_TIMESTAMP = 1_893_456_000;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function diag(marker) {
  process.stdout.write(`A4_DIAG ${MODE} ${marker}\n`);
}

if (!DATABASE_URL) throw new Error('worker database URL is required');
if (!PRIVATE_KEYRING) throw new Error('webhook RSA private keyring is required');

const endpointPolicy = {
  async resolveAndValidate(url, environment) {
    diag('endpoint-policy-entered');
    check(environment === 'sandbox', 'acceptance endpoint environment drift');
    check(url === 'https://merchant.example.test/swiftpay', 'acceptance endpoint URL drift');
    return {
      url,
      hostname: 'merchant.example.test',
      port: 443,
      pinnedAddress: '8.8.8.8',
    };
  },
};

const clock = { nowUnixSeconds: () => FIXED_TIMESTAMP };

async function concurrencySuccess() {
  const poolOne = createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'worker' });
  const poolTwo = createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'worker' });
  diag('pools-created');
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const release = new Promise((resolve) => { releaseResolve = resolve; });
  let sends = 0;
  let capturedRequest;

  const transport = {
    async send(request) {
      sends += 1;
      diag(`transport-call-${sends}`);
      check(sends === 1, 'more than one network invocation occurred for one valid lease');
      capturedRequest = request;
      enteredResolve();
      await release;
      return { status: 204, headers: {} };
    },
  };

  try {
    const workerOne = createWorkerRuntimeServices(poolOne, {
      webhookPrivateKeyring: PRIVATE_KEYRING,
      webhookEndpointPolicy: endpointPolicy,
      webhookTransport: transport,
      clock,
    });
    const workerTwo = createWorkerRuntimeServices(poolTwo, {
      webhookPrivateKeyring: PRIVATE_KEYRING,
      webhookEndpointPolicy: endpointPolicy,
      webhookTransport: transport,
      clock,
    });
    diag('services-composed');

    const first = workerOne.webhookDeliveries.runBatch({
      workerId: 'a4-acceptance-worker-one',
      limit: 10,
      leaseSeconds: 30,
    });
    first.catch(() => {
      diag('first-run-rejected');
      enteredResolve();
    });
    diag('first-run-started');

    await entered;
    diag(`first-entered-boundary-sends-${sends}`);
    const secondResult = await workerTwo.webhookDeliveries.runBatch({
      workerId: 'a4-acceptance-worker-two',
      limit: 10,
      leaseSeconds: 30,
    });
    diag(`second-result-claimed-${secondResult.claimed}`);
    check(secondResult.claimed === 0, 'competing worker obtained a live webhook lease');
    releaseResolve();

    const firstResult = await first;
    diag(`first-result-${firstResult.claimed}-${firstResult.succeeded}-${firstResult.retried}-${firstResult.terminal}`);
    check(firstResult.claimed === 1 && firstResult.succeeded === 1, 'first webhook worker did not complete exactly one delivery');
    check(sends === 1, 'network invocation count drifted from exactly one');
    check(capturedRequest !== undefined, 'signed request was not captured');
    check(capturedRequest.method === 'POST', 'webhook method drifted');
    check(capturedRequest.timeoutMs === 5000, 'webhook timeout drifted');
    check(capturedRequest.redirects === 'manual', 'redirect policy drifted');
    check(capturedRequest.hostname === 'merchant.example.test', 'TLS hostname drifted');
    check(capturedRequest.pinnedAddress === '8.8.8.8', 'pinned destination drifted');
    check(capturedRequest.headers['content-type'] === 'application/json; charset=utf-8', 'content type drifted');
    check(capturedRequest.headers['user-agent'] === 'SwiftPay-Webhooks/1', 'user agent drifted');
    check(capturedRequest.headers['x-swiftpay-timestamp'] === String(FIXED_TIMESTAMP), 'timestamp header drifted');
    check(capturedRequest.headers['x-swiftpay-signature-version'] === '7', 'signature version drifted');
    check(/^v1=[0-9a-f]{64}$/.test(capturedRequest.headers['x-swiftpay-signature'] ?? ''), 'signature shape drifted');
    diag('request-shape-ok');

    const eventId = capturedRequest.headers['x-swiftpay-event'];
    const deliveryId = capturedRequest.headers['x-swiftpay-delivery'];
    check(typeof eventId === 'string' && typeof deliveryId === 'string', 'delivery identity headers missing');
    const verified = verifyWebhookSignature({
      secret: SIGNING_SECRET,
      timestamp: FIXED_TIMESTAMP,
      eventId,
      deliveryId,
      body: capturedRequest.body,
      signature: capturedRequest.headers['x-swiftpay-signature'],
      nowUnixSeconds: FIXED_TIMESTAMP,
      replayWindowSeconds: 300,
    });
    check(verified, 'runtime request signature failed exact-byte verification');
    diag('signature-verified');

    const body = JSON.parse(capturedRequest.body.toString('utf8'));
    check(body.object === 'event', 'canonical event envelope object drifted');
    check(body.type === 'payment.paid', 'canonical event type drifted');
    check(body.id === eventId, 'event header/body identity drifted');
    check(body.data?.status === 'paid', 'durable payload snapshot drifted');
    diag('body-verified');
  } finally {
    releaseResolve?.();
    await Promise.all([
      poolOne.end().catch(() => undefined),
      poolTwo.end().catch(() => undefined),
    ]);
  }
}

async function retryOnce() {
  const pool = createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'worker' });
  let sends = 0;
  try {
    const services = createWorkerRuntimeServices(pool, {
      webhookPrivateKeyring: PRIVATE_KEYRING,
      webhookEndpointPolicy: endpointPolicy,
      webhookTransport: {
        async send() {
          sends += 1;
          diag(`retry-transport-call-${sends}`);
          return {
            status: 503,
            headers: {},
            body: '{"command":"ignore-me"}',
          };
        },
      },
      clock,
    });

    const result = await services.webhookDeliveries.runBatch({
      workerId: 'a4-acceptance-retry-worker',
      limit: 10,
      leaseSeconds: 30,
    });
    diag(`retry-result-${result.claimed}-${result.retried}`);
    check(result.claimed === 1 && result.retried === 1 && result.succeeded === 0, 'retry outcome was not durably scheduled');
    check(sends === 1, 'retryable response caused an in-process second send');
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function disabledNoNetwork() {
  const pool = createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'worker' });
  let sends = 0;
  try {
    const services = createWorkerRuntimeServices(pool, {
      webhookPrivateKeyring: PRIVATE_KEYRING,
      webhookEndpointPolicy: endpointPolicy,
      webhookTransport: {
        async send() {
          sends += 1;
          diag(`disabled-transport-call-${sends}`);
          return { status: 204, headers: {} };
        },
      },
      clock,
    });
    const result = await services.webhookDeliveries.runBatch({
      workerId: 'a4-acceptance-disabled-worker',
      limit: 10,
      leaseSeconds: 30,
    });
    diag(`disabled-result-${result.claimed}`);
    check(result.claimed === 0, 'disabled endpoint produced a dispatchable claim');
    check(sends === 0, 'disabled endpoint caused network I/O');
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function staleFence() {
  const pool = createRuntimePool({ databaseUrl: DATABASE_URL, workload: 'worker' });
  try {
    const store = createMerchantWebhookDeliveryStore(pool);
    const claims = await store.claim({
      workerId: 'a4-acceptance-reclaim-worker',
      limit: 10,
      leaseSeconds: 30,
    });
    diag(`stale-claims-${claims.length}`);
    check(claims.length === 1, 'expired webhook lease was not reclaimed exactly once');
    const claim = claims[0];
    check(claim.attemptNumber === 2, 'reclaimed webhook attempt did not advance exactly once');
    check(claim.leaseToken !== OLD_STALE_TOKEN, 'reclaim reused the stale fencing token');

    const staleResolved = await store.resolve({
      jobId: claim.jobId,
      deliveryId: claim.deliveryId,
      leaseToken: OLD_STALE_TOKEN,
      outcome: 'success',
      httpStatus: 204,
      errorClass: null,
      errorCode: null,
      retryAfterSeconds: null,
    });
    diag(`stale-old-resolved-${staleResolved}`);
    check(staleResolved === false, 'stale fencing token mutated current delivery state');

    const currentResolved = await store.resolve({
      jobId: claim.jobId,
      deliveryId: claim.deliveryId,
      leaseToken: claim.leaseToken,
      outcome: 'success',
      httpStatus: 204,
      errorClass: null,
      errorCode: null,
      retryAfterSeconds: null,
    });
    diag(`stale-current-resolved-${currentResolved}`);
    check(currentResolved === true, 'current fencing token could not resolve delivery');
  } finally {
    await pool.end().catch(() => undefined);
  }
}

try {
  switch (MODE) {
    case 'concurrency-success':
      await concurrencySuccess();
      break;
    case 'retry-once':
      await retryOnce();
      break;
    case 'disabled':
      await disabledNoNetwork();
      break;
    case 'stale-fence':
      await staleFence();
      break;
    default:
      throw new Error('unknown A4 runtime acceptance mode');
  }
  process.stdout.write(`A4 runtime phase ${MODE}: OK\n`);
} catch {
  diag('phase-threw');
  throw new Error('A4 runtime acceptance phase failed');
}
