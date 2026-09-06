import type { RuntimePool } from './core.js';

type QueryOnlyPool = Pick<RuntimePool, 'query'>;
export type GatewayEnvironment = 'sandbox' | 'production';

export type GatewayResourceStoreErrorKind =
  | 'validation_error'
  | 'idempotency_conflict'
  | 'forbidden'
  | 'unsupported'
  | 'internal_error';

export class GatewayResourceStoreError extends Error {
  readonly kind: GatewayResourceStoreErrorKind;
  constructor(kind: GatewayResourceStoreErrorKind) {
    super(`Gateway resource store failed: ${kind}`);
    this.name = 'GatewayResourceStoreError';
    this.kind = kind;
  }
}

export interface GatewayResourceStore {
  listAccounts(input: { merchantId: string; environment: GatewayEnvironment }): Promise<unknown[]>;
  listAccountStatement(input: {
    merchantId: string;
    environment: GatewayEnvironment;
    accountId: string;
    limit: number;
  }): Promise<unknown[]>;
  createSandboxPayout(input: {
    merchantId: string;
    environment: GatewayEnvironment;
    amountCents: number;
    destination: Record<string, unknown>;
    externalRef?: string | null;
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<Record<string, unknown>>;
  listPayouts(input: {
    merchantId: string;
    environment: GatewayEnvironment;
    state?: string | null;
    limit: number;
  }): Promise<unknown[]>;
  getPayout(input: { merchantId: string; payoutId: string }): Promise<Record<string, unknown> | null>;
  createCustomer(input: {
    merchantId: string;
    organizationId?: string | null;
    idempotencyKey: string;
    requestFingerprint: string;
    payload: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  listCustomers(input: { merchantId: string; organizationId?: string | null; limit: number }): Promise<unknown[]>;
  getCustomer(input: { merchantId: string; customerId: string }): Promise<Record<string, unknown> | null>;
  updateCustomer(input: {
    merchantId: string;
    customerId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    payload: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
}

interface JsonResultRow { result: unknown }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new GatewayResourceStoreError('internal_error');
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new GatewayResourceStoreError('internal_error');
  return value;
}

function pgKind(error: unknown): GatewayResourceStoreErrorKind {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  if (code === '23514' || code === '22P02') return 'validation_error';
  if (code === '23505') return 'idempotency_conflict';
  if (code === '42501') return 'forbidden';
  if (code === '0A000') return 'unsupported';
  return 'internal_error';
}

async function one(pool: QueryOnlyPool, sql: string, values: readonly unknown[]): Promise<unknown> {
  try {
    const result = await pool.query<JsonResultRow>(sql, values as unknown[]);
    return result.rows[0]?.result ?? null;
  } catch (error) {
    throw new GatewayResourceStoreError(pgKind(error));
  }
}

export function createGatewayResourceStore(pool: QueryOnlyPool): GatewayResourceStore {
  return {
    async listAccounts(input) {
      return asArray(await one(pool, 'select app.list_api_accounts($1::uuid,$2::text) as result', [input.merchantId, input.environment]));
    },
    async listAccountStatement(input) {
      return asArray(await one(
        pool,
        'select app.list_api_account_statement($1::uuid,$2::text,$3::uuid,$4::integer) as result',
        [input.merchantId, input.environment, input.accountId, input.limit],
      ));
    },
    async createSandboxPayout(input) {
      return asRecord(await one(
        pool,
        'select app.create_api_sandbox_payout($1::uuid,$2::text,$3::bigint,$4::jsonb,$5::text,$6::text,$7::text) as result',
        [
          input.merchantId,
          input.environment,
          input.amountCents,
          JSON.stringify(input.destination),
          input.externalRef ?? null,
          input.idempotencyKey,
          input.requestFingerprint,
        ],
      ));
    },
    async listPayouts(input) {
      return asArray(await one(
        pool,
        'select app.list_api_payouts($1::uuid,$2::text,$3::text,$4::integer) as result',
        [input.merchantId, input.environment, input.state ?? null, input.limit],
      ));
    },
    async getPayout(input) {
      const value = await one(pool, 'select app.get_api_payout($1::uuid,$2::uuid) as result', [input.merchantId, input.payoutId]);
      return value === null ? null : asRecord(value);
    },
    async createCustomer(input) {
      return asRecord(await one(
        pool,
        'select app.create_api_customer($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) as result',
        [input.merchantId, input.organizationId ?? null, input.idempotencyKey, input.requestFingerprint, JSON.stringify(input.payload)],
      ));
    },
    async listCustomers(input) {
      return asArray(await one(
        pool,
        'select app.list_api_customers($1::uuid,$2::uuid,$3::integer) as result',
        [input.merchantId, input.organizationId ?? null, input.limit],
      ));
    },
    async getCustomer(input) {
      const value = await one(pool, 'select app.get_api_customer($1::uuid,$2::uuid) as result', [input.merchantId, input.customerId]);
      return value === null ? null : asRecord(value);
    },
    async updateCustomer(input) {
      const value = await one(
        pool,
        'select app.update_api_customer($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb) as result',
        [input.merchantId, input.customerId, input.idempotencyKey, input.requestFingerprint, JSON.stringify(input.payload)],
      );
      return value === null ? null : asRecord(value);
    },
  };
}
