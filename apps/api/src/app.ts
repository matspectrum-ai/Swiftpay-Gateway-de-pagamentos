import type { TokenExchangeHandler } from '@swiftpay/auth';
import Fastify, { type FastifyInstance } from 'fastify';

export type ReadinessProbe = () => Promise<void>;

export interface BuildAppOptions {
  readonly readinessProbe: ReadinessProbe;
  readonly tokenExchange?: TokenExchangeHandler;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.secretKey',
          '*.password',
          '*.secret',
          '*.secretKey',
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

  // A1 structural boundary only. The behavioral slice wires validation,
  // database lookup, verifier/IP policy, quota and JWT issuance after its RED.
  app.post('/v1/auth/token', async (request, reply) => {
    request.log.warn({ event: 'token_exchange_unavailable' }, 'SwiftPay token authentication is unavailable');
    return reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'Authentication is unavailable.',
        requestId: request.id,
      },
    });
  });

  return app;
}
