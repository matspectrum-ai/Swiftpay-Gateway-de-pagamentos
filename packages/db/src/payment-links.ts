import type pg from 'pg';
import type { PublicPaymentRecord } from './pix.js';

type QueryOnlyPool = Pick<pg.Pool, 'query'>;
export type PaymentLinkEnvironment = 'sandbox' | 'production';

export interface DashboardPaymentLinkRecord {
  readonly id: string;
  readonly publicToken: string;
  readonly checkoutPath: string;
  readonly status: 'active' | 'disabled';
  readonly amount: number;
  readonly currency: 'BRL';
  readonly description: string | null;
  readonly pixExpirationMinutes: number;
  readonly createdAt: string;
  readonly disabledAt: string | null;
}

export interface PublicPaymentLinkRecord {
  readonly merchantName: string;
  readonly amount: number;
  readonly currency: 'BRL';
  readonly description: string | null;
  readonly environment: 'sandbox';
  readonly pixExpirationMinutes: number;
}

export type DashboardPaymentLinkMutationRecord =
  | { readonly kind: 'created'; readonly replayed: boolean; readonly paymentLink: DashboardPaymentLinkRecord }
  | { readonly kind: 'ok'; readonly replayed: boolean; readonly paymentLink: DashboardPaymentLinkRecord }
  | { readonly kind: 'token_required' | 'token_collision' | 'forbidden' | 'validation_error' | 'resource_not_found' | 'idempotency_conflict' };

export type HostedCheckoutPrepareRecord =
  | {
      readonly kind: 'prepared';
      readonly merchantId: string;
      readonly payment: PublicPaymentRecord;
      readonly providerAttempt: { readonly id: string; readonly amountCents: number; readonly expiresAt: string };
    }
  | { readonly kind: 'completed'; readonly httpStatus: 201; readonly payment: PublicPaymentRecord }
  | { readonly kind: 'executing' | 'execution_unknown'; readonly payment: PublicPaymentRecord }
  | { readonly kind: 'not_found' | 'validation_error' | 'conflict' };

export class PaymentLinkStoreError extends Error {
  constructor(readonly kind: 'forbidden' | 'validation_error' | 'internal_error' = 'internal_error') {
    super('Payment-link database operation failed');
    this.name = 'PaymentLinkStoreError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/;
const TOKEN_RE = /^plink_sandbox_[A-Za-z0-9_-]{32}$/;

const LIST_SQL = `
select payment_link
from app.list_dashboard_payment_links($1::uuid,$2::uuid,$3::text) as payment_link
`;
const CREATE_SQL = `select app.create_dashboard_payment_link($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::jsonb) as result`;
const DISABLE_SQL = `select app.disable_dashboard_payment_link($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb) as result`;
const GET_PUBLIC_SQL = `select app.get_public_payment_link($1::text) as result`;
const PREPARE_SQL = `select app.prepare_payment_link_pix_payment($1::text,$2::text,$3::text) as result`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || timestamp(value);
}

function dashboardLink(value: unknown): DashboardPaymentLinkRecord {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'publicToken', 'checkoutPath', 'status', 'amount', 'currency',
    'description', 'pixExpirationMinutes', 'createdAt', 'disabledAt',
  ])) throw new PaymentLinkStoreError();
  if (typeof value.id !== 'string' || !UUID_RE.test(value.id)
      || typeof value.publicToken !== 'string' || !TOKEN_RE.test(value.publicToken)
      || value.checkoutPath !== `/pay/${value.publicToken}`
      || (value.status !== 'active' && value.status !== 'disabled')
      || typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount < 1
      || value.currency !== 'BRL'
      || !(value.description === null || typeof value.description === 'string')
      || typeof value.pixExpirationMinutes !== 'number' || !Number.isSafeInteger(value.pixExpirationMinutes)
      || value.pixExpirationMinutes < 5 || value.pixExpirationMinutes > 1440
      || !timestamp(value.createdAt)
      || !nullableTimestamp(value.disabledAt)
      || (value.status === 'active' && value.disabledAt !== null)
      || (value.status === 'disabled' && value.disabledAt === null)) {
    throw new PaymentLinkStoreError();
  }
  return value as unknown as DashboardPaymentLinkRecord;
}

function publicLink(value: unknown): PublicPaymentLinkRecord {
  if (!isRecord(value) || !exactKeys(value, [
    'merchantName', 'amount', 'currency', 'description', 'environment', 'pixExpirationMinutes',
  ])) throw new PaymentLinkStoreError();
  if (!nonemptyString(value.merchantName)
      || typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount < 1
      || value.currency !== 'BRL'
      || !(value.description === null || typeof value.description === 'string')
      || value.environment !== 'sandbox'
      || typeof value.pixExpirationMinutes !== 'number' || !Number.isSafeInteger(value.pixExpirationMinutes)
      || value.pixExpirationMinutes < 5 || value.pixExpirationMinutes > 1440) {
    throw new PaymentLinkStoreError();
  }
  return value as unknown as PublicPaymentLinkRecord;
}

