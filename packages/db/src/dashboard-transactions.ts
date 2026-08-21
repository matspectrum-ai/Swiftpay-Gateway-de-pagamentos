import type pg from 'pg';

export type DashboardTransactionEnvironment = 'sandbox' | 'production';
export type DashboardTransactionStatus = 'creating' | 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';

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

export interface DashboardTransactionDetail extends DashboardTransactionListItem {
  readonly pix: {
    readonly txId: string;
    readonly qrCode: string;
    readonly copyAndPaste: string;
    readonly expiresAt: string;
  } | null;
}

type QueryOnlyPool = Pick<pg.Pool, 'query'>;

export class DashboardTransactionStoreError extends Error {
  constructor() {
    super('Dashboard transaction database operation failed');
    this.name = 'DashboardTransactionStoreError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = new Set(['creating', 'pending', 'paid', 'expired', 'failed', 'cancelled']);
const SOURCE = new Set(['api', 'checkout', 'payment_link', 'quick_pix']);

function invalid(): never {
  throw new DashboardTransactionStoreError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || timestamp(value);
}

function safeMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function listItem(value: unknown): DashboardTransactionListItem {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'externalId', 'method', 'source', 'amount', 'fee', 'netAmount', 'refundedAmount',
    'currency', 'status', 'description', 'environment', 'expiresAt', 'paidAt', 'createdAt', 'updatedAt',
  ])) invalid();
  if (typeof value.id !== 'string' || !UUID_RE.test(value.id)
      || !(value.externalId === null || typeof value.externalId === 'string')
      || value.method !== 'pix'
      || typeof value.source !== 'string' || !SOURCE.has(value.source)
      || !safeMoney(value.amount) || (value.amount as number) < 1
      || !safeMoney(value.fee) || !safeMoney(value.netAmount) || !safeMoney(value.refundedAmount)
      || value.currency !== 'BRL'
      || typeof value.status !== 'string' || !STATUS.has(value.status)
      || !(value.description === null || typeof value.description === 'string')
      || (value.environment !== 'sandbox' && value.environment !== 'production')
      || !nullableTimestamp(value.expiresAt)
      || !nullableTimestamp(value.paidAt)
      || !timestamp(value.createdAt)
      || !timestamp(value.updatedAt)) invalid();
  return value as unknown as DashboardTransactionListItem;
}

function detail(value: unknown): DashboardTransactionDetail {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'externalId', 'method', 'source', 'amount', 'fee', 'netAmount', 'refundedAmount',
    'currency', 'status', 'description', 'environment', 'expiresAt', 'paidAt', 'createdAt', 'updatedAt', 'pix',
  ])) invalid();
  const base: Record<string, unknown> = { ...value };
  delete base.pix;
  listItem(base);
  if (value.pix !== null) {
    if (!isRecord(value.pix) || !exactKeys(value.pix, ['txId', 'qrCode', 'copyAndPaste', 'expiresAt'])
        || typeof value.pix.txId !== 'string' || value.pix.txId.length === 0
        || typeof value.pix.qrCode !== 'string' || value.pix.qrCode.length === 0
        || typeof value.pix.copyAndPaste !== 'string' || value.pix.copyAndPaste.length === 0
        || !timestamp(value.pix.expiresAt)) invalid();
  }
  return value as unknown as DashboardTransactionDetail;
}

function validBase(value: { userId: string; merchantId: string; environment: DashboardTransactionEnvironment }): void {
  if (!UUID_RE.test(value.userId) || !UUID_RE.test(value.merchantId)
      || (value.environment !== 'sandbox' && value.environment !== 'production')) invalid();
}

const LIST_SQL = `select app.list_dashboard_transactions(
  $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9::uuid,$10::integer
) as transactions`;
const GET_SQL = `select app.get_dashboard_transaction($1::uuid,$2::uuid,$3::text,$4::uuid) as transaction`;

export function createDashboardTransactionStore(pool: QueryOnlyPool) {
  return {
    async list(value: {
      userId: string;
      merchantId: string;
      environment: DashboardTransactionEnvironment;
      status: DashboardTransactionStatus | null;
      externalId: string | null;
      createdFrom: string | null;
      createdTo: string | null;
      cursorCreatedAt: string | null;
      cursorPaymentId: string | null;
      limit: number;
    }): Promise<readonly DashboardTransactionListItem[]> {
      validBase(value);
      if (!(value.status === null || STATUS.has(value.status))
          || !(value.externalId === null || (typeof value.externalId === 'string' && value.externalId.length > 0))
          || !nullableTimestamp(value.createdFrom) || !nullableTimestamp(value.createdTo)
          || !nullableTimestamp(value.cursorCreatedAt)
          || !(value.cursorPaymentId === null || UUID_RE.test(value.cursorPaymentId))
          || ((value.cursorCreatedAt === null) !== (value.cursorPaymentId === null))
          || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100) invalid();
      try {
        const result = await pool.query<{ transactions: unknown }>(LIST_SQL, [
          value.userId,
          value.merchantId,
          value.environment,
          value.status,
          value.externalId,
          value.createdFrom,
          value.createdTo,
          value.cursorCreatedAt,
          value.cursorPaymentId,
          value.limit,
        ]);
        const rows = result.rows[0]?.transactions;
        if (!Array.isArray(rows) || rows.length > value.limit + 1) invalid();
        return rows.map((row) => listItem(row));
      } catch (error) {
        if (error instanceof DashboardTransactionStoreError) throw error;
        throw new DashboardTransactionStoreError();
      }
    },

    async get(value: {
      userId: string;
      merchantId: string;
      environment: DashboardTransactionEnvironment;
      transactionId: string;
    }): Promise<DashboardTransactionDetail | null> {
      validBase(value);
      if (!UUID_RE.test(value.transactionId)) invalid();
      try {
        const result = await pool.query<{ transaction: unknown }>(GET_SQL, [
          value.userId,
          value.merchantId,
          value.environment,
          value.transactionId,
        ]);
        const row = result.rows[0]?.transaction;
        return row === null || row === undefined ? null : detail(row);
      } catch (error) {
        if (error instanceof DashboardTransactionStoreError) throw error;
        throw new DashboardTransactionStoreError();
      }
    },
  };
}
