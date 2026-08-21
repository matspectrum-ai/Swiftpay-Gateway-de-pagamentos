import { loadWorkerConfig } from '@swiftpay/config';
import { createRuntimePool } from '@swiftpay/db';
import { createSafeRuntimeLogger } from '@swiftpay/observability';
import { createWorkerRuntimeServices } from './runtime.js';

const CHECK_FLAG = '--check';
const POLLING_INTERVAL_MS = 500;
const CLAIM_LIMIT = 10;
const LEASE_SECONDS = 30;
type ShutdownSignal = 'SIGTERM' | 'SIGINT';

const config = loadWorkerConfig();
const pool = createRuntimePool({ databaseUrl: config.databaseUrl, workload: 'worker' });
const services = createWorkerRuntimeServices(pool, {
  webhookEncryptionKey: config.webhookSecretEncryptionKey,
  ...(config.webhookSecretWrapPrivateKeys === undefined
    ? {}
    : { webhookPrivateKeyring: config.webhookSecretWrapPrivateKeys }),
});
const logger = createSafeRuntimeLogger({
  sink: {
    stdout(line) {
      process.stdout.write(line);
    },
    stderr(line) {
      process.stderr.write(line);
    },
  },
});

function createShutdownController(): {
  readonly shutdown: Promise<ShutdownSignal>;
  readonly isStopping: () => boolean;
} {
  let stopping = false;
  let resolveShutdown!: (signal: ShutdownSignal) => void;
  const shutdown = new Promise<ShutdownSignal>((resolve) => {
    resolveShutdown = resolve;
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      resolveShutdown(signal);
    });
  }

  return {
    shutdown,
    isStopping: () => stopping,
  };
}

async function delayUnlessStopping(
  milliseconds: number,
  shutdown: Promise<ShutdownSignal>,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, milliseconds);
    }),
    shutdown.then(() => undefined),
  ]);
  if (timer !== undefined) clearTimeout(timer);
}

async function runWebhookLoop(controller: {
  readonly shutdown: Promise<ShutdownSignal>;
  readonly isStopping: () => boolean;
}): Promise<ShutdownSignal> {
  const workerId = `swiftpay-worker-${process.pid}`;
  while (!controller.isStopping()) {
    try {
      await services.webhookDeliveries.runBatch({
        workerId,
        limit: CLAIM_LIMIT,
        leaseSeconds: LEASE_SECONDS,
      });
    } catch {
      logger.log({ level: 'error', event: 'merchant_webhook_delivery_batch_failed', workload: 'worker' });
    }

    if (!controller.isStopping()) {
      await delayUnlessStopping(POLLING_INTERVAL_MS, controller.shutdown);
    }
  }
  return controller.shutdown;
}

try {
  await services.readinessProbe();

  if (process.argv.includes(CHECK_FLAG)) {
    logger.log({ level: 'info', event: 'worker_readiness_ok', workload: 'worker' });
  } else {
    const controller = createShutdownController();
    logger.log({ level: 'info', event: 'merchant_webhook_delivery_loop_started', workload: 'worker' });
    const signal = await runWebhookLoop(controller);
    logger.log({ level: 'info', event: `worker_shutdown_${signal.toLowerCase()}`, workload: 'worker' });
  }
} catch {
  logger.log({ level: 'error', event: 'worker_runtime_boundary_failed', workload: 'worker' });
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
