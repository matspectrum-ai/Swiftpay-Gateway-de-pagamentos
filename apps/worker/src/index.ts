import { loadWorkerConfig } from '@swiftpay/config';
import { createRuntimePool, verifyRuntimeBoundary } from '@swiftpay/db';

const CHECK_FLAG = '--check';
const config = loadWorkerConfig();
const pool = createRuntimePool({ databaseUrl: config.databaseUrl, workload: 'worker' });

function log(level: 'info' | 'error', event: string): void {
  const line = JSON.stringify({ level, event, workload: 'worker' });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

function waitForShutdown(): Promise<string> {
  return new Promise((resolve) => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => resolve(signal));
    }
  });
}

try {
  await verifyRuntimeBoundary(pool, 'worker');

  if (process.argv.includes(CHECK_FLAG)) {
    log('info', 'worker_readiness_ok');
  } else {
    log('info', 'worker_initialized_without_job_loop');
    const signal = await waitForShutdown();
    log('info', `worker_shutdown_${signal.toLowerCase()}`);
  }
} catch {
  log('error', 'worker_runtime_boundary_failed');
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
