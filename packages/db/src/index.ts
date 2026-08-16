import pg from 'pg';

const { Pool } = pg;

type RuntimeWorkload = 'api' | 'worker';
type AuthEnvironment = 'sandbox' | 'production';

export interface RuntimePoolOptions {
  readonly databaseUrl: string;
  readonly workload: RuntimeWorkload;
}

export interface RuntimePool {
  query: pg.Pool['query'];
  end(): Promise<void>;
}

export interface ApiCredentialAuthRecord {
  readonly credentialId: string;
  readonly merchantId: string;
  readonly environment: AuthEnvironment;
  readonly credentialStatus: string;
  readonly secretVerifier: string;
  readonly secretVersion: number;
  readonly ipAllowlist: unknown;
  readonly merchantLifecycleStatus: string;
}

export interface ApiTokenIssuanceResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface ApiCredentialAuthState {
  readonly credentialId: string;
  readonly merchantId: string;
  readonly environment: AuthEnvironment;
  readonly credentialStatus: string;
  readonly secretVersion: number;
  readonly merchantLifecycleStatus: string;
}

export interface ApiCredentialAuthStore {
  lookupCredentialForToken(publicKey: string): Promise<ApiCredentialAuthRecord | null>;
  consumeTokenIssuance(credentialId: string): Promise<ApiTokenIssuanceResult>;
  getCredentialAuthState(credentialId: string): Promise<ApiCredentialAuthState | null>;
}

export class RuntimeBoundaryError extends Error {
  constructor() {
    super('Runtime database readiness check failed');
    this.name = 'RuntimeBoundaryError';
  }
}

export class RuntimeAuthStoreError extends Error {
  constructor() {
    super('Runtime authentication database operation failed');
    this.name = 'RuntimeAuthStoreError';
  }
}

export function createRuntimePool(options: RuntimePoolOptions): pg.Pool {
  return new Pool({
    connectionString: options.databaseUrl,
    application_name: `swiftpay-${options.workload}`,
    max: 4,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 2_000,
    query_timeout: 2_500,
  });
}

interface BoundaryRow {
  current_user: string;
  expected_member: boolean;
  forbidden_member: boolean;
  schema_usage: boolean;
  schema_create: boolean;
  payment_select: boolean;
  payment_insert: boolean;
  payment_update: boolean;
  payment_delete: boolean;
}

const BOUNDARY_SQL = `
select
  current_user::text as current_user,
  pg_has_role(current_user, $1, 'MEMBER') as expected_member,
  pg_has_role(current_user, $2, 'MEMBER') as forbidden_member,
  has_schema_privilege(current_user, 'app', 'USAGE') as schema_usage,
  has_schema_privilege(current_user, 'app', 'CREATE') as schema_create,
  has_table_privilege(current_user, 'app.payments', 'SELECT') as payment_select,
  has_table_privilege(current_user, 'app.payments', 'INSERT') as payment_insert,
  has_table_privilege(current_user, 'app.payments', 'UPDATE') as payment_update,
  has_table_privilege(current_user, 'app.payments', 'DELETE') as payment_delete
`;

export async function verifyRuntimeBoundary(pool: pg.Pool, workload: RuntimeWorkload): Promise<void> {
  const expectedUser = workload === 'api' ? 'swiftpay_api_runtime' : 'swiftpay_worker_runtime';
  const expectedGroup = workload === 'api' ? 'swiftpay_api' : 'swiftpay_worker';
  const forbiddenGroup = workload === 'api' ? 'swiftpay_worker' : 'swiftpay_api';

  try {
    const result = await pool.query<BoundaryRow>(BOUNDARY_SQL, [expectedGroup, forbiddenGroup]);
    const row = result.rows[0];
    const valid = row !== undefined
      && row.current_user === expectedUser
      && row.expected_member
      && !row.forbidden_member
      && row.schema_usage
      && !row.schema_create
      && !row.payment_select
      && !row.payment_insert
      && !row.payment_update
      && !row.payment_delete;

    if (!valid) {
      throw new RuntimeBoundaryError();
    }
  } catch (error) {
    if (error instanceof RuntimeBoundaryError) {
      throw error;
    }
    throw new RuntimeBoundaryError();
  }
}

interface CredentialLookupRow {
  credential_id: string;
  merchant_id: string;
  environment: string;
  credential_status: string;
  secret_verifier: string;
  secret_version: number;
  ip_allowlist: unknown;
  merchant_lifecycle_status: string;
}

interface TokenIssuanceRow {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
}

interface CredentialAuthStateRow {
  credential_id: string;
  merchant_id: string;
  environment: string;
  credential_status: string;
  secret_version: number;
  merchant_lifecycle_status: string;
}

