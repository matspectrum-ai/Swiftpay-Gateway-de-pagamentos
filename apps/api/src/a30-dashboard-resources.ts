import type { DashboardMerchantContextStore, GatewayResourceStore } from '@swiftpay/db';
import { createHash } from 'node:crypto';

type SessionResult =
  | { readonly kind: 'authenticated'; readonly principal: { readonly userId: string } }
  | { readonly kind: 'invalid_session' }
  | { readonly kind: 'authentication_unavailable' };
type SessionVerifier = (authorization: unknown) => Promise<SessionResult>;
type Environment = 'sandbox' | 'production';
type Role = 'member' | 'admin' | 'owner';

export interface A30DashboardResourcesService {
  listAccounts(input: BaseInput): Promise<Record<string, unknown>>;
  listAccountStatement(input: BaseInput & { readonly accountId: string; readonly limit?: unknown }): Promise<Record<string, unknown>>;
  listPayouts(input: BaseInput & { readonly state?: unknown; readonly limit?: unknown }): Promise<Record<string, unknown>>;
  createPayout(input: BaseInput & { readonly idempotencyKey?: unknown; readonly request: unknown }): Promise<Record<string, unknown>>;
  listCustomers(input: BaseInput & { readonly organizationId?: unknown; readonly limit?: unknown }): Promise<Record<string, unknown>>;
  getCustomer(input: BaseInput & { readonly customerId: string }): Promise<Record<string, unknown>>;
  createCustomer(input: BaseInput & { readonly idempotencyKey?: unknown; readonly request: unknown }): Promise<Record<string, unknown>>;
  updateCustomer(input: BaseInput & { readonly customerId: string; readonly idempotencyKey?: unknown; readonly request: unknown }): Promise<Record<string, unknown>>;
}

