import { loadWorkerConfig } from '@swiftpay/config';
import { createRuntimePool } from '@swiftpay/db';
import { createWorkerRuntimeServices } from './runtime.js';

const CHECK_FLAG = '--check';
const POLLING_INTERVAL_MS = 500;
const CLAIM_LIMIT = 10;
const LEASE_SECONDS = 30;

const config = loadWorkerConfig();
const pool = createRuntimePool({ databaseUrl: config.databaseUrl, workload: 'worker' });
const services = createWorkerRuntimeServices(pool, {
  webhookEncryptionKey: config.webhookSecretEncryptionKey,
});

function log(level: 'info' | 'error', event: string): void {
  const line = JSON.stringify({ level, event, workload: 'worker' });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

let stopping = false;
let shutdownSignal: 'SIGTERM' | 'SIGINT' | null = null;
let resolveShutdown!: () => void;
const shutdown = new Promise<void>((resolve) => {
  resolveShutdown = resolve;
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    stopping = true;
    shutdownSignal = signal;
    resolveShutdown();
  });
}

async function delayUnlessStopping(milliseconds: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, milliseconds);
    }),
    shutdown,
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

async function runWebhookLoop(): Promise<void> {
  const workerId = `swiftpay-worker-${process.pid}`;
  while (!stopping) {
    try {
      await services.webhookDeliveries.runBatch({
        workerId,
        limit: CLAIM_LIMIT,
        leaseSeconds: LEASE_SECONDS,
      });
    } catch {
      log('error', 'merchant_webhook_delivery_batch_failed');
    }

    if (!stopping) await delayUnlessStopping(POLLING_INTERVAL_MS);
  }
}

try {
  await services.readinessProbe();

  if (process.argv.includes(CHECK_FLAG)) {
    log('info', 'worker_readiness_ok');
  } else {
    log('info', 'merchant_webhook_delivery_loop_started');
    await runWebhookLoop();
    if (shutdownSignal !== null) {
      log('info', `worker_shutdown_${shutdownSignal.toLowerCase()}`);
    }
  }
} catch {
  log('error', 'worker_runtime_boundary_failed');
  process.exitCode = 1;
} finally {
  stopping = true;
  resolveShutdown();
  await pool.end().catch(() => undefined);
}
