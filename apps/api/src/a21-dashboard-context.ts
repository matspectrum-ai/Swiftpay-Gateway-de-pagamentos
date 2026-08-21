import type { FastifyInstance } from 'fastify';
import type { BuildAppOptions } from './app.js';

export interface DashboardContextDiscoveryHttpService {
  list(authorization: unknown): Promise<Record<string, unknown>>;
}

function kind(result: Record<string, unknown>): string {
  return typeof result.kind === 'string' ? result.kind : 'internal_error';
}

function publicError(resultKind: string, requestId: string) {
  switch (resultKind) {
    case 'invalid_session':
      return {
        status: 401 as const,
        body: { error: { code: 'invalid_dashboard_session', message: 'Invalid dashboard session.', requestId } },
      };
    case 'authentication_unavailable':
      return {
        status: 503 as const,
        body: { error: { code: 'dashboard_authentication_unavailable', message: 'Dashboard authentication is unavailable.', requestId } },
      };
    default:
      return {
        status: 500 as const,
        body: { error: { code: 'internal_error', message: 'Dashboard context discovery failed.', requestId } },
      };
  }
}

export function registerDashboardContextDiscoveryRoute(
  app: FastifyInstance,
  options: BuildAppOptions,
): void {
  app.get('/dashboard/v1/contexts', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const service = options.dashboardContextDiscovery;
    if (!service) {
      const failure = publicError('internal_error', request.id);
      return reply.code(failure.status).send(failure.body);
    }

    try {
      const result = await service.list(request.headers.authorization);
      if (kind(result) === 'ok') {
        const contexts = Array.isArray(result.contexts) ? result.contexts : [];
        return reply.code(200).send({ object: 'list', data: contexts });
      }
      const failure = publicError(kind(result), request.id);
      return reply.code(failure.status).send(failure.body);
    } catch {
      const failure = publicError('internal_error', request.id);
      return reply.code(failure.status).send(failure.body);
    }
  });
}
