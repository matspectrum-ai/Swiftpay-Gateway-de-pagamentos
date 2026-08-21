import type pg from 'pg';

export type DashboardEnvironment = 'sandbox' | 'production';
export type DashboardMembershipRole = 'member' | 'admin' | 'owner';

export interface DashboardMerchantContextInput {
  readonly userId: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly requiredRole: DashboardMembershipRole;
}

export interface DashboardMerchantContext {
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly membershipRole: DashboardMembershipRole;
}

export type DashboardMerchantContextResult =
  | { readonly kind: 'authorized'; readonly context: DashboardMerchantContext }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'validation_error' }
  | { readonly kind: 'internal_error' };

export interface DashboardMerchantContextStore {
  requireContext(input: DashboardMerchantContextInput): Promise<DashboardMerchantContextResult>;
}

type QueryOnlyPool = Pick<pg.Pool, 'query'>;

interface DashboardContextRow {
  merchant_id: string;
  environment: string;
  membership_role: string;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUIRE_DASHBOARD_CONTEXT_SQL = `
select merchant_id, environment, membership_role
from app.require_dashboard_merchant_context(
  $1::uuid,
  $2::uuid,
  $3::text,
  $4::text
)
`;

function isEnvironment(value: string): value is DashboardEnvironment {
  return value === 'sandbox' || value === 'production';
}

function isRole(value: string): value is DashboardMembershipRole {
  return value === 'member' || value === 'admin' || value === 'owner';
}

function mapAuthorizedContext(
  row: DashboardContextRow | undefined,
  input: DashboardMerchantContextInput,
): DashboardMerchantContextResult {
  if (
    row === undefined
    || !UUID_SHAPE.test(row.merchant_id)
    || !isEnvironment(row.environment)
    || !isRole(row.membership_role)
    || row.merchant_id !== input.merchantId
    || row.environment !== input.environment
  ) {
    return { kind: 'internal_error' };
  }

  return {
    kind: 'authorized',
    context: {
      merchantId: row.merchant_id,
      environment: row.environment,
      membershipRole: row.membership_role,
    },
  };
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function createDashboardMerchantContextStore(
  pool: QueryOnlyPool,
): DashboardMerchantContextStore {
  return {
    async requireContext(input) {
      try {
        const result = await pool.query<DashboardContextRow>(REQUIRE_DASHBOARD_CONTEXT_SQL, [
          input.userId,
          input.merchantId,
          input.environment,
          input.requiredRole,
        ]);

        if (result.rows.length !== 1) {
          return { kind: 'internal_error' };
        }

        return mapAuthorizedContext(result.rows[0], input);
      } catch (error) {
        const code = postgresCode(error);
        if (code === '42501') return { kind: 'forbidden' };
        if (code === '23514') return { kind: 'validation_error' };
        return { kind: 'internal_error' };
      }
    },
  };
}
