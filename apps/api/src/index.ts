import { loadApiConfig } from '@swiftpay/config';
import { createRuntimePool } from '@swiftpay/db';
import { createMetricsRequestHandler, createOperationalMetricsRegistry } from '@swiftpay/metrics';
import { createServer, type Server } from 'node:http';
import { buildApp } from './app.js';
import { createApiRuntimeServices } from './runtime.js';

const config = loadApiConfig();
const pool = createRuntimePool({ databaseUrl: config.databaseUrl, workload: 'api' });
const metrics = createOperationalMetricsRegistry({ workload: 'api' });
const services = {
  ...createApiRuntimeServices(pool, {
    signingKey: config.accessTokenSigningKey,
    supabaseUrl: config.supabaseUrl,
    supabasePublishableKey: config.supabasePublishableKey,
    dashboardCursorHmacKey: config.dashboardCursorHmacKey,
    trustedProxyIps: config.trustedProxyIps,
    abuseHmacKey: config.abuseHmacKey,
    webhookSecretWrapKeyId: config.webhookSecretWrapKeyId,
    webhookSecretWrapPublicKey: config.webhookSecretWrapPublicKey,
  }),
  metrics,
};
const app = buildApp(services);

let metricsServer: Server | undefined;
if (config.metricsPort !== undefined) {
  try {
    metricsServer = createServer(createMetricsRequestHandler({ registry: metrics }));
    metricsServer.on('error', () => undefined);
    metricsServer.listen(config.metricsPort, '127.0.0.1');
  } catch {
    metricsServer = undefined;
  }
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'SwiftPay API shutdown requested');
  if (metricsServer !== undefined) metricsServer.close();
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
  if (metricsServer !== undefined) metricsServer.close();
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
}
