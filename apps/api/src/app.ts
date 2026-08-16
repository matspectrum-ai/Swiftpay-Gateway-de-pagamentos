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

export interface MerchantBalanceHttpService {
  get(input: {
    readonly principal: MachinePrincipal;
  }): Promise<unknown>;
}

interface DashboardWebhookListInput {
  readonly authorization?: string;
  readonly merchantId: string;
  readonly environment: string;
}

interface DashboardWebhookItemInput extends DashboardWebhookListInput {
  readonly endpointId: string;
}

interface DashboardWebhookMutationInput extends DashboardWebhookItemInput {
  readonly idempotencyKey?: string;
  readonly request: unknown;
}

interface DashboardWebhookCreateInput extends DashboardWebhookListInput {
  readonly idempotencyKey?: string;
  readonly request: unknown;
}

export interface DashboardWebhookEndpointsHttpService {
  list?(input: DashboardWebhookListInput): Promise<Record<string, unknown>>;
  get?(input: DashboardWebhookItemInput): Promise<Record<string, unknown>>;
  create?(input: DashboardWebhookCreateInput): Promise<Record<string, unknown>>;
  update?(input: DashboardWebhookMutationInput): Promise<Record<string, unknown>>;
  disable?(input: DashboardWebhookMutationInput): Promise<Record<string, unknown>>;
  enable?(input: DashboardWebhookMutationInput): Promise<Record<string, unknown>>;
  rotateSecret?(input: DashboardWebhookMutationInput): Promise<Record<string, unknown>>;
}

