import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type DashboardTransactionEnvironment = 'sandbox' | 'production';
export type DashboardTransactionStatus = 'creating' | 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';

export interface DashboardTransactionFilters {
  readonly status: DashboardTransactionStatus | null;
  readonly externalId: string | null;
  readonly createdFrom: string | null;
  readonly createdTo: string | null;
}

export interface DashboardTransactionListQuery extends DashboardTransactionFilters {
  readonly cursor: string | null;
  readonly limit: number;
}

export interface DashboardTransactionListItem {
  readonly id: string;
  readonly externalId: string | null;
  readonly method: 'pix';
  readonly source: 'api' | 'checkout' | 'payment_link' | 'quick_pix';
  readonly amount: number;
  readonly fee: number;
  readonly netAmount: number;
  readonly refundedAmount: number;
  readonly currency: 'BRL';
  readonly status: DashboardTransactionStatus;
  readonly description: string | null;
  readonly environment: DashboardTransactionEnvironment;
  readonly expiresAt: string | null;
  readonly paidAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DashboardTransactionPix {
  readonly txId: string;
  readonly qrCode: string;
  readonly copyAndPaste: string;
  readonly expiresAt: string;
}

export interface DashboardTransactionDetail extends DashboardTransactionListItem {
  readonly pix: DashboardTransactionPix | null;
}

export interface DashboardTransactionViolation {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export type DashboardTransactionListQueryValidation =
  | { readonly ok: true; readonly value: DashboardTransactionListQuery }
  | { readonly ok: false; readonly violations: readonly DashboardTransactionViolation[] };

export interface DashboardTransactionCursor {
  readonly createdAt: string;
  readonly paymentId: string;
}

export interface DashboardTransactionCursorCodec {
  encode(input: {
    readonly merchantId: string;
    readonly environment: DashboardTransactionEnvironment;
    readonly filters: DashboardTransactionFilters;
    readonly createdAt: string;
    readonly paymentId: string;
  }): string;
  decode(input: {
    readonly token: string;
    readonly merchantId: string;
    readonly environment: DashboardTransactionEnvironment;
    readonly filters: DashboardTransactionFilters;
  }):
    | { readonly ok: true; readonly cursor: DashboardTransactionCursor }
    | { readonly ok: false; readonly violation: DashboardTransactionViolation };
}

export interface DashboardTransactionStore {
  list(input: {
    readonly userId: string;
    readonly merchantId: string;
    readonly environment: DashboardTransactionEnvironment;
    readonly status: DashboardTransactionStatus | null;
    readonly externalId: string | null;
    readonly createdFrom: string | null;
    readonly createdTo: string | null;
    readonly cursorCreatedAt: string | null;
    readonly cursorPaymentId: string | null;
    readonly limit: number;
  }): Promise<readonly DashboardTransactionListItem[]>;
  get(input: {
    readonly userId: string;
    readonly merchantId: string;
    readonly environment: DashboardTransactionEnvironment;
    readonly transactionId: string;
  }): Promise<DashboardTransactionDetail | null>;
}

type DashboardSessionResult =
  | { readonly kind: 'authenticated'; readonly principal: { readonly userId: string } }
  | { readonly kind: 'invalid_session' }
  | { readonly kind: 'authentication_unavailable' };

type DashboardContextResult =
  | { readonly kind: 'authorized'; readonly context: Record<string, unknown> }
  | { readonly kind: 'forbidden' | 'validation_error' | 'internal_error' };

export interface DashboardTransactionReadServiceOptions {
  readonly sessionVerifier: (authorization?: string) => Promise<DashboardSessionResult>;
  readonly contextStore: {
    requireContext(input: {
      readonly userId: string;
      readonly merchantId: string;
      readonly environment: DashboardTransactionEnvironment;
      readonly requiredRole: 'member';
    }): Promise<DashboardContextResult>;
  };
  readonly store: DashboardTransactionStore;
  readonly cursorCodec: DashboardTransactionCursorCodec;
}

export type DashboardTransactionReadFailure =
  | { readonly kind: 'validation_error'; readonly violations?: readonly DashboardTransactionViolation[] }
  | { readonly kind: 'invalid_session' }
  | { readonly kind: 'authentication_unavailable' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'resource_not_found' }
  | { readonly kind: 'internal_error' };

export type DashboardTransactionListResult =
  | { readonly kind: 'ok'; readonly items: readonly DashboardTransactionListItem[]; readonly nextCursor: string | null }
  | DashboardTransactionReadFailure;

export type DashboardTransactionGetResult =
  | { readonly kind: 'ok'; readonly transaction: DashboardTransactionDetail }
  | DashboardTransactionReadFailure;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = new Set<DashboardTransactionStatus>(['creating', 'pending', 'paid', 'expired', 'failed', 'cancelled']);
const QUERY_FIELDS = new Set(['status', 'externalId', 'createdFrom', 'createdTo', 'cursor', 'limit']);
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function violation(field: string, code: string, message: string): DashboardTransactionViolation {
  return { field, code, message };
}

function invalidQuery(field: string, message: string): DashboardTransactionListQueryValidation {
  return { ok: false, violations: [violation(field, 'invalid_field', message)] };
}

function canonicalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function filtersOf(query: DashboardTransactionListQuery): DashboardTransactionFilters {
  return {
    status: query.status,
    externalId: query.externalId,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
  };
}

function validateRouteScope(merchantId: string, environment: string): environment is DashboardTransactionEnvironment {
  return UUID_RE.test(merchantId) && (environment === 'sandbox' || environment === 'production');
}

export function validateDashboardTransactionListQuery(input: unknown): DashboardTransactionListQueryValidation {
  if (!isRecord(input)) return invalidQuery('$', 'Transaction query must be an object.');

  for (const key of Object.keys(input)) {
    if (!QUERY_FIELDS.has(key)) return invalidQuery(key, `${key} is not an allowed transaction query parameter.`);
  }

  let status: DashboardTransactionStatus | null = null;
  if (input.status !== undefined) {
    if (typeof input.status !== 'string' || !STATUS.has(input.status as DashboardTransactionStatus)) {
      return invalidQuery('status', 'status must be one canonical collection status.');
    }
    status = input.status as DashboardTransactionStatus;
  }

  let externalId: string | null = null;
  if (input.externalId !== undefined) {
    if (typeof input.externalId !== 'string' || input.externalId.length === 0) {
      return invalidQuery('externalId', 'externalId must be a non-empty exact value.');
    }
    externalId = input.externalId;
  }

  let createdFrom: string | null = null;
  if (input.createdFrom !== undefined) {
    createdFrom = canonicalTimestamp(input.createdFrom);
    if (createdFrom === null) return invalidQuery('createdFrom', 'createdFrom must be RFC3339 with an explicit offset.');
  }

  let createdTo: string | null = null;
  if (input.createdTo !== undefined) {
    createdTo = canonicalTimestamp(input.createdTo);
    if (createdTo === null) return invalidQuery('createdTo', 'createdTo must be RFC3339 with an explicit offset.');
  }

  if (createdFrom !== null && createdTo !== null && Date.parse(createdTo) <= Date.parse(createdFrom)) {
    return invalidQuery('createdTo', 'createdTo must be strictly greater than createdFrom.');
  }

  let cursor: string | null = null;
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== 'string' || input.cursor.length === 0) {
      return invalidQuery('cursor', 'cursor must be a non-empty A9 cursor token.');
    }
    cursor = input.cursor;
  }

