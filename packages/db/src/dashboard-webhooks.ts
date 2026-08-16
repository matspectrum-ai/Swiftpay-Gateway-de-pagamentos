import type pg from 'pg';

export type DashboardWebhookEnvironment = 'sandbox' | 'production';

export interface DashboardWebhookEndpointProjection {
  readonly id: string;
  readonly merchantId: string;
  readonly environment: DashboardWebhookEnvironment;
  readonly url: string;
  readonly status: 'active' | 'disabled';
  readonly subscribedEvents: readonly ['payment.paid'];
  readonly secretVersion: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type QueryOnlyPool = Pick<pg.Pool, 'query'>;

export class DashboardWebhookEndpointStoreError extends Error {
  constructor() {
    super('Dashboard webhook endpoint database operation failed');
    this.name = 'DashboardWebhookEndpointStoreError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/;

function invalid(): never {
  throw new DashboardWebhookEndpointStoreError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function endpoint(value: unknown): DashboardWebhookEndpointProjection {
  if (!isRecord(value) || !exactKeys(value, [
    'id','merchantId','environment','url','status','subscribedEvents',
    'secretVersion','revision','createdAt','updatedAt',
  ])) invalid();
  if (typeof value.id !== 'string' || !UUID_RE.test(value.id)
      || typeof value.merchantId !== 'string' || !UUID_RE.test(value.merchantId)
      || (value.environment !== 'sandbox' && value.environment !== 'production')
      || typeof value.url !== 'string' || value.url.length < 1 || value.url.length > 2048
      || (value.status !== 'active' && value.status !== 'disabled')
      || !Array.isArray(value.subscribedEvents)
      || value.subscribedEvents.length !== 1
      || value.subscribedEvents[0] !== 'payment.paid'
      || !Number.isSafeInteger(value.secretVersion) || (value.secretVersion as number) < 1
      || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
      || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) invalid();
  return value as unknown as DashboardWebhookEndpointProjection;
}

function validBase(value: { userId: string; merchantId: string; environment: DashboardWebhookEnvironment }): void {
  if (!UUID_RE.test(value.userId) || !UUID_RE.test(value.merchantId)
      || (value.environment !== 'sandbox' && value.environment !== 'production')) invalid();
}

function validMutation(value: {
  userId: string;
  merchantId: string;
  environment: DashboardWebhookEnvironment;
  idempotencyKey: string;
  requestHash: string;
  command: Record<string, unknown>;
  endpointId?: string;
}): void {
  validBase(value);
  if (value.endpointId !== undefined && !UUID_RE.test(value.endpointId)) invalid();
  if (typeof value.idempotencyKey !== 'string' || value.idempotencyKey.trim().length < 1 || value.idempotencyKey.trim().length > 160
      || !HEX64_RE.test(value.requestHash)
      || !isRecord(value.command)) invalid();
}

function mutation(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.kind !== 'string') invalid();
  const allowed = new Set([
    'created','ok','resource_not_found','resource_conflict','idempotency_conflict',
    'idempotency_in_progress','endpoint_limit_reached','validation_error','internal_error',
  ]);
  if (!allowed.has(value.kind)) invalid();
  if (value.kind === 'created' || value.kind === 'ok') {
    if (typeof value.replayed !== 'boolean') invalid();
    endpoint(value.endpoint);
    if (!exactKeys(value, ['kind','replayed','endpoint'])) invalid();
  } else if (!exactKeys(value, ['kind'])) invalid();
  return value;
}

const LIST_SQL = `
select endpoint
from app.list_dashboard_webhook_endpoints($1::uuid,$2::uuid,$3::text) as endpoint
`;
const GET_SQL = `select app.get_dashboard_webhook_endpoint($1::uuid,$2::uuid,$3::text,$4::uuid) as endpoint`;
const CREATE_SQL = `select app.create_dashboard_webhook_endpoint($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::jsonb) as result`;
const UPDATE_SQL = `select app.update_dashboard_webhook_endpoint($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb) as result`;
const DISABLE_SQL = `select app.disable_dashboard_webhook_endpoint($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb) as result`;
const ENABLE_SQL = `select app.enable_dashboard_webhook_endpoint($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb) as result`;
const ROTATE_SQL = `select app.rotate_dashboard_webhook_endpoint_secret($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb) as result`;

export function createDashboardWebhookEndpointStore(pool: QueryOnlyPool) {
  async function mutate(
    sql: string,
    value: {
      userId: string;
      merchantId: string;
      environment: DashboardWebhookEnvironment;
      idempotencyKey: string;
      requestHash: string;
      command: Record<string, unknown>;
      endpointId?: string;
    },
  ) {
    validMutation(value);
    const params = value.endpointId === undefined
      ? [value.userId, value.merchantId, value.environment, value.idempotencyKey.trim(), value.requestHash, value.command]
      : [value.userId, value.merchantId, value.environment, value.endpointId, value.idempotencyKey.trim(), value.requestHash, value.command];
    try {
      const result = await pool.query<{ result: unknown }>(sql, params);
      return mutation(result.rows[0]?.result);
    } catch (error) {
      if (error instanceof DashboardWebhookEndpointStoreError) throw error;
      throw new DashboardWebhookEndpointStoreError();
    }
  }

  return {
    async list(value: { userId: string; merchantId: string; environment: DashboardWebhookEnvironment }) {
      validBase(value);
      try {
        const result = await pool.query<{ endpoint: unknown }>(LIST_SQL, [value.userId, value.merchantId, value.environment]);
        return result.rows.map((row) => endpoint(row.endpoint));
      } catch (error) {
        if (error instanceof DashboardWebhookEndpointStoreError) throw error;
        throw new DashboardWebhookEndpointStoreError();
      }
    },

    async get(value: { userId: string; merchantId: string; environment: DashboardWebhookEnvironment; endpointId: string }) {
      validBase(value);
      if (!UUID_RE.test(value.endpointId)) invalid();
      try {
        const result = await pool.query<{ endpoint: unknown }>(GET_SQL, [value.userId, value.merchantId, value.environment, value.endpointId]);
        const row = result.rows[0]?.endpoint;
        return row === null || row === undefined ? null : endpoint(row);
      } catch (error) {
        if (error instanceof DashboardWebhookEndpointStoreError) throw error;
        throw new DashboardWebhookEndpointStoreError();
      }
    },

    create(value: { userId:string; merchantId:string; environment:DashboardWebhookEnvironment; idempotencyKey:string; requestHash:string; command:Record<string,unknown> }) {
      return mutate(CREATE_SQL, value);
    },
    update(value: { userId:string; merchantId:string; environment:DashboardWebhookEnvironment; endpointId:string; idempotencyKey:string; requestHash:string; command:Record<string,unknown> }) {
      return mutate(UPDATE_SQL, value);
    },
    disable(value: { userId:string; merchantId:string; environment:DashboardWebhookEnvironment; endpointId:string; idempotencyKey:string; requestHash:string; command:Record<string,unknown> }) {
      return mutate(DISABLE_SQL, value);
    },
    enable(value: { userId:string; merchantId:string; environment:DashboardWebhookEnvironment; endpointId:string; idempotencyKey:string; requestHash:string; command:Record<string,unknown> }) {
      return mutate(ENABLE_SQL, value);
    },
    rotateSecret(value: { userId:string; merchantId:string; environment:DashboardWebhookEnvironment; endpointId:string; idempotencyKey:string; requestHash:string; command:Record<string,unknown> }) {
      return mutate(ROTATE_SQL, value);
    },
  };
}