function publicPix(value: unknown): PublicPaymentRecord['pix'] {
  if (value === null) return null;
  if (!isRecord(value) || !exactKeys(value, ['txId', 'qrCode', 'copyAndPaste', 'expiresAt'])
      || !nonemptyString(value.txId) || !nonemptyString(value.qrCode)
      || !nonemptyString(value.copyAndPaste) || !timestamp(value.expiresAt)) {
    throw new PaymentLinkStoreError();
  }
  return {
    txId: value.txId,
    qrCode: value.qrCode,
    copyAndPaste: value.copyAndPaste,
    expiresAt: value.expiresAt,
  };
}

function publicPayment(value: unknown): PublicPaymentRecord {
  if (!isRecord(value) || !exactKeys(value, [
    'id','externalId','method','amount','fee','netAmount','currency','status',
    'description','environment','expiresAt','createdAt','pix',
  ])) throw new PaymentLinkStoreError();
  if (typeof value.id !== 'string' || !UUID_RE.test(value.id)
      || !(value.externalId === null || typeof value.externalId === 'string')
      || value.method !== 'pix'
      || typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount < 1
      || typeof value.fee !== 'number' || !Number.isSafeInteger(value.fee) || value.fee < 0
      || typeof value.netAmount !== 'number' || !Number.isSafeInteger(value.netAmount) || value.netAmount < 0
      || value.currency !== 'BRL'
      || !['creating','pending','paid','failed','expired','cancelled'].includes(String(value.status))
      || !(value.description === null || typeof value.description === 'string')
      || value.environment !== 'sandbox'
      || !timestamp(value.expiresAt) || !timestamp(value.createdAt)) throw new PaymentLinkStoreError();
  const pix = publicPix(value.pix);
  if ((value.status === 'pending' || value.status === 'paid') ? pix === null : pix !== null) {
    throw new PaymentLinkStoreError();
  }
  return { ...(value as Omit<PublicPaymentRecord, 'pix'>), pix } as PublicPaymentRecord;
}

function mutation(value: unknown): DashboardPaymentLinkMutationRecord {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new PaymentLinkStoreError();
  if (value.kind === 'created' || value.kind === 'ok') {
    if (!exactKeys(value, ['kind','replayed','paymentLink']) || typeof value.replayed !== 'boolean') {
      throw new PaymentLinkStoreError();
    }
    return { kind: value.kind, replayed: value.replayed, paymentLink: dashboardLink(value.paymentLink) };
  }
  const scalarKinds = new Set([
    'token_required','token_collision','forbidden','validation_error','resource_not_found','idempotency_conflict',
  ]);
  if (!scalarKinds.has(value.kind) || !exactKeys(value, ['kind'])) throw new PaymentLinkStoreError();
  return { kind: value.kind as Exclude<DashboardPaymentLinkMutationRecord['kind'], 'created' | 'ok'> };
}

function prepare(value: unknown): HostedCheckoutPrepareRecord {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new PaymentLinkStoreError();
  if (value.kind === 'prepared') {
    if (!exactKeys(value, ['kind','merchantId','payment','providerAttempt'])
        || typeof value.merchantId !== 'string' || !UUID_RE.test(value.merchantId)
        || !isRecord(value.providerAttempt)
        || !exactKeys(value.providerAttempt, ['id','amountCents','expiresAt'])
        || typeof value.providerAttempt.id !== 'string' || !UUID_RE.test(value.providerAttempt.id)
        || typeof value.providerAttempt.amountCents !== 'number' || !Number.isSafeInteger(value.providerAttempt.amountCents)
        || value.providerAttempt.amountCents < 1
        || !timestamp(value.providerAttempt.expiresAt)) throw new PaymentLinkStoreError();
    return {
      kind: 'prepared', merchantId: value.merchantId, payment: publicPayment(value.payment),
      providerAttempt: {
        id: value.providerAttempt.id,
        amountCents: value.providerAttempt.amountCents,
        expiresAt: value.providerAttempt.expiresAt,
      },
    };
  }
  if (value.kind === 'completed') {
    if (!exactKeys(value, ['kind','httpStatus','payment']) || value.httpStatus !== 201) throw new PaymentLinkStoreError();
    return { kind: 'completed', httpStatus: 201, payment: publicPayment(value.payment) };
  }
  if (value.kind === 'executing' || value.kind === 'execution_unknown') {
    if (!exactKeys(value, ['kind','payment'])) throw new PaymentLinkStoreError();
    return { kind: value.kind, payment: publicPayment(value.payment) };
  }
  if (value.kind === 'not_found' || value.kind === 'validation_error' || value.kind === 'conflict') {
    if (!exactKeys(value, ['kind'])) throw new PaymentLinkStoreError();
    return { kind: value.kind };
  }
  throw new PaymentLinkStoreError();
}