  let limit = 25;
  if (input.limit !== undefined) {
    const raw = input.limit;
    const parsed = typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^[1-9]\d*$/.test(raw)
        ? Number(raw)
        : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
      return invalidQuery('limit', 'limit must be an integer from 1 through 100.');
    }
    limit = parsed;
  }

  return {
    ok: true,
    value: { status, externalId, createdFrom, createdTo, cursor, limit },
  };
}

function filterDigest(filters: DashboardTransactionFilters): string {
  return createHash('sha256')
    .update(`a9-filter-v0\n${JSON.stringify([
      filters.status,
      filters.externalId,
      filters.createdFrom,
      filters.createdTo,
    ])}`, 'utf8')
    .digest('hex');
}

function cursorViolation(): { readonly ok: false; readonly violation: DashboardTransactionViolation } {
  return {
    ok: false,
    violation: violation('cursor', 'invalid_cursor', 'Invalid transaction cursor.'),
  };
}

function canonicalBase64Url(value: string): Buffer | null {
  if (!BASE64URL_RE.test(value) || value.includes('=')) return null;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length > 0 && decoded.toString('base64url') === value ? decoded : null;
  } catch {
    return null;
  }
}

export function createDashboardTransactionCursorCodec(options: { readonly key: string }): DashboardTransactionCursorCodec {
  if (typeof options.key !== 'string' || Buffer.byteLength(options.key, 'utf8') < 32) {
    throw new Error('Dashboard transaction cursor integrity key must contain at least 32 UTF-8 bytes.');
  }
  const key = Buffer.from(options.key, 'utf8');

  return {
    encode(input) {
      if (!validateRouteScope(input.merchantId, input.environment)
          || !isCanonicalTimestamp(input.createdAt)
          || !UUID_RE.test(input.paymentId)) {
        throw new Error('Invalid dashboard transaction cursor input.');
      }
      const digest = filterDigest(input.filters);
      const payload = Buffer.from(JSON.stringify([
        input.merchantId,
        input.environment,
        digest,
        input.createdAt,
        input.paymentId,
      ]), 'utf8').toString('base64url');
      const signed = `a9v0.${payload}`;
      const signature = createHmac('sha256', key).update(signed, 'ascii').digest('base64url');
      return `${signed}.${signature}`;
    },

    decode(input) {
      if (typeof input.token !== 'string' || !validateRouteScope(input.merchantId, input.environment)) {
        return cursorViolation();
      }
      const parts = input.token.split('.');
      if (parts.length !== 3 || parts[0] !== 'a9v0') return cursorViolation();
      const payloadBytes = canonicalBase64Url(parts[1] ?? '');
      const signatureBytes = canonicalBase64Url(parts[2] ?? '');
      if (payloadBytes === null || signatureBytes === null || signatureBytes.length !== 32) return cursorViolation();

      const expected = createHmac('sha256', key).update(`a9v0.${parts[1]}`, 'ascii').digest();
      if (!timingSafeEqual(expected, signatureBytes)) return cursorViolation();

      let payload: unknown;
      try {
        payload = JSON.parse(payloadBytes.toString('utf8'));
      } catch {
        return cursorViolation();
      }
      if (!Array.isArray(payload) || payload.length !== 5) return cursorViolation();
      const [merchantId, environment, digest, createdAt, paymentId] = payload;
      if (typeof merchantId !== 'string' || !UUID_RE.test(merchantId)
          || (environment !== 'sandbox' && environment !== 'production')
          || typeof digest !== 'string' || !HEX64_RE.test(digest)
          || !isCanonicalTimestamp(createdAt)
          || typeof paymentId !== 'string' || !UUID_RE.test(paymentId)
          || merchantId !== input.merchantId
          || environment !== input.environment
          || digest !== filterDigest(input.filters)) {
        return cursorViolation();
      }
      return { ok: true, cursor: { createdAt, paymentId } };
    },
  };
}

