import type pg from 'pg';

export type ApiAbusePolicy =
  | 'token_exchange_pre_auth'
  | 'machine_request_pre_auth'
  | 'machine_read'
  | 'machine_mutation'
  | 'dashboard_request_pre_auth'
  | 'readiness_probe';

export interface ApiAbuseQuotaDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

type QueryOnlyPool = Pick<pg.Pool, 'query'>;

const POLICIES = new Set<ApiAbusePolicy>([
  'token_exchange_pre_auth',
  'machine_request_pre_auth',
  'machine_read',
  'machine_mutation',
  'dashboard_request_pre_auth',
  'readiness_probe',
]);
const SUBJECT_HASH_RE = /^[0-9a-f]{64}$/;
const CONSUME_SQL = `select * from app.consume_api_abuse_quota($1::text, $2::text)`;

export class ApiAbuseRateLimitStoreError extends Error {
  constructor() {
    super('API request admission database operation failed');
    this.name = 'ApiAbuseRateLimitStoreError';
  }
}

function fail(): never {
  throw new ApiAbuseRateLimitStoreError();
}

function isExactDecisionRow(value: unknown): value is {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (keys.length !== 3 || keys[0] !== 'allowed' || keys[1] !== 'remaining' || keys[2] !== 'retry_after_seconds') {
    return false;
  }
  if (typeof row.allowed !== 'boolean'
      || !Number.isSafeInteger(row.remaining)
      || !Number.isSafeInteger(row.retry_after_seconds)) {
    return false;
  }
  const remaining = row.remaining as number;
  const retryAfterSeconds = row.retry_after_seconds as number;
  return row.allowed
    ? remaining >= 0 && retryAfterSeconds === 0
    : remaining === 0 && retryAfterSeconds >= 1 && retryAfterSeconds <= 60;
}

export function createApiAbuseRateLimitStore(pool: QueryOnlyPool) {
  return Object.freeze({
    async consume(input: { readonly policy: string; readonly subjectHash: string }): Promise<ApiAbuseQuotaDecision> {
      if (!POLICIES.has(input.policy as ApiAbusePolicy) || !SUBJECT_HASH_RE.test(input.subjectHash)) fail();

      try {
        const result = await pool.query(CONSUME_SQL, [input.policy, input.subjectHash]);
        if (result.rows.length !== 1 || !isExactDecisionRow(result.rows[0])) fail();
        const row = result.rows[0];
        return {
          allowed: row.allowed,
          remaining: row.remaining,
          retryAfterSeconds: row.retry_after_seconds,
        };
      } catch (error) {
        if (error instanceof ApiAbuseRateLimitStoreError) throw error;
        throw new ApiAbuseRateLimitStoreError();
      }
    },
  });
}
