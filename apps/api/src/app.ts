import type { TokenExchangeHandler, TokenExchangeRequest } from '@swiftpay/auth';
import Fastify, { type FastifyInstance } from 'fastify';

export type ReadinessProbe = () => Promise<void>;

export interface BuildAppOptions {
  readonly readinessProbe: ReadinessProbe;
  readonly tokenExchange?: TokenExchangeHandler;
}

function tokenStatus(code: string): 400 | 401 | 403 | 429 | 500 {
  switch (code) {
    case 'validation_error':
      return 400;
    case 'invalid_credentials':
      return 401;
    case 'ip_not_allowed':
      return 403;
    case 'auth_rate_limit_exceeded':
      return 429;
    default:
      return 500;
  }
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

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
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

  app.post('/v1/auth/token', async (request, reply) => {
    if (!options.tokenExchange) {
      request.log.warn({ event: 'token_exchange_unavailable' }, 'SwiftPay token authentication is unavailable');
      return reply.code(500).send({
        error: {
          code: 'internal_error',
          message: 'Authentication is unavailable.',
          requestId: request.id,
        },
      });
    }

    try {
      const result = await options.tokenExchange(
        request.body as TokenExchangeRequest,
        { clientIp: request.ip, requestId: request.id },
      );

      if (result.ok) {
        return reply.code(200).send(result.value);
      }

      const status = tokenStatus(result.error.code);
      if (
        status === 429
        && Number.isSafeInteger(result.error.retryAfterSeconds)
        && (result.error.retryAfterSeconds ?? 0) > 0
      ) {
        reply.header('retry-after', String(result.error.retryAfterSeconds));
      }

      return reply.code(status).send({
        error: {
          code: result.error.code,
          message: result.error.message,
          requestId: request.id,
        },
      });
    } catch {
      request.log.error({ event: 'token_exchange_failed' }, 'SwiftPay token authentication failed unexpectedly');
      return reply.code(500).send({
        error: {
          code: 'internal_error',
          message: 'Authentication is unavailable.',
          requestId: request.id,
        },
      });
    }
  });

  return app;
}