function authFailure(result: Exclude<DashboardSessionResult, { kind: 'authenticated' }>): DashboardTransactionReadFailure {
  return { kind: result.kind };
}

function contextFailure(result: Exclude<DashboardContextResult, { kind: 'authorized' }>): DashboardTransactionReadFailure {
  return { kind: result.kind };
}

export function createDashboardTransactionReadService(options: DashboardTransactionReadServiceOptions) {
  async function authorize(authorization: string | undefined, merchantId: string, environment: DashboardTransactionEnvironment) {
    const session = await options.sessionVerifier(authorization);
    if (session.kind !== 'authenticated') return authFailure(session);
    const context = await options.contextStore.requireContext({
      userId: session.principal.userId,
      merchantId,
      environment,
      requiredRole: 'member',
    });
    if (context.kind !== 'authorized') return contextFailure(context);
    return { kind: 'authorized' as const, userId: session.principal.userId };
  }

  return {
    async list(input: {
      readonly authorization?: string;
      readonly merchantId: string;
      readonly environment: string;
      readonly query: unknown;
    }): Promise<DashboardTransactionListResult> {
      if (!validateRouteScope(input.merchantId, input.environment)) return { kind: 'validation_error' };
      const queryResult = validateDashboardTransactionListQuery(input.query);
      if (!queryResult.ok) return { kind: 'validation_error', violations: queryResult.violations };

      try {
        const authority = await authorize(input.authorization, input.merchantId, input.environment);
        if (authority.kind !== 'authorized') return authority;

        const filters = filtersOf(queryResult.value);
        let cursorCreatedAt: string | null = null;
        let cursorPaymentId: string | null = null;
        if (queryResult.value.cursor !== null) {
          const decoded = options.cursorCodec.decode({
            token: queryResult.value.cursor,
            merchantId: input.merchantId,
            environment: input.environment,
            filters,
          });
          if (!decoded.ok) return { kind: 'validation_error', violations: [decoded.violation] };
          cursorCreatedAt = decoded.cursor.createdAt;
          cursorPaymentId = decoded.cursor.paymentId;
        }

        const rows = await options.store.list({
          userId: authority.userId,
          merchantId: input.merchantId,
          environment: input.environment,
          status: filters.status,
          externalId: filters.externalId,
          createdFrom: filters.createdFrom,
          createdTo: filters.createdTo,
          cursorCreatedAt,
          cursorPaymentId,
          limit: queryResult.value.limit,
        });
        const items = rows.slice(0, queryResult.value.limit);
        let nextCursor: string | null = null;
        if (rows.length > queryResult.value.limit && items.length > 0) {
          const last = items[items.length - 1]!;
          nextCursor = options.cursorCodec.encode({
            merchantId: input.merchantId,
            environment: input.environment,
            filters,
            createdAt: last.createdAt,
            paymentId: last.id,
          });
        }
        return { kind: 'ok', items, nextCursor };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async get(input: {
      readonly authorization?: string;
      readonly merchantId: string;
      readonly environment: string;
      readonly transactionId: string;
    }): Promise<DashboardTransactionGetResult> {
      if (!validateRouteScope(input.merchantId, input.environment) || !UUID_RE.test(input.transactionId)) {
        return { kind: 'validation_error' };
      }
      try {
        const authority = await authorize(input.authorization, input.merchantId, input.environment);
        if (authority.kind !== 'authorized') return authority;
        const transaction = await options.store.get({
          userId: authority.userId,
          merchantId: input.merchantId,
          environment: input.environment,
          transactionId: input.transactionId,
        });
        return transaction === null ? { kind: 'resource_not_found' } : { kind: 'ok', transaction };
      } catch {
        return { kind: 'internal_error' };
      }
    },
  };
}
