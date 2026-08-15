import pg from 'pg';

const { Pool } = pg;

type RuntimeWorkload = 'api' | 'worker';

export interface RuntimePoolOptions {
  readonly databaseUrl: string;
  readonly workload: RuntimeWorkload;
}

export interface RuntimePool {
  query: pg.Pool['query'];
  end(): Promise<void>;
}

export class RuntimeBoundaryError extends Error {
  constructor() {
    super('Runtime database readiness check failed');
    this.name = 'RuntimeBoundaryError';
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
