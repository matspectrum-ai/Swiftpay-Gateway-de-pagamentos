export * from './app-base.js';

import {
  buildApp as buildBaseApp,
  type BuildAppOptions as BaseBuildAppOptions,
} from './app-base.js';

export interface DashboardPaymentLinksHttpService {
  list(input: { readonly authorization?: string; readonly merchantId: string; readonly environment: string }): Promise<Record<string, unknown>>;
  create(input: {
    readonly authorization?: string;
    readonly merchantId: string;
    readonly environment: string;
    readonly idempotencyKey?: string;
    readonly request: unknown;
  }): Promise<Record<string, unknown>>;
  disable(input: {
    readonly authorization?: string;
    readonly merchantId: string;
    readonly environment: string;
    readonly paymentLinkId: string;
    readonly idempotencyKey?: string;
    readonly request: unknown;
  }): Promise<Record<string, unknown>>;
}

export interface HostedCheckoutHttpService {
  getLink(publicToken: string): Promise<Record<string, unknown>>;
  createPayment(input: {
    readonly publicToken: string;
    readonly idempotencyKey: unknown;
    readonly request: unknown;
  }): Promise<Record<string, unknown>>;
}

export interface BuildAppOptions extends BaseBuildAppOptions {
  readonly dashboardPaymentLinks?: DashboardPaymentLinksHttpService;
  readonly hostedCheckout?: HostedCheckoutHttpService;
}

function authorizationHeader(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function idempotencyHeader(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function kind(value: Record<string, unknown>): string {
  return typeof value.kind === 'string' ? value.kind : 'internal_error';
}

function dashboardError(resultKind: string, requestId: string) {
  switch (resultKind) {
    case 'invalid_session':
      return { status: 401, body: { error: { code: 'invalid_dashboard_session', message: 'Invalid dashboard session.', requestId } } };
    case 'authentication_unavailable':
      return { status: 503, body: { error: { code: 'dashboard_authentication_unavailable', message: 'Dashboard authentication is unavailable.', requestId } } };
    case 'forbidden':
      return { status: 403, body: { error: { code: 'operation_forbidden', message: 'Operation is forbidden.', requestId } } };
    case 'validation_error':
      return { status: 400, body: { error: { code: 'validation_error', message: 'Invalid payment-link request.', requestId } } };
    case 'resource_not_found':
      return { status: 404, body: { error: { code: 'resource_not_found', message: 'Payment link was not found.', requestId } } };
    case 'idempotency_conflict':
      return { status: 409, body: { error: { code: 'idempotency_conflict', message: 'Idempotency key conflicts with another request.', requestId } } };
    default:
      return { status: 500, body: { error: { code: 'internal_error', message: 'Payment-link operation failed.', requestId } } };
  }
}

function checkoutError(resultKind: string, requestId: string) {
  switch (resultKind) {
    case 'not_found':
      return { status: 404, body: { error: { code: 'checkout_not_found', message: 'Checkout was not found.', requestId } } };
    case 'validation_error':
      return { status: 400, body: { error: { code: 'validation_error', message: 'Invalid checkout request.', requestId } } };
    case 'idempotency_conflict':
      return { status: 409, body: { error: { code: 'idempotency_conflict', message: 'Idempotency key conflicts with another request.', requestId } } };
    default:
      return { status: 500, body: { error: { code: 'internal_error', message: 'Checkout operation failed.', requestId } } };
  }
}

export function buildApp(options: BuildAppOptions) {
  const app = buildBaseApp(options);
  const dashboardBase = '/dashboard/v1/merchants/:merchantId/environments/:environment/payment-links';

  app.get(dashboardBase, async (request, reply) => {
    const params = request.params as { merchantId: string; environment: string };
    if (!options.dashboardPaymentLinks) {
      const failure = dashboardError('internal_error', request.id);
      return reply.code(failure.status).send(failure.body);
    }
    const result = await options.dashboardPaymentLinks.list({
      authorization: authorizationHeader(request.headers.authorization),
      merchantId: params.merchantId,
      environment: params.environment,
    });
    if (kind(result) === 'ok' && Array.isArray(result.data)) {
      reply.header('cache-control', 'private, no-store');
      return reply.code(200).send({ object: 'list', data: result.data });
    }
    const failure = dashboardError(kind(result), request.id);
    return reply.code(failure.status).send(failure.body);
  });

  app.post(dashboardBase, async (request, reply) => {
    const params = request.params as { merchantId: string; environment: string };
    if (!options.dashboardPaymentLinks) {
      const failure = dashboardError('internal_error', request.id);
      return reply.code(failure.status).send(failure.body);
    }
    const result = await options.dashboardPaymentLinks.create({
      authorization: authorizationHeader(request.headers.authorization),
      merchantId: params.merchantId,
      environment: params.environment,
      idempotencyKey: idempotencyHeader(request.headers['idempotency-key']),
      request: request.body,
    });
    if (kind(result) === 'created' && typeof result.replayed === 'boolean' && result.paymentLink !== undefined) {
      reply.header('cache-control', 'private, no-store');
      return reply.code(result.replayed ? 200 : 201).send(result.paymentLink);
    }
    const failure = dashboardError(kind(result), request.id);
    return reply.code(failure.status).send(failure.body);
  });

  app.post(`${dashboardBase}/:paymentLinkId/disable`, async (request, reply) => {
    const params = request.params as { merchantId: string; environment: string; paymentLinkId: string };
    if (!options.dashboardPaymentLinks) {
      const failure = dashboardError('internal_error', request.id);
      return reply.code(failure.status).send(failure.body);
    }
    const result = await options.dashboardPaymentLinks.disable({
      authorization: authorizationHeader(request.headers.authorization),
      merchantId: params.merchantId,
      environment: params.environment,
      paymentLinkId: params.paymentLinkId,
      idempotencyKey: idempotencyHeader(request.headers['idempotency-key']),
      request: request.body,
    });
    if (kind(result) === 'ok' && result.paymentLink !== undefined) {
      reply.header('cache-control', 'private, no-store');
      return reply.code(200).send(result.paymentLink);
    }
    const failure = dashboardError(kind(result), request.id);
    return reply.code(failure.status).send(failure.body);
  });

  app.get('/checkout/v1/payment-links/:publicToken', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const params = request.params as { publicToken: string };
    if (!options.hostedCheckout) {
      const failure = checkoutError('internal_error', request.id);
      return reply.code(failure.status).send(failure.body);
    }
    const result = await options.hostedCheckout.getLink(params.publicToken);
    if (kind(result) === 'ok' && result.link !== undefined) return reply.code(200).send(result.link);
    const failure = checkoutError(kind(result), request.id);
    return reply.code(failure.status).send(failure.body);
  });

  app.post('/checkout/v1/payment-links/:publicToken/payments', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const params = request.params as { publicToken: string };
    if (!options.hostedCheckout) {
      const failure = checkoutError('internal_error', request.id);
      return reply.code(failure.status).send(failure.body);
    }
    const result = await options.hostedCheckout.createPayment({
      publicToken: params.publicToken,
      idempotencyKey: request.headers['idempotency-key'],
      request: request.body,
    });
    if (kind(result) === 'ok'
        && (result.httpStatus === 201 || result.httpStatus === 202)
        && result.payment !== undefined) {
      return reply.code(result.httpStatus).send(result.payment);
    }
    const failure = checkoutError(kind(result), request.id);
    return reply.code(failure.status).send(failure.body);
  });

  return app;
}
