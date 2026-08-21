import type pg from 'pg';
import type { PublicPaymentRecord, PublicPixRecord } from './pix.js';

type PaymentEnvironment = 'sandbox' | 'production';
type QueryOnlyPool = Pick<pg.Pool, 'query'>;

export interface MerchantBalanceRecord {
  readonly currency: 'BRL';
  readonly environment: PaymentEnvironment;
  readonly pendingSettlement: number;
  readonly available: number;
  readonly reserved: number;
  readonly blockedPayouts: number;
  readonly blockedRefunds: number;
  readonly blocked: number;
  readonly withdrawable: number;
  readonly totalMerchantFunds: number;
}

export interface MerchantBalanceInput {
  readonly merchantId: string;
  readonly environment: PaymentEnvironment;
}

export interface MerchantBalanceDatabaseStore {
  getBalance(input: MerchantBalanceInput): Promise<MerchantBalanceRecord>;
}

export interface SandboxPaidEvidenceInput {
  readonly paymentId: string;
  readonly simulationSourceId: string;
  readonly amountCents: number;
  readonly providerCostCents: number;
  readonly payloadHash: string;
  readonly occurredAt: string;
}

export type SandboxPaidEvidenceResult = {
  readonly kind: 'applied' | 'absorbed' | 'rejected';
  readonly payment: PublicPaymentRecord | null;
  readonly providerEventId: string | null;
  readonly ledgerTransactionId: string | null;
  readonly webhookEventId: string | null;
};

export interface SandboxPaidEvidenceDatabaseStore {
  applyPaidEvidence(input: SandboxPaidEvidenceInput): Promise<SandboxPaidEvidenceResult>;
}

export class RuntimeFinancialStoreError extends Error {
  constructor() {
    super('Runtime financial database operation failed');
    this.name = 'RuntimeFinancialStoreError';
  }
}

interface RoutineRow { result: unknown }

const GET_BALANCE_SQL = `
select app.get_api_balance($1::uuid, $2::text) as result
`;

