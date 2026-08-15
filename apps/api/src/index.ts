import { loadApiConfig } from '@swiftpay/config';
import { createRuntimePool } from '@swiftpay/db';
import { buildApp } from './app.js';
import { createApiRuntimeServices } from './runtime.js';

const config = loadApiConfig();
const pool = createRuntimePool({ databaseUrl: config.databaseUrl, workload: 'api' });
const { readinessProbe, tokenExchange } = createApiRuntimeServices(pool, {
  signingKey: config.accessTokenSigningKey,
});
const app = buildApp({ readinessProbe, tokenExchange });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'SwiftPay API shutdown requested');
  await app.close();
  await pool.end();
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch(() => {
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch {
  app.log.error({ event: 'startup_failed' }, 'SwiftPay API failed to start');
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
}
