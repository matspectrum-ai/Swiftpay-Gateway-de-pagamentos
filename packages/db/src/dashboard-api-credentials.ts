import type pg from 'pg';

export type DashboardApiCredentialEnvironment = 'sandbox' | 'production';

export interface DashboardApiCredentialProjection {
  readonly id: string;
  readonly merchantId: string;
  readonly environment: DashboardApiCredentialEnvironment;
  readonly name: string;
  readonly publicKey: string;
  readonly status: 'active' | 'revoked';
  readonly secretVersion: number;
  readonly revision: number;
  readonly ipAllowlist: readonly string[] | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  readonly revokedAt: string | null;
}

type QueryOnlyPool = Pick<pg.Pool, 'query'>;

export class DashboardApiCredentialStoreError extends Error {
  constructor() {
    super('Dashboard API credential database operation failed');
    this.name = 'DashboardApiCredentialStoreError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/;

function invalid(): never {
  throw new DashboardApiCredentialStoreError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function credential(value: unknown): DashboardApiCredentialProjection {
  if (!isRecord(value) || !exactKeys(value, [
    'id','merchantId','environment','name','publicKey','status','secretVersion','revision',
    'ipAllowlist','lastUsedAt','createdAt','rotatedAt','revokedAt',
  ])) invalid();
  if (typeof value.id !== 'string' || !UUID_RE.test(value.id)
      || typeof value.merchantId !== 'string' || !UUID_RE.test(value.merchantId)
      || (value.environment !== 'sandbox' && value.environment !== 'production')
      || typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 120
      || typeof value.publicKey !== 'string' || value.publicKey.length < 1 || value.publicKey.length > 160
      || (value.status !== 'active' && value.status !== 'revoked')
      || !Number.isSafeInteger(value.secretVersion) || (value.secretVersion as number) < 1
      || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
      || !(value.ipAllowlist === null || (Array.isArray(value.ipAllowlist) && value.ipAllowlist.every((entry) => typeof entry === 'string')))
      || !nullableTimestamp(value.lastUsedAt)
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
      || !nullableTimestamp(value.rotatedAt)
      || !nullableTimestamp(value.revokedAt)) invalid();
  return value as unknown as DashboardApiCredentialProjection;
}

function validBase(value: { userId: string; merchantId: string; environment: DashboardApiCredentialEnvironment }): void {
  if (!UUID_RE.test(value.userId) || !UUID_RE.test(value.merchantId)
      || (value.environment !== 'sandbox' && value.environment !== 'production')) invalid();
}

function validMutation(value: {
  userId: string;
  merchantId: string;
  environment: DashboardApiCredentialEnvironment;
  idempotencyKey: string;
  requestHash: string;
  command: Record<string, unknown>;
  credentialId?: string;
}): void {
  validBase(value);
  if (value.credentialId !== undefined && !UUID_RE.test(value.credentialId)) invalid();
  if (typeof value.idempotencyKey !== 'string' || value.idempotencyKey.trim().length < 1 || value.idempotencyKey.trim().length > 160
      || !HEX64_RE.test(value.requestHash) || !isRecord(value.command)) invalid();
}

function mutation(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || typeof value.kind !== 'string') invalid();
  const allowed = new Set([
    'created','ok','resource_not_found','resource_conflict','idempotency_conflict',
    'idempotency_in_progress','credential_limit_reached','validation_error','internal_error',
  ]);
  if (!allowed.has(value.kind)) invalid();
  if (value.kind === 'created' || value.kind === 'ok') {
    if (typeof value.replayed !== 'boolean') invalid();
    credential(value.credential);
    if (!exactKeys(value, ['kind','replayed','credential'])) invalid();
  } else if (!exactKeys(value, ['kind'])) invalid();
  return value;
}

const LIST_SQL = `
select credential
from app.list_dashboard_api_credentials($1::uuid,$2::uuid,$3::text) as credential
`;
const GET_SQL = `select app.get_dashboard_api_credential($1::uuid,$2::uuid,$3::text,$4::uuid) as credential`;
const CREATE_SQL = `select app.create_dashboard_api_credential($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::jsonb) as result`;
const ROTATE_SQL = `select app.rotate_dashboard_api_credential_secret($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb) as result`;
const REVOKE_SQL = `select app.revoke_dashboard_api_credential($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb) as result`;

export function createDashboardApiCredentialStore(pool: QueryOnlyPool) {
  async function mutate(
    sql: string,
    value: {
      userId: string;
      merchantId: string;
      environment: DashboardApiCredentialEnvironment;
      idempotencyKey: string;
      requestHash: string;
      command: Record<string, unknown>;
      credentialId?: string;
    },
  ) {
    validMutation(value);
    const params = value.credentialId === undefined
      ? [value.userId, value.merchantId, value.environment, value.idempotencyKey.trim(), value.requestHash, value.command]
      : [value.userId, value.merchantId, value.environment, value.credentialId, value.idempotencyKey.trim(), value.requestHash, value.command];
    try {
      const result = await pool.query<{ result: unknown }>(sql, params);
      return mutation(result.rows[0]?.result);
    } catch (error) {
      if (error instanceof DashboardApiCredentialStoreError) throw error;
      throw new DashboardApiCredentialStoreError();
    }
  }

  return {
    async list(value: { userId: string; merchantId: string; environment: DashboardApiCredentialEnvironment }) {
      validBase(value);
      try {
        const result = await pool.query<{ credential: unknown }>(LIST_SQL, [value.userId, value.merchantId, value.environment]);
        return result.rows.map((row) => credential(row.credential));
      } catch (error) {
        if (error instanceof DashboardApiCredentialStoreError) throw error;
        throw new DashboardApiCredentialStoreError();
      }
    },

    async get(value: { userId: string; merchantId: string; environment: DashboardApiCredentialEnvironment; credentialId: string }) {
      validBase(value);
      if (!UUID_RE.test(value.credentialId)) invalid();
      try {
        const result = await pool.query<{ credential: unknown }>(GET_SQL, [value.userId, value.merchantId, value.environment, value.credentialId]);
        const row = result.rows[0]?.credential;
        return row === null || row === undefined ? null : credential(row);
      } catch (error) {
        if (error instanceof DashboardApiCredentialStoreError) throw error;
        throw new DashboardApiCredentialStoreError();
      }
    },

    create(value: { userId:string; merchantId:string; environment:DashboardApiCredentialEnvironment; idempotencyKey:string; requestHash:string; command:Record<string,unknown> }) {
      return mutate(CREATE_SQL, value);
    },
    rotateSecret(value: { userId:string; merchantId:string; environment:DashboardApiCredentialEnvironment; credentialId:string; idempotencyKey:string; requestHash:string; command:Record<string,unknown> }) {
      return mutate(ROTATE_SQL, value);
    },
    revoke(value: { userId:string; merchantId:string; environment:DashboardApiCredentialEnvironment; credentialId:string; idempotencyKey:string; requestHash:string; command:Record<string,unknown> }) {
      return mutate(REVOKE_SQL, value);
    },
  };
}
