import type pg from 'pg';

type PaymentEnvironment = 'sandbox' | 'production';
type QueryOnlyPool = Pick<pg.Pool, 'query'>;

export interface PixCreateRequestRecord {
  readonly method: 'pix';
  readonly amount: number;
  readonly currency: 'BRL';
  readonly description?: string;
  readonly externalId?: string;
  readonly pixExpirationMinutes: number;
  readonly customerName?: string;
  readonly customerDocument?: string;
  readonly customerEmail?: string;
  readonly customerPhone?: string;
}

export interface SandboxPricingRecord {
  readonly pricingVersion: 'sandbox-zero-fee-v0';
  readonly feeMode: 'fixed';
  readonly feeFixedCents: 0;
  readonly feeBasisPoints: 0;
  readonly feePercentageComponentCents: 0;
  readonly merchantFeeCents: 0;
  readonly merchantNetCents: number;
  readonly roundingPolicyVersion: 'ceil-bp-v1';
  readonly refundFeePolicy: 'merchant_fee_non_refundable';
}

export interface PublicPixRecord {
  readonly txId: string;
  readonly qrCode: string;
  readonly copyAndPaste: string;
  readonly expiresAt: string;
}

export interface PublicPaymentRecord {
  readonly id: string;
  readonly externalId: string | null;
  readonly method: 'pix';
  readonly amount: number;
  readonly fee: number;
  readonly netAmount: number;
  readonly currency: 'BRL';
  readonly status: 'creating' | 'pending' | 'failed';
  readonly description: string | null;
  readonly environment: PaymentEnvironment;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly pix: PublicPixRecord | null;
}

export interface PreparedProviderAttemptRecord {
  readonly id: string;
  readonly amountCents: number;
  readonly expiresAt: string;
}

export type PreparePixPaymentRecord =
  | {
    readonly kind: 'prepared';
    readonly payment: PublicPaymentRecord;
    readonly providerAttempt: PreparedProviderAttemptRecord;
  }
  | {
    readonly kind: 'completed';
    readonly httpStatus: 201;
    readonly payment: PublicPaymentRecord;
  }
  | {
    readonly kind: 'executing' | 'execution_unknown';
    readonly payment: PublicPaymentRecord;
  }
  | { readonly kind: 'conflict' };

export type ClaimPixAttemptRecord =
  | { readonly claimed: true; readonly executionToken: string }
  | { readonly claimed: false };

export interface PreparePixPaymentRecordInput {
  readonly merchantId: string;
  readonly environment: 'sandbox';
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly request: PixCreateRequestRecord;
  readonly pricing: SandboxPricingRecord;
  readonly routingPolicyVersion: 'sandbox-emulator-v0';
}

export interface ClaimPixAttemptRecordInput {
  readonly merchantId: string;
  readonly environment: 'sandbox';
  readonly paymentId: string;
  readonly providerAttemptId: string;
}

export interface ResolvePixAttemptRecordInput {
  readonly merchantId: string;
  readonly environment: 'sandbox';
  readonly paymentId: string;
  readonly providerAttemptId: string;
  readonly executionToken: string;
  readonly resolution: unknown;
}

export interface GetPaymentRecordInput {
  readonly merchantId: string;
  readonly environment: PaymentEnvironment;
  readonly paymentId: string;
}

export interface PixPaymentDatabaseStore {
  preparePixPayment(input: PreparePixPaymentRecordInput): Promise<PreparePixPaymentRecord>;
  claimPixAttempt(input: ClaimPixAttemptRecordInput): Promise<ClaimPixAttemptRecord>;
  resolvePixAttempt(input: ResolvePixAttemptRecordInput): Promise<PublicPaymentRecord>;
  getPayment(input: GetPaymentRecordInput): Promise<PublicPaymentRecord | null>;
}

export class RuntimePixStoreError extends Error {
  constructor() {
    super('Runtime Pix database operation failed');
    this.name = 'RuntimePixStoreError';
  }
}

interface PixRoutineRow {
  result: unknown;
}

const PREPARE_PIX_SQL = `
select app.prepare_api_pix_payment(
  $1::uuid,
  $2::text,
  $3::text,
  $4::text,
  $5::jsonb,
  $6::jsonb,
  $7::text
) as result
`;

const CLAIM_PIX_SQL = `
select app.claim_api_pix_attempt(
  $1::uuid,
  $2::text,
  $3::uuid,
  $4::uuid
) as result
`;

const RESOLVE_PIX_SQL = `
select app.resolve_api_pix_attempt(
  $1::uuid,
  $2::text,
  $3::uuid,
  $4::uuid,
  $5::uuid,
  $6::jsonb
) as result
`;

