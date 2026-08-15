import Fastify, { type FastifyInstance } from 'fastify';

export type ReadinessProbe = () => Promise<void>;

export interface BuildAppOptions {
  readonly readinessProbe: ReadinessProbe;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.secret',
          '*.secret_key',
          '*.withdrawal_key',
          '*.database_url',
          '*.connection_string',
        ],
        censor: '[REDACTED]',
      },
    },
    requestIdHeader: 'x-request-id',
  });

  app.get('/health/live', async () => ({ status: 'live' as const }));

  app.get('/health/ready', async (request, reply) => {
    try {
      await options.readinessProbe();
      return { status: 'ready' as const, workload: 'api' as const };
    } catch {
      request.log.warn({ event: 'database_readiness_failed' }, 'SwiftPay API is not ready');
      return reply.code(503).send({ status: 'unavailable', workload: 'api' });
    }
  });

  return app;
}