interface BaseInput {
  readonly authorization?: string | undefined;
  readonly merchantId: string;
  readonly environment: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function fingerprint(namespace: string, merchantId: string, environment: Environment, value: unknown): string {
  return createHash('sha256')
    .update(`${namespace}\n${merchantId.toLowerCase()}\n${environment}\n${JSON.stringify(stable(value))}`, 'utf8')
    .digest('hex');
}

function environment(value: string): Environment | null {
  return value === 'sandbox' || value === 'production' ? value : null;
}

function key(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 200 ? normalized : null;
}

function pageLimit(value: unknown): number | null {
  if (value === undefined) return 50;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

async function authorize(
  verifier: SessionVerifier,
  contexts: DashboardMerchantContextStore,
  input: BaseInput,
  requiredRole: Role,
): Promise<{ readonly kind: 'authorized'; readonly userId: string; readonly environment: Environment } | { readonly kind: string }> {
  const env = environment(input.environment);
  if (!UUID.test(input.merchantId) || env === null) return { kind: 'validation_error' };
  const session = await verifier(input.authorization);
  if (session.kind !== 'authenticated') return session;
  const context = await contexts.requireContext({
    userId: session.principal.userId,
    merchantId: input.merchantId,
    environment: env,
    requiredRole,
  });
  if (context.kind !== 'authorized') return context;
  return { kind: 'authorized', userId: session.principal.userId, environment: env };
}

function storeFailure(error: unknown): Record<string, unknown> {
  if (typeof error === 'object' && error !== null && 'kind' in error && typeof (error as { kind?: unknown }).kind === 'string') {
    return { kind: (error as { kind: string }).kind };
  }
  return { kind: 'internal_error' };
}

function customerPayload(value: unknown): Record<string, unknown> | null {
  const body = record(value);
  if (body === null) return null;
  const allowed = new Set(['organization_id', 'external_ref', 'name', 'document', 'email', 'phone', 'metadata']);
  if (Object.keys(body).some((field) => !allowed.has(field))) return null;
  if ('organization_id' in body && optionalString(body.organization_id) === undefined) return null;
  if ('metadata' in body && record(body.metadata) === null) return null;
  return body;
}

export function createA30DashboardResourcesService(options: {
  readonly sessionVerifier: SessionVerifier;
  readonly contextStore: DashboardMerchantContextStore;
  readonly store: GatewayResourceStore;
}): A30DashboardResourcesService {
  return {
    async listAccounts(input) {
      try {
        const auth = await authorize(options.sessionVerifier, options.contextStore, input, 'member');
        if (auth.kind !== 'authorized') return auth;
        return { kind: 'ok', data: await options.store.listAccounts({ merchantId: input.merchantId, environment: auth.environment }) };
      } catch (error) { return storeFailure(error); }
    },

    async listAccountStatement(input) {
      const limit = pageLimit(input.limit);
      if (!UUID.test(input.accountId) || limit === null) return { kind: 'validation_error' };
      try {
        const auth = await authorize(options.sessionVerifier, options.contextStore, input, 'member');
        if (auth.kind !== 'authorized') return auth;
        return { kind: 'ok', data: await options.store.listAccountStatement({
          merchantId: input.merchantId,
          environment: auth.environment,
          accountId: input.accountId,
          limit,
        }) };
      } catch (error) { return storeFailure(error); }
    },

    async listPayouts(input) {
      const limit = pageLimit(input.limit);
      const state = optionalString(input.state);
      if (limit === null || (input.state !== undefined && state === undefined)) return { kind: 'validation_error' };
      try {
        const auth = await authorize(options.sessionVerifier, options.contextStore, input, 'member');
        if (auth.kind !== 'authorized') return auth;
        return { kind: 'ok', data: await options.store.listPayouts({
          merchantId: input.merchantId,
          environment: auth.environment,
          state: state ?? null,
          limit,
        }) };
      } catch (error) { return storeFailure(error); }
    },

    async createPayout(input) {
      const idempotencyKey = key(input.idempotencyKey);
      const body = record(input.request);
      if (idempotencyKey === null || body === null) return { kind: 'validation_error' };
      if (!Number.isSafeInteger(body.amount_cents) || (body.amount_cents as number) <= 0) return { kind: 'validation_error' };
      const destination = record(body.destination);
      if (destination === null || destination.type !== 'pix' || typeof destination.key_type !== 'string'
          || typeof destination.key !== 'string' || destination.key.trim().length === 0) return { kind: 'validation_error' };
      try {
        const auth = await authorize(options.sessionVerifier, options.contextStore, input, 'admin');
        if (auth.kind !== 'authorized') return auth;
        if (auth.environment !== 'sandbox') return { kind: 'forbidden' };
        const semantic = {
          amount_cents: body.amount_cents,
          destination: { type: 'pix', key_type: destination.key_type, key: destination.key },
          external_ref: optionalString(body.external_ref) ?? null,
        };
        return { kind: 'created', payout: await options.store.createSandboxPayout({
          merchantId: input.merchantId,
          environment: auth.environment,
          amountCents: body.amount_cents as number,
          destination,
          externalRef: optionalString(body.external_ref) ?? null,
          idempotencyKey,
          requestFingerprint: fingerprint('a30-dashboard-payout-create-v0', input.merchantId, auth.environment, semantic),
        }) };
      } catch (error) { return storeFailure(error); }
    },

    async listCustomers(input) {
      const limit = pageLimit(input.limit);
      const organizationId = optionalString(input.organizationId);
      if (limit === null || (input.organizationId !== undefined && organizationId === undefined)) return { kind: 'validation_error' };
      if (organizationId !== null && organizationId !== undefined && !UUID.test(organizationId)) return { kind: 'validation_error' };
      try {
        const auth = await authorize(options.sessionVerifier, options.contextStore, input, 'member');
        if (auth.kind !== 'authorized') return auth;
        return { kind: 'ok', data: await options.store.listCustomers({
          merchantId: input.merchantId,
          ...(organizationId === undefined ? {} : { organizationId }),
          limit,
        }) };
      } catch (error) { return storeFailure(error); }
    },

    async getCustomer(input) {
      if (!UUID.test(input.customerId)) return { kind: 'validation_error' };
      try {
        const auth = await authorize(options.sessionVerifier, options.contextStore, input, 'member');
        if (auth.kind !== 'authorized') return auth;
        const customer = await options.store.getCustomer({ merchantId: input.merchantId, customerId: input.customerId });
        return customer === null ? { kind: 'resource_not_found' } : { kind: 'ok', customer };
      } catch (error) { return storeFailure(error); }
    },

    async createCustomer(input) {
      const idempotencyKey = key(input.idempotencyKey);
      const body = customerPayload(input.request);
      if (idempotencyKey === null || body === null) return { kind: 'validation_error' };
      try {
        const auth = await authorize(options.sessionVerifier, options.contextStore, input, 'admin');
        if (auth.kind !== 'authorized') return auth;
        const organizationId = optionalString(body.organization_id);
        return { kind: 'created', customer: await options.store.createCustomer({
          merchantId: input.merchantId,
          ...(organizationId === undefined ? {} : { organizationId }),
          idempotencyKey,
          requestFingerprint: fingerprint('a30-dashboard-customer-create-v0', input.merchantId, auth.environment, body),
          payload: body,
        }) };
      } catch (error) { return storeFailure(error); }
    },

    async updateCustomer(input) {
      const idempotencyKey = key(input.idempotencyKey);
      const body = customerPayload(input.request);
      if (!UUID.test(input.customerId) || idempotencyKey === null || body === null || Object.keys(body).length === 0) return { kind: 'validation_error' };
      try {
        const auth = await authorize(options.sessionVerifier, options.contextStore, input, 'admin');
        if (auth.kind !== 'authorized') return auth;
        const customer = await options.store.updateCustomer({
          merchantId: input.merchantId,
          customerId: input.customerId,
          idempotencyKey,
          requestFingerprint: fingerprint(`a30-dashboard-customer-update-v0:${input.customerId}`, input.merchantId, auth.environment, body),
          payload: body,
        });
        return customer === null ? { kind: 'resource_not_found' } : { kind: 'ok', customer };
      } catch (error) { return storeFailure(error); }
    },
  };
}
