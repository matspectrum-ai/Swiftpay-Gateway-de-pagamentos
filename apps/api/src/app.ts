import type {
  MachinePrincipal,
  TokenExchangeHandler,
  TokenExchangeRequest,
} from '@swiftpay/auth';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

export type ReadinessProbe = () => Promise<void>;

export type BearerAuthenticator = (token: string) => Promise<MachinePrincipal | null>;

interface PixCreateSuccess {
  readonly ok: true;
  readonly httpStatus: 201 | 202;
  readonly payment: unknown;
  readonly replayed: boolean;
}

interface PixCreateFailure {
  readonly ok: false;
  readonly httpStatus: 400 | 403 | 409 | 500;
  readonly error: {
    readonly code: 'validation_error' | 'operation_forbidden' | 'idempotency_key_reused' | 'internal_error';
    readonly message: string;
  };
}

export interface PixPaymentsHttpService {
  create(input: {
    readonly principal: MachinePrincipal;
    readonly idempotencyKey: unknown;
    readonly request: unknown;
  }): Promise<PixCreateSuccess | PixCreateFailure>;
  get(input: {
    readonly principal: MachinePrincipal;
    readonly paymentId: string;
  }): Promise<unknown | null>;
}

export interface BuildAppOptions {
  readonly readinessProbe: ReadinessProbe;
  readonly tokenExchange?: TokenExchangeHandler;
  readonly authenticateBearer?: BearerAuthenticator;
  readonly pixPayments?: PixPaymentsHttpService;
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

function paymentInternalError(requestId: string) {
  return {
    error: {
      code: 'internal_error' as const,
      message: 'Payment operation failed.',
      requestId,
    },
  };
}

function invalidAccessToken(requestId: string) {
  return {
    error: {
      code: 'invalid_access_token' as const,
      message: 'Invalid access token.',
      requestId,
    },
  };
}

function resourceNotFound(requestId: string) {
  return {
    error: {
      code: 'resource_not_found' as const,
      message: 'Payment was not found.',
      requestId,
    },
  };
}

function parseBearerToken(authorization: unknown): string | null {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

async function authenticatePaymentRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: BuildAppOptions,
): Promise<MachinePrincipal | null> {
  if (!options.authenticateBearer || !options.pixPayments) {
    request.log.warn({ event: 'payment_services_unavailable' }, 'SwiftPay payment services are unavailable');
    await reply.code(500).send(paymentInternalError(request.id));
    return null;
  }

  const token = parseBearerToken(request.headers.authorization);
  if (token === null) {
    await reply.code(401).send(invalidAccessToken(request.id));
    return null;
  }

  try {
    const principal = await options.authenticateBearer(token);
    if (principal === null) {
      await reply.code(401).send(invalidAccessToken(request.id));
      return null;
    }
    return principal;
  } catch {
    request.log.error({ event: 'payment_authentication_failed' }, 'SwiftPay payment authentication failed unexpectedly');
    await reply.code(500).send(paymentInternalError(request.id));
    return null;
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

  app.post('/v1/transactions', async (request, reply) => {
    const principal = await authenticatePaymentRequest(request, reply, options);
    if (principal === null) return reply;

    try {
      const result = await options.pixPayments!.create({
        principal,
        idempotencyKey: request.headers['idempotency-key'],
        request: request.body,
      });

      if (result.ok) {
        return reply.code(result.httpStatus).send(result.payment);
      }

      return reply.code(result.httpStatus).send({
        error: {
          code: result.error.code,
          message: result.error.message,
          requestId: request.id,
        },
      });
    } catch {
      request.log.error({ event: 'pix_create_failed' }, 'SwiftPay Pix creation failed unexpectedly');
      return reply.code(500).send(paymentInternalError(request.id));
    }
  });

  app.get('/v1/transactions/:id', async (request, reply) => {
    const principal = await authenticatePaymentRequest(request, reply, options);
    if (principal === null) return reply;

    try {
      const { id } = request.params as { readonly id: string };
      const payment = await options.pixPayments!.get({ principal, paymentId: id });
      if (payment === null) {
        return reply.code(404).send(resourceNotFound(request.id));
      }
      return reply.code(200).send(payment);
    } catch {
      request.log.error({ event: 'payment_get_failed' }, 'SwiftPay Payment lookup failed unexpectedly');
      return reply.code(500).send(paymentInternalError(request.id));
    }
  });

  return app;
}