const APPLY_PAID_SQL = `
select app.apply_sandbox_pix_paid(
  $1::uuid, $2::uuid, $3::bigint, $4::bigint, $5::text, $6::timestamptz
) as result
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isEnvironment(value: unknown): value is PaymentEnvironment {
  return value === 'sandbox' || value === 'production';
}

function mapPublicPix(value: unknown): PublicPixRecord | null {
  if (value === null) return null;
  if (!isRecord(value)
      || !hasExactlyKeys(value, ['txId', 'qrCode', 'copyAndPaste', 'expiresAt'])
      || !isNonemptyString(value.txId)
      || !isNonemptyString(value.qrCode)
      || !isNonemptyString(value.copyAndPaste)
      || !isNonemptyString(value.expiresAt)) {
    throw new RuntimeFinancialStoreError();
  }
  return {
    txId: value.txId,
    qrCode: value.qrCode,
    copyAndPaste: value.copyAndPaste,
    expiresAt: value.expiresAt,
  };
}

function mapPublicPayment(value: unknown): PublicPaymentRecord {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    'id', 'externalId', 'method', 'amount', 'fee', 'netAmount', 'currency',
    'status', 'description', 'environment', 'expiresAt', 'createdAt', 'pix',
  ])) {
    throw new RuntimeFinancialStoreError();
  }

  const statuses = ['creating', 'pending', 'paid', 'failed', 'expired', 'cancelled'];
  if (!isUuid(value.id)
      || !isNullableString(value.externalId)
      || value.method !== 'pix'
      || !isSafeNonnegativeInteger(value.amount) || value.amount < 1
      || !isSafeNonnegativeInteger(value.fee)
      || !isSafeNonnegativeInteger(value.netAmount)
      || value.currency !== 'BRL'
      || !statuses.includes(String(value.status))
      || !isNullableString(value.description)
      || !isEnvironment(value.environment)
      || !isNonemptyString(value.expiresAt)
      || !isNonemptyString(value.createdAt)) {
    throw new RuntimeFinancialStoreError();
  }

  const pix = mapPublicPix(value.pix);
  const pixExpected = value.status === 'pending' || value.status === 'paid';
  if ((pixExpected && pix === null) || (!pixExpected && pix !== null)) {
    throw new RuntimeFinancialStoreError();
  }

  return {
    id: value.id,
    externalId: value.externalId,
    method: 'pix',
    amount: value.amount,
    fee: value.fee,
    netAmount: value.netAmount,
    currency: 'BRL',
    status: value.status as PublicPaymentRecord['status'],
    description: value.description,
    environment: value.environment,
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
    pix,
  };
}

function oneRoutineValue(result: { rows: RoutineRow[] }): unknown {
  if (result.rows.length !== 1 || !Object.hasOwn(result.rows[0] ?? {}, 'result')) {
    throw new RuntimeFinancialStoreError();
  }
  return result.rows[0]?.result;
}

function mapBalance(value: unknown): MerchantBalanceRecord {
  const keys = [
    'currency', 'environment', 'pendingSettlement', 'available', 'reserved',
    'blockedPayouts', 'blockedRefunds', 'blocked', 'withdrawable', 'totalMerchantFunds',
  ] as const;
  if (!isRecord(value) || !hasExactlyKeys(value, keys)
      || value.currency !== 'BRL'
      || !isEnvironment(value.environment)
      || !isSafeNonnegativeInteger(value.pendingSettlement)
      || !isSafeNonnegativeInteger(value.available)
      || !isSafeNonnegativeInteger(value.reserved)
      || !isSafeNonnegativeInteger(value.blockedPayouts)
      || !isSafeNonnegativeInteger(value.blockedRefunds)
      || !isSafeNonnegativeInteger(value.blocked)
      || !isSafeNonnegativeInteger(value.withdrawable)
      || !isSafeNonnegativeInteger(value.totalMerchantFunds)) {
    throw new RuntimeFinancialStoreError();
  }

  const blocked = value.blockedPayouts + value.blockedRefunds;
  const total = value.pendingSettlement + value.available + value.reserved + blocked;
  if (value.blocked !== blocked || value.withdrawable !== value.available || value.totalMerchantFunds !== total) {
    throw new RuntimeFinancialStoreError();
  }

  return {
    currency: 'BRL',
    environment: value.environment,
    pendingSettlement: value.pendingSettlement,
    available: value.available,
    reserved: value.reserved,
    blockedPayouts: value.blockedPayouts,
    blockedRefunds: value.blockedRefunds,
    blocked: value.blocked,
    withdrawable: value.withdrawable,
    totalMerchantFunds: value.totalMerchantFunds,
  };
}

function mapPaidEvidence(value: unknown): SandboxPaidEvidenceResult {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    'kind', 'payment', 'providerEventId', 'ledgerTransactionId', 'webhookEventId',
  ]) || !['applied', 'absorbed', 'rejected'].includes(String(value.kind))
      || !isNullableUuid(value.providerEventId)
      || !isNullableUuid(value.ledgerTransactionId)
      || !isNullableUuid(value.webhookEventId)) {
    throw new RuntimeFinancialStoreError();
  }

  const payment = value.payment === null ? null : mapPublicPayment(value.payment);
  if (value.kind === 'applied' && (
    payment === null
    || value.providerEventId === null
    || value.ledgerTransactionId === null
    || value.webhookEventId === null
  )) {
    throw new RuntimeFinancialStoreError();
  }

  return {
    kind: value.kind as SandboxPaidEvidenceResult['kind'],
    payment,
    providerEventId: value.providerEventId,
    ledgerTransactionId: value.ledgerTransactionId,
    webhookEventId: value.webhookEventId,
  };
}

export function createMerchantBalanceStore(pool: QueryOnlyPool): MerchantBalanceDatabaseStore {
  return {
    async getBalance(input) {
      try {
        const result = await pool.query<RoutineRow>(GET_BALANCE_SQL, [input.merchantId, input.environment]);
        return mapBalance(oneRoutineValue(result));
      } catch {
        throw new RuntimeFinancialStoreError();
      }
    },
  };
}

export function createSandboxPaidEvidenceStore(pool: QueryOnlyPool): SandboxPaidEvidenceDatabaseStore {
  return {
    async applyPaidEvidence(input) {
      try {
        const result = await pool.query<RoutineRow>(APPLY_PAID_SQL, [
          input.paymentId,
          input.simulationSourceId,
          input.amountCents,
          input.providerCostCents,
          input.payloadHash,
          input.occurredAt,
        ]);
        return mapPaidEvidence(oneRoutineValue(result));
      } catch {
        throw new RuntimeFinancialStoreError();
      }
    },
  };
}