const GET_PAYMENT_SQL = `
select app.get_api_payment(
  $1::uuid,
  $2::text,
  $3::uuid
) as result
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPaymentEnvironment(value: unknown): value is PaymentEnvironment {
  return value === 'sandbox' || value === 'production';
}

function mapPublicPix(value: unknown): PublicPixRecord | null {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactlyKeys(value, ['txId', 'qrCode', 'copyAndPaste', 'expiresAt'])) {
    throw new RuntimePixStoreError();
  }
  if (
    !isNonemptyString(value.txId)
    || !isNonemptyString(value.qrCode)
    || !isNonemptyString(value.copyAndPaste)
    || !isNonemptyString(value.expiresAt)
  ) {
    throw new RuntimePixStoreError();
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
    'id',
    'externalId',
    'method',
    'amount',
    'fee',
    'netAmount',
    'currency',
    'status',
    'description',
    'environment',
    'expiresAt',
    'createdAt',
    'pix',
  ])) {
    throw new RuntimePixStoreError();
  }

  if (
    !isUuid(value.id)
    || !isNullableString(value.externalId)
    || value.method !== 'pix'
    || !isSafeNonnegativeInteger(value.amount)
    || value.amount < 1
    || !isSafeNonnegativeInteger(value.fee)
    || !isSafeNonnegativeInteger(value.netAmount)
    || value.currency !== 'BRL'
    || !['creating', 'pending', 'failed'].includes(String(value.status))
    || !isNullableString(value.description)
    || !isPaymentEnvironment(value.environment)
    || !isNonemptyString(value.expiresAt)
    || !isNonemptyString(value.createdAt)
  ) {
    throw new RuntimePixStoreError();
  }

  const pix = mapPublicPix(value.pix);
  if (value.status === 'pending' && pix === null) {
    throw new RuntimePixStoreError();
  }
  if (value.status !== 'pending' && pix !== null) {
    throw new RuntimePixStoreError();
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

function mapPreparedProviderAttempt(value: unknown): PreparedProviderAttemptRecord {
  if (!isRecord(value) || !hasExactlyKeys(value, ['id', 'amountCents', 'expiresAt'])) {
    throw new RuntimePixStoreError();
  }
  if (
    !isUuid(value.id)
    || !isSafeNonnegativeInteger(value.amountCents)
    || value.amountCents < 1
    || !isNonemptyString(value.expiresAt)
  ) {
    throw new RuntimePixStoreError();
  }
  return {
    id: value.id,
    amountCents: value.amountCents,
    expiresAt: value.expiresAt,
  };
}

function mapPrepareResult(value: unknown): PreparePixPaymentRecord {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new RuntimePixStoreError();
  }

  if (value.kind === 'conflict') {
    if (!hasExactlyKeys(value, ['kind'])) throw new RuntimePixStoreError();
    return { kind: 'conflict' };
  }

  if (value.kind === 'prepared') {
    if (!hasExactlyKeys(value, ['kind', 'payment', 'providerAttempt'])) {
      throw new RuntimePixStoreError();
    }
    return {
      kind: 'prepared',
      payment: mapPublicPayment(value.payment),
      providerAttempt: mapPreparedProviderAttempt(value.providerAttempt),
    };
  }

  if (value.kind === 'completed') {
    if (!hasExactlyKeys(value, ['kind', 'httpStatus', 'payment']) || value.httpStatus !== 201) {
      throw new RuntimePixStoreError();
    }
    return {
      kind: 'completed',
      httpStatus: 201,
      payment: mapPublicPayment(value.payment),
    };
  }

  if (value.kind === 'executing' || value.kind === 'execution_unknown') {
    if (!hasExactlyKeys(value, ['kind', 'payment'])) throw new RuntimePixStoreError();
    return {
      kind: value.kind,
      payment: mapPublicPayment(value.payment),
    };
  }

  throw new RuntimePixStoreError();
}

function mapClaimResult(value: unknown): ClaimPixAttemptRecord {
  if (!isRecord(value) || typeof value.claimed !== 'boolean') {
    throw new RuntimePixStoreError();
  }
  if (value.claimed) {
    if (!hasExactlyKeys(value, ['claimed', 'executionToken']) || !isUuid(value.executionToken)) {
      throw new RuntimePixStoreError();
    }
    return { claimed: true, executionToken: value.executionToken };
  }
  if (!hasExactlyKeys(value, ['claimed'])) throw new RuntimePixStoreError();
  return { claimed: false };
}

function oneRoutineValue(result: { rows: PixRoutineRow[] }): unknown {
  if (result.rows.length !== 1 || !Object.hasOwn(result.rows[0] ?? {}, 'result')) {
    throw new RuntimePixStoreError();
  }
  return result.rows[0]?.result;
}

export function createPixPaymentStore(pool: QueryOnlyPool): PixPaymentDatabaseStore {
  return {
    async preparePixPayment(input) {
      try {
        const result = await pool.query<PixRoutineRow>(PREPARE_PIX_SQL, [
          input.merchantId,
          input.environment,
          input.idempotencyKey,
          input.requestHash,
          input.request,
          input.pricing,
          input.routingPolicyVersion,
        ]);
        return mapPrepareResult(oneRoutineValue(result));
      } catch {
        throw new RuntimePixStoreError();
      }
    },

    async claimPixAttempt(input) {
      try {
        const result = await pool.query<PixRoutineRow>(CLAIM_PIX_SQL, [
          input.merchantId,
          input.environment,
          input.paymentId,
          input.providerAttemptId,
        ]);
        return mapClaimResult(oneRoutineValue(result));
      } catch {
        throw new RuntimePixStoreError();
      }
    },

    async resolvePixAttempt(input) {
      try {
        const result = await pool.query<PixRoutineRow>(RESOLVE_PIX_SQL, [
          input.merchantId,
          input.environment,
          input.paymentId,
          input.providerAttemptId,
          input.executionToken,
          input.resolution,
        ]);
        return mapPublicPayment(oneRoutineValue(result));
      } catch {
        throw new RuntimePixStoreError();
      }
    },

    async getPayment(input) {
      try {
        const result = await pool.query<PixRoutineRow>(GET_PAYMENT_SQL, [
          input.merchantId,
          input.environment,
          input.paymentId,
        ]);
        const value = oneRoutineValue(result);
        return value === null ? null : mapPublicPayment(value);
      } catch {
        throw new RuntimePixStoreError();
      }
    },
  };
}