export interface BuildAppOptions {
  readonly readinessProbe: ReadinessProbe;
  readonly tokenExchange?: TokenExchangeHandler;
  readonly authenticateBearer?: BearerAuthenticator;
  readonly pixPayments?: PixPaymentsHttpService;
  readonly merchantBalance?: MerchantBalanceHttpService;
  readonly dashboardWebhookEndpoints?: DashboardWebhookEndpointsHttpService;
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

async function authenticateBearerRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: BuildAppOptions,
): Promise<MachinePrincipal | null> {
  if (!options.authenticateBearer) {
    request.log.warn({ event: 'bearer_authentication_unavailable' }, 'SwiftPay Bearer authentication is unavailable');
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

async function authenticatePaymentRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: BuildAppOptions,
): Promise<MachinePrincipal | null> {
  if (!options.pixPayments) {
    request.log.warn({ event: 'payment_services_unavailable' }, 'SwiftPay payment services are unavailable');
    await reply.code(500).send(paymentInternalError(request.id));
    return null;
  }

  return authenticateBearerRequest(request, reply, options);
}

function dashboardAuthorizationHeader(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function idempotencyHeader(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function resultKind(result: Record<string, unknown>): string {
  return typeof result.kind === 'string' ? result.kind : 'internal_error';
}

function dashboardWebhookError(kind: string, requestId: string): {
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503;
  body: { error: { code: string; message: string; requestId: string } };
} {
  switch (kind) {
    case 'invalid_session':
      return { status: 401, body: { error: { code: 'invalid_dashboard_session', message: 'Invalid dashboard session.', requestId } } };
    case 'authentication_unavailable':
      return { status: 503, body: { error: { code: 'dashboard_authentication_unavailable', message: 'Dashboard authentication is unavailable.', requestId } } };
    case 'forbidden':
      return { status: 403, body: { error: { code: 'operation_forbidden', message: 'Operation is forbidden.', requestId } } };
    case 'validation_error':
      return { status: 400, body: { error: { code: 'validation_error', message: 'Invalid webhook endpoint request.', requestId } } };
    case 'resource_not_found':
      return { status: 404, body: { error: { code: 'resource_not_found', message: 'Webhook endpoint was not found.', requestId } } };
    case 'resource_conflict':
      return { status: 409, body: { error: { code: 'resource_conflict', message: 'Webhook endpoint state changed.', requestId } } };
    case 'idempotency_conflict':
      return { status: 409, body: { error: { code: 'idempotency_conflict', message: 'Idempotency key conflicts with another request.', requestId } } };
    case 'idempotency_in_progress':
      return { status: 409, body: { error: { code: 'idempotency_in_progress', message: 'Idempotent request is still in progress.', requestId } } };
    case 'endpoint_limit_reached':
      return { status: 409, body: { error: { code: 'endpoint_limit_reached', message: 'Webhook endpoint limit reached.', requestId } } };
    default:
      return { status: 500, body: { error: { code: 'internal_error', message: 'Webhook endpoint operation failed.', requestId } } };
  }
}

async function sendDashboardWebhookResult(
  reply: FastifyReply,
  requestId: string,
  result: Record<string, unknown>,
  successKind: 'list' | 'item' | 'create' | 'mutation' | 'rotate',
) {
  const kind = resultKind(result);
  if (kind !== 'ok' && kind !== 'created') {
    const failure = dashboardWebhookError(kind, requestId);
    return reply.code(failure.status).send(failure.body);
  }

  if (successKind === 'list') {
    return reply.code(200).send({ object: 'list', data: result.endpoints ?? [] });
  }
  if (successKind === 'item' || successKind === 'mutation') {
    return reply.code(200).send(result.endpoint);
  }
  if (successKind === 'create') {
    const replayed = result.replayed === true;
    return reply.code(replayed ? 200 : 201).send({
      ...(result.endpoint as Record<string, unknown>),
      signingSecret: result.signingSecret ?? null,
      secretAvailable: result.secretAvailable === true,
      replayed,
    });
  }
  return reply.code(200).send({
    ...(result.endpoint as Record<string, unknown>),
    signingSecret: result.signingSecret ?? null,
    secretAvailable: result.secretAvailable === true,
    replayed: result.replayed === true,
  });
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
          '*.signingSecret',
          '*.secretCiphertext',
          '*.wrappingPrivateKey',
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

  app.get('/v1/balance', async (request, reply) => {
    const principal = await authenticateBearerRequest(request, reply, options);
    if (principal === null) return reply;

    if (!options.merchantBalance) {
      request.log.warn({ event: 'balance_service_unavailable' }, 'SwiftPay merchant balance service is unavailable');
      return reply.code(500).send(paymentInternalError(request.id));
    }

    try {
      const balance = await options.merchantBalance.get({ principal });
      return reply.code(200).send(balance);
    } catch {
      request.log.error({ event: 'balance_get_failed' }, 'SwiftPay merchant balance lookup failed unexpectedly');
      return reply.code(500).send(paymentInternalError(request.id));
    }
  });

  const dashboardWebhookBase = '/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints';

  app.get(dashboardWebhookBase, async (request, reply) => {
    const service = options.dashboardWebhookEndpoints?.list;
    if (!service) return sendDashboardWebhookResult(reply, request.id, { kind: 'internal_error' }, 'list');
    const { merchantId, environment } = request.params as { merchantId: string; environment: string };
    const authorization = dashboardAuthorizationHeader(request.headers.authorization);
    try {
      const result = await service({
        ...(authorization === undefined ? {} : { authorization }),
        merchantId,
        environment,
      });
      return sendDashboardWebhookResult(reply, request.id, result, 'list');
    } catch {
      return sendDashboardWebhookResult(reply, request.id, { kind: 'internal_error' }, 'list');
    }
  });

  app.get(`${dashboardWebhookBase}/:endpointId`, async (request, reply) => {
    const service = options.dashboardWebhookEndpoints?.get;
    if (!service) return sendDashboardWebhookResult(reply, request.id, { kind: 'internal_error' }, 'item');
    const { merchantId, environment, endpointId } = request.params as { merchantId: string; environment: string; endpointId: string };
    const authorization = dashboardAuthorizationHeader(request.headers.authorization);
    try {
      const result = await service({
        ...(authorization === undefined ? {} : { authorization }), merchantId, environment, endpointId,
      });
      return sendDashboardWebhookResult(reply, request.id, result, 'item');
    } catch {
      return sendDashboardWebhookResult(reply, request.id, { kind: 'internal_error' }, 'item');
    }
  });

  app.post(dashboardWebhookBase, async (request, reply) => {
    const service = options.dashboardWebhookEndpoints?.create;
    if (!service) return sendDashboardWebhookResult(reply, request.id, { kind: 'internal_error' }, 'create');
    const { merchantId, environment } = request.params as { merchantId: string; environment: string };
    const authorization = dashboardAuthorizationHeader(request.headers.authorization);
    const idempotencyKey = idempotencyHeader(request.headers['idempotency-key']);
    try {
      const result = await service({
        ...(authorization === undefined ? {} : { authorization }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        merchantId, environment, request: request.body,
      });
      return sendDashboardWebhookResult(reply, request.id, result, 'create');
    } catch {
      return sendDashboardWebhookResult(reply, request.id, { kind: 'internal_error' }, 'create');
    }
  });

  async function mutationRoute(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: 'update' | 'disable' | 'enable' | 'rotateSecret',
    successKind: 'mutation' | 'rotate',
  ) {
    const service = options.dashboardWebhookEndpoints?.[operation];
    if (!service) return sendDashboardWebhookResult(reply, request.id, { kind: 'internal_error' }, successKind);
    const { merchantId, environment, endpointId } = request.params as { merchantId: string; environment: string; endpointId: string };
    const authorization = dashboardAuthorizationHeader(request.headers.authorization);
    const idempotencyKey = idempotencyHeader(request.headers['idempotency-key']);
    try {
      const result = await service({
        ...(authorization === undefined ? {} : { authorization }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
        merchantId, environment, endpointId, request: request.body,
      });
      return sendDashboardWebhookResult(reply, request.id, result, successKind);
    } catch {
      return sendDashboardWebhookResult(reply, request.id, { kind: 'internal_error' }, successKind);
    }
  }

  app.patch(`${dashboardWebhookBase}/:endpointId`, (request, reply) => mutationRoute(request, reply, 'update', 'mutation'));
  app.post(`${dashboardWebhookBase}/:endpointId/disable`, (request, reply) => mutationRoute(request, reply, 'disable', 'mutation'));
  app.post(`${dashboardWebhookBase}/:endpointId/enable`, (request, reply) => mutationRoute(request, reply, 'enable', 'mutation'));
  app.post(`${dashboardWebhookBase}/:endpointId/rotate-secret`, (request, reply) => mutationRoute(request, reply, 'rotateSecret', 'rotate'));

  return app;
}
