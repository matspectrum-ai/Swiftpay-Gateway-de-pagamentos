import type pg from 'pg';

export type DashboardContextLifecycleStatus = 'draft' | 'active' | 'suspended' | 'closed';
export type DashboardContextMembershipRole = 'member' | 'admin' | 'owner';

export interface DashboardContextDiscoveryItem {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly lifecycleStatus: DashboardContextLifecycleStatus;
  readonly membershipRole: DashboardContextMembershipRole;
  readonly environments: readonly ['sandbox', 'production'];
}

export interface DashboardContextDiscoveryStore {
  listForUser(userId: string): Promise<readonly DashboardContextDiscoveryItem[]>;
}

type QueryOnlyPool = Pick<pg.Pool, 'query'>;

export class DashboardContextDiscoveryStoreError extends Error {
  constructor() {
    super('Dashboard context discovery database operation failed');
    this.name = 'DashboardContextDiscoveryStoreError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIFECYCLE = new Set<DashboardContextLifecycleStatus>(['draft', 'active', 'suspended', 'closed']);
const ROLES = new Set<DashboardContextMembershipRole>(['member', 'admin', 'owner']);

const LIST_SQL = `select merchant_id, merchant_name, lifecycle_status, membership_role
from app.list_dashboard_merchant_contexts($1::uuid)`;

function invalid(): never {
  throw new DashboardContextDiscoveryStoreError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapRow(value: unknown): DashboardContextDiscoveryItem {
  if (!isRecord(value)) invalid();
  const keys = Object.keys(value).sort();
  const expected = ['lifecycle_status', 'membership_role', 'merchant_id', 'merchant_name'];
  if (keys.length !== expected.length || !keys.every((key, index) => key === expected[index])) invalid();

  const merchantId = value.merchant_id;
  const merchantName = value.merchant_name;
  const lifecycleStatus = value.lifecycle_status;
  const membershipRole = value.membership_role;

  if (typeof merchantId !== 'string' || !UUID_RE.test(merchantId)
      || typeof merchantName !== 'string' || merchantName.trim().length === 0
      || typeof lifecycleStatus !== 'string' || !LIFECYCLE.has(lifecycleStatus as DashboardContextLifecycleStatus)
      || typeof membershipRole !== 'string' || !ROLES.has(membershipRole as DashboardContextMembershipRole)) invalid();

  return {
    merchantId,
    merchantName,
    lifecycleStatus: lifecycleStatus as DashboardContextLifecycleStatus,
    membershipRole: membershipRole as DashboardContextMembershipRole,
    environments: ['sandbox', 'production'],
  };
}

export function createDashboardContextDiscoveryStore(pool: QueryOnlyPool): DashboardContextDiscoveryStore {
  return {
    async listForUser(userId) {
      if (typeof userId !== 'string' || !UUID_RE.test(userId)) invalid();
      try {
        const result = await pool.query(LIST_SQL, [userId]);
        return result.rows.map((row) => mapRow(row));
      } catch (error) {
        if (error instanceof DashboardContextDiscoveryStoreError) throw error;
        throw new DashboardContextDiscoveryStoreError();
      }
    },
  };
}
