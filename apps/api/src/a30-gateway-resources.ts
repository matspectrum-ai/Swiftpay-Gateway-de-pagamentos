import type { MachinePrincipal } from '@swiftpay/auth';
import {
  GatewayResourceStoreError,
  type GatewayResourceStore,
} from '@swiftpay/db';
import { createHash } from 'node:crypto';

export interface A30GatewayResourcesService {
  listAccounts(input: { principal: MachinePrincipal }): Promise<Record<string, unknown>>;
  listAccountStatement(input: { principal: MachinePrincipal; accountId: string; query: unknown }): Promise<Record<string, unknown>>;
  createPayout(input: { principal: MachinePrincipal; idempotencyKey: unknown; request: unknown }): Promise<Record<string, unknown>>;
  listPayouts(input: { principal: MachinePrincipal; query: unknown }): Promise<Record<string, unknown>>;
  getPayout(input: { principal: MachinePrincipal; payoutId: string }): Promise<Record<string, unknown>>;
  createCustomer(input: { principal: MachinePrincipal; idempotencyKey: unknown; request: unknown }): Promise<Record<string, unknown>>;
  listCustomers(input: { principal: MachinePrincipal; query: unknown }): Promise<Record<string, unknown>>;
  getCustomer(input: { principal: MachinePrincipal; customerId: string }): Promise<Record<string, unknown>>;
  updateCustomer(input: { principal: MachinePrincipal; customerId: string; idempotencyKey: unknown; request: unknown }): Promise<Record<string, unknown>>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  const object = record(value);
  if (object === null) return value;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, stable(object[key])]));
}

function fingerprint(operation: string, value: unknown): string {
  return createHash('sha256')
    .update(`${operation}\n${JSON.stringify(stable(value))}`, 'utf8')
    .digest('hex');
}

function idempotency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key.length > 0 && key.length <= 200 ? key : null;
}

function limit(query: unknown): number {
  const value = record(query)?.limit;
  if (value === undefined) return 50;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 50;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function failure(error: unknown): Record<string, unknown> {
  if (error instanceof GatewayResourceStoreError) return { kind: error.kind };
  return { kind: 'internal_error' };
}

function customerPayload(request: unknown): { payload: Record<string, unknown>; organizationId?: string | null } | null {
  const body = record(request);
  if (body === null) return null;
  const allowed = ['organization_id', 'external_ref', 'name', 'document', 'email', 'phone', 'metadata'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return null;
  if ('metadata' in body && record(body.metadata) === null) return null;
  const organizationId = optionalString(body.organization_id);
  if (body.organization_id !== undefined && organizationId === undefined) return null;
  return {
    payload: body,
    ...(organizationId === undefined ? {} : { organizationId }),
  };
}

export function createA30GatewayResourcesService(store: GatewayResourceStore): A30GatewayResourcesService {
  return {
    async listAccounts({ principal }) {
      try {
        const data = await store.listAccounts({ merchantId: principal.merchantId, environment: principal.environment });
        return { kind: 'ok', data };
      } catch (error) {
        return failure(error);
      }
    },

    async listAccountStatement({ principal, accountId, query }) {
      if (typeof accountId !== 'string' || accountId.length < 1) return { kind: 'validation_error' };
      try {
        const data = await store.listAccountStatement({
          merchantId: principal.merchantId,
          environment: principal.environment,
          accountId,
          limit: limit(query),
        });
        return { kind: 'ok', data };
      } catch (error) {
        return failure(error);
      }
    },

    async createPayout({ principal, idempotencyKey, request }) {
      const key = idempotency(idempotencyKey);
      const body = record(request);
      if (key === null || body === null) return { kind: 'validation_error' };
      if (principal.environment !== 'sandbox') return { kind: 'operation_forbidden', reason: 'production_payout_not_enabled' };
      if (!Number.isSafeInteger(body.amount_cents) || (body.amount_cents as number) <= 0) return { kind: 'validation_error' };
      const destination = record(body.destination);
      if (destination === null || destination.type !== 'pix') return { kind: 'validation_error' };
      if (typeof destination.key_type !== 'string' || typeof destination.key !== 'string' || destination.key.trim().length === 0) {
        return { kind: 'validation_error' };
      }
      const semantic = {
        amount_cents: body.amount_cents,
        destination: { type: 'pix', key_type: destination.key_type, key: destination.key },
        external_ref: optionalString(body.external_ref) ?? null,
      };
      try {
        const payout = await store.createSandboxPayout({
          merchantId: principal.merchantId,
          environment: principal.environment,
          amountCents: body.amount_cents as number,
          destination,
          externalRef: optionalString(body.external_ref) ?? null,
          idempotencyKey: key,
          requestFingerprint: fingerprint('payout.create', semantic),
        });
        return { kind: 'created', payout };
      } catch (error) {
        return failure(error);
      }
    },

    async listPayouts({ principal, query }) {
      const stateValue = optionalString(record(query)?.state);
      if (record(query)?.state !== undefined && stateValue === undefined) return { kind: 'validation_error' };
      try {
        const data = await store.listPayouts({
          merchantId: principal.merchantId,
          environment: principal.environment,
          state: stateValue ?? null,
          limit: limit(query),
        });
        return { kind: 'ok', data };
      } catch (error) {
        return failure(error);
      }
    },

    async getPayout({ principal, payoutId }) {
      try {
        const payout = await store.getPayout({ merchantId: principal.merchantId, payoutId });
        return payout === null ? { kind: 'resource_not_found' } : { kind: 'ok', payout };
      } catch (error) {
        return failure(error);
      }
    },

    async createCustomer({ principal, idempotencyKey, request }) {
      const key = idempotency(idempotencyKey);
      const parsed = customerPayload(request);
      if (key === null || parsed === null) return { kind: 'validation_error' };
      try {
        const customer = await store.createCustomer({
          merchantId: principal.merchantId,
          ...(parsed.organizationId === undefined ? {} : { organizationId: parsed.organizationId }),
          idempotencyKey: key,
          requestFingerprint: fingerprint('customer.create', parsed.payload),
          payload: parsed.payload,
        });
        return { kind: 'created', customer };
      } catch (error) {
        return failure(error);
      }
    },

    async listCustomers({ principal, query }) {
      const organizationId = optionalString(record(query)?.organization_id);
      if (record(query)?.organization_id !== undefined && organizationId === undefined) return { kind: 'validation_error' };
      try {
        const data = await store.listCustomers({
          merchantId: principal.merchantId,
          ...(organizationId === undefined ? {} : { organizationId }),
          limit: limit(query),
        });
        return { kind: 'ok', data };
      } catch (error) {
        return failure(error);
      }
    },

    async getCustomer({ principal, customerId }) {
      try {
        const customer = await store.getCustomer({ merchantId: principal.merchantId, customerId });
        return customer === null ? { kind: 'resource_not_found' } : { kind: 'ok', customer };
      } catch (error) {
        return failure(error);
      }
    },

    async updateCustomer({ principal, customerId, idempotencyKey, request }) {
      const key = idempotency(idempotencyKey);
      const parsed = customerPayload(request);
      if (key === null || parsed === null || Object.keys(parsed.payload).length === 0) return { kind: 'validation_error' };
      try {
        const customer = await store.updateCustomer({
          merchantId: principal.merchantId,
          customerId,
          idempotencyKey: key,
          requestFingerprint: fingerprint(`customer.update:${customerId}`, parsed.payload),
          payload: parsed.payload,
        });
        return customer === null ? { kind: 'resource_not_found' } : { kind: 'ok', customer };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