function validateDashboardBase(input: { userId: string; merchantId: string; environment: PaymentLinkEnvironment }): void {
  if (!UUID_RE.test(input.userId) || !UUID_RE.test(input.merchantId)
      || (input.environment !== 'sandbox' && input.environment !== 'production')) throw new PaymentLinkStoreError('validation_error');
}

function classify(error: unknown): PaymentLinkStoreError {
  if (error instanceof PaymentLinkStoreError) return error;
  if (isRecord(error) && error.code === '42501') return new PaymentLinkStoreError('forbidden');
  if (isRecord(error) && (error.code === '22023' || error.code === '23514')) return new PaymentLinkStoreError('validation_error');
  return new PaymentLinkStoreError();
}

export function createDashboardPaymentLinkStore(pool: QueryOnlyPool) {
  return {
    async list(input: { userId: string; merchantId: string; environment: PaymentLinkEnvironment }): Promise<readonly DashboardPaymentLinkRecord[]> {
      validateDashboardBase(input);
      try {
        const result = await pool.query<{ payment_link: unknown }>(LIST_SQL, [input.userId, input.merchantId, input.environment]);
        return result.rows.map((row) => dashboardLink(row.payment_link));
      } catch (error) { throw classify(error); }
    },

    async create(input: {
      userId: string; merchantId: string; environment: PaymentLinkEnvironment;
      idempotencyKey: string; requestHash: string; command: Record<string, unknown>;
    }): Promise<DashboardPaymentLinkMutationRecord> {
      validateDashboardBase(input);
      if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey !== input.idempotencyKey.trim()
          || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 160
          || !HEX64_RE.test(input.requestHash) || !isRecord(input.command)) throw new PaymentLinkStoreError('validation_error');
      try {
        const result = await pool.query<{ result: unknown }>(CREATE_SQL, [
          input.userId,input.merchantId,input.environment,input.idempotencyKey,input.requestHash,input.command,
        ]);
        if (result.rows.length !== 1) throw new PaymentLinkStoreError();
        return mutation(result.rows[0]?.result);
      } catch (error) { throw classify(error); }
    },

    async disable(input: {
      userId: string; merchantId: string; environment: PaymentLinkEnvironment; paymentLinkId: string;
      idempotencyKey: string; requestHash: string; command: Record<string, unknown>;
    }): Promise<DashboardPaymentLinkMutationRecord> {
      validateDashboardBase(input);
      if (!UUID_RE.test(input.paymentLinkId)
          || typeof input.idempotencyKey !== 'string' || input.idempotencyKey !== input.idempotencyKey.trim()
          || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 160
          || !HEX64_RE.test(input.requestHash) || !isRecord(input.command)) throw new PaymentLinkStoreError('validation_error');
      try {
        const result = await pool.query<{ result: unknown }>(DISABLE_SQL, [
          input.userId,input.merchantId,input.environment,input.paymentLinkId,input.idempotencyKey,input.requestHash,input.command,
        ]);
        if (result.rows.length !== 1) throw new PaymentLinkStoreError();
        return mutation(result.rows[0]?.result);
      } catch (error) { throw classify(error); }
    },
  };
}

export function createHostedCheckoutStore(pool: QueryOnlyPool) {
  return {
    async getLink(publicToken: string): Promise<PublicPaymentLinkRecord | null> {
      if (typeof publicToken !== 'string' || !TOKEN_RE.test(publicToken)) return null;
      try {
        const result = await pool.query<{ result: unknown }>(GET_PUBLIC_SQL, [publicToken]);
        if (result.rows.length !== 1) throw new PaymentLinkStoreError();
        const value = result.rows[0]?.result;
        return value === null || value === undefined ? null : publicLink(value);
      } catch (error) { throw classify(error); }
    },

    async preparePayment(input: { publicToken: string; idempotencyKey: string; requestHash: string }): Promise<HostedCheckoutPrepareRecord> {
      if (!TOKEN_RE.test(input.publicToken)
          || input.idempotencyKey !== input.idempotencyKey.trim()
          || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 160
          || !HEX64_RE.test(input.requestHash)) throw new PaymentLinkStoreError('validation_error');
      try {
        const result = await pool.query<{ result: unknown }>(PREPARE_SQL, [input.publicToken,input.idempotencyKey,input.requestHash]);
        if (result.rows.length !== 1) throw new PaymentLinkStoreError();
        return prepare(result.rows[0]?.result);
      } catch (error) { throw classify(error); }
    },
  };
}