type QueryOnlyPool = Pick<RuntimePool, 'query'>;

const LOOKUP_CREDENTIAL_SQL = `
select *
from app.lookup_api_credential_for_token($1::text)
`;

const CONSUME_TOKEN_ISSUANCE_SQL = `
select *
from app.consume_api_token_issuance($1::uuid)
`;

const GET_CREDENTIAL_AUTH_STATE_SQL = `
select *
from app.get_api_credential_auth_state($1::uuid)
`;

function isAuthEnvironment(value: string): value is AuthEnvironment {
  return value === 'sandbox' || value === 'production';
}

function mapCredentialLookup(row: CredentialLookupRow): ApiCredentialAuthRecord {
  if (
    typeof row.credential_id !== 'string'
    || typeof row.merchant_id !== 'string'
    || !isAuthEnvironment(row.environment)
    || typeof row.credential_status !== 'string'
    || typeof row.secret_verifier !== 'string'
    || !Number.isSafeInteger(row.secret_version)
    || row.secret_version < 1
    || typeof row.merchant_lifecycle_status !== 'string'
  ) {
    throw new RuntimeAuthStoreError();
  }

  return {
    credentialId: row.credential_id,
    merchantId: row.merchant_id,
    environment: row.environment,
    credentialStatus: row.credential_status,
    secretVerifier: row.secret_verifier,
    secretVersion: row.secret_version,
    ipAllowlist: row.ip_allowlist,
    merchantLifecycleStatus: row.merchant_lifecycle_status,
  };
}

function mapTokenIssuance(row: TokenIssuanceRow | undefined): ApiTokenIssuanceResult {
  if (
    row === undefined
    || typeof row.allowed !== 'boolean'
    || !Number.isSafeInteger(row.remaining)
    || row.remaining < 0
    || !Number.isSafeInteger(row.retry_after_seconds)
    || row.retry_after_seconds < 0
    || (row.allowed && row.retry_after_seconds !== 0)
    || (!row.allowed && row.retry_after_seconds < 1)
  ) {
    throw new RuntimeAuthStoreError();
  }

  return {
    allowed: row.allowed,
    remaining: row.remaining,
    retryAfterSeconds: row.retry_after_seconds,
  };
}

function mapCredentialAuthState(row: CredentialAuthStateRow): ApiCredentialAuthState {
  if (
    typeof row.credential_id !== 'string'
    || typeof row.merchant_id !== 'string'
    || !isAuthEnvironment(row.environment)
    || typeof row.credential_status !== 'string'
    || !Number.isSafeInteger(row.secret_version)
    || row.secret_version < 1
    || typeof row.merchant_lifecycle_status !== 'string'
  ) {
    throw new RuntimeAuthStoreError();
  }

  return {
    credentialId: row.credential_id,
    merchantId: row.merchant_id,
    environment: row.environment,
    credentialStatus: row.credential_status,
    secretVersion: row.secret_version,
    merchantLifecycleStatus: row.merchant_lifecycle_status,
  };
}

export function createApiCredentialAuthStore(pool: QueryOnlyPool): ApiCredentialAuthStore {
  return {
    async lookupCredentialForToken(publicKey) {
      try {
        const result = await pool.query<CredentialLookupRow>(LOOKUP_CREDENTIAL_SQL, [publicKey]);
        const row = result.rows[0];
        return row === undefined ? null : mapCredentialLookup(row);
      } catch {
        throw new RuntimeAuthStoreError();
      }
    },

    async consumeTokenIssuance(credentialId) {
      try {
        const result = await pool.query<TokenIssuanceRow>(CONSUME_TOKEN_ISSUANCE_SQL, [credentialId]);
        return mapTokenIssuance(result.rows[0]);
      } catch {
        throw new RuntimeAuthStoreError();
      }
    },

    async getCredentialAuthState(credentialId) {
      try {
        const result = await pool.query<CredentialAuthStateRow>(GET_CREDENTIAL_AUTH_STATE_SQL, [credentialId]);
        const row = result.rows[0];
        return row === undefined ? null : mapCredentialAuthState(row);
      } catch {
        throw new RuntimeAuthStoreError();
      }
    },
  };
}

export * from './pix.js';
export * from './financial.js';
export * from './webhooks.js';
export {
  createDashboardMerchantContextStore,
  type DashboardEnvironment,
  type DashboardMembershipRole,
  type DashboardMerchantContext,
  type DashboardMerchantContextInput,
  type DashboardMerchantContextResult,
  type DashboardMerchantContextStore,
} from './dashboard.js';
