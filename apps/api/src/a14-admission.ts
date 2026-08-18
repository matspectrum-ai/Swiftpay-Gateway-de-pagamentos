import type {
  ApiAbuseControls,
  MachineAbusePolicy,
  NetworkAbusePolicy,
} from '../../../packages/abuse/dist/index.js';
import type { MachinePrincipal } from '@swiftpay/auth';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const MACHINE_ROUTES = new Set([
  'POST /v1/transactions',
  'GET /v1/transactions/:id',
  'GET /v1/balance',
]);

function routeTemplate(request: FastifyRequest): string {
  return request.routeOptions.url ?? '<unmatched>';
}

function routeKey(request: FastifyRequest): string {
  return `${request.method.toUpperCase()} ${routeTemplate(request)}`;
}

function networkPolicy(request: FastifyRequest): NetworkAbusePolicy | null {
  const key = routeKey(request);
  if (key === 'POST /v1/auth/token') return 'token_exchange_pre_auth';
  if (MACHINE_ROUTES.has(key)) return 'machine_request_pre_auth';
  if (routeTemplate(request).startsWith('/dashboard/v1/')) return 'dashboard_request_pre_auth';
  if (key === 'GET /health/ready') return 'readiness_probe';
  return null;
}

function controlledCache(policy: NetworkAbusePolicy | MachineAbusePolicy): string {
  return policy === 'token_exchange_pre_auth' || policy === 'readiness_probe'
    ? 'no-store'
    : 'private, no-store';
}

function invalidOrigin(reply: FastifyReply, requestId: string, cacheControl: string) {
  reply.header('cache-control', cacheControl);
  return reply.code(400).send({
    error: {
      code: 'invalid_request_origin',
      message: 'Request origin is invalid.',
      requestId,
    },
  });
}

function admissionFailure(
  reply: FastifyReply,
  requestId: string,
  cacheControl: string,
  result: { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number } | { readonly kind: 'unavailable' },
) {
  reply.header('cache-control', cacheControl);
  if (result.kind === 'rate_limited') {
    reply.header('retry-after', String(result.retryAfterSeconds));
    return reply.code(429).send({
      error: {
        code: 'rate_limit_exceeded',
        message: 'Request rate limit exceeded.',
        requestId,
      },
    });
  }
  return reply.code(503).send({
    error: {
      code: 'request_admission_unavailable',
      message: 'Request admission is unavailable.',
      requestId,
    },
  });
}

export interface A14NetworkAdmission {
  clientIp(request: FastifyRequest): string | null;
}

export function installA14NetworkAdmission(
  app: FastifyInstance,
  controls: ApiAbuseControls | undefined,
): A14NetworkAdmission {
  const clientIps = new WeakMap<FastifyRequest, string>();

  if (controls !== undefined) {
    app.addHook('preHandler', async (request, reply) => {
      const policy = networkPolicy(request);
      if (policy === null) return;
      const cacheControl = controlledCache(policy);
      const clientIp = controls.resolveClientIp({
        remoteAddress: request.raw.socket.remoteAddress,
        xForwardedFor: request.headers['x-forwarded-for'],
      });
      if (clientIp === null) {
        return invalidOrigin(reply, request.id, cacheControl);
      }
      clientIps.set(request, clientIp);
      const result = await controls.admitNetwork({ policy, clientIp });
      if (result.kind !== 'allowed') {
        return admissionFailure(reply, request.id, cacheControl, result);
      }
    });
  }

  return Object.freeze({
    clientIp(request: FastifyRequest): string | null {
      return clientIps.get(request) ?? null;
    },
  });
}

export async function admitA14MachineRequest(
  controls: ApiAbuseControls | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
  principal: MachinePrincipal,
  policy: MachineAbusePolicy,
): Promise<boolean> {
  if (controls === undefined) return true;
  const result = await controls.admitMachine({
    policy,
    merchantId: principal.merchantId,
    environment: principal.environment,
  });
  if (result.kind === 'allowed') return true;
  admissionFailure(reply, request.id, controlledCache(policy), result);
  return false;
}
