import {
  createDashboardWebhookEndpointManagementService as createBaseManagementService,
} from './a7.js';

type ManagementInput = Parameters<typeof createBaseManagementService>[0];
type ManagementService = ReturnType<typeof createBaseManagementService>;

function expectedRevisionFrom(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const request = (value as { request?: unknown }).request;
  if (typeof request !== 'object' || request === null || Array.isArray(request)) return null;
  const expected = (request as Record<string, unknown>).expectedRevision;
  return Number.isSafeInteger(expected) && (expected as number) > 0 ? expected as number : null;
}

/**
 * A7 rotation wrapper.
 *
 * The database mutation is the canonical concurrency + idempotency authority.
 * The base service needs the current secret version to build an RSA OAEP label,
 * but its local revision pre-check would otherwise reject a completed replay
 * after the first rotation incremented the endpoint revision. For a syntactically
 * valid request we therefore preserve the real current secretVersion while
 * presenting the requested revision only to that local optimization. The frozen
 * RPC still locks the row, checks the real revision for new requests, and checks
 * idempotency before concurrency for completed replays.
 */
export function createDashboardWebhookEndpointManagementService(
  input: ManagementInput,
): ManagementService {
  const base = createBaseManagementService(input);

  return {
    ...base,
    async rotateSecret(value) {
      const expectedRevision = expectedRevisionFrom(value);
      if (expectedRevision === null) return base.rotateSecret(value);

      const store = {
        ...input.store,
        async get(args: Parameters<typeof input.store.get>[0]) {
          const current = await input.store.get(args);
          return current === null ? null : { ...current, revision: expectedRevision };
        },
      };

      return createBaseManagementService({ ...input, store }).rotateSecret(value);
    },
  };
}
