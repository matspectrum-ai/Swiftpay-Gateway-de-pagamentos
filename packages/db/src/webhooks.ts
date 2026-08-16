import type { RuntimePool } from './index.js';

type QueryOnlyPool = Pick<RuntimePool, 'query'>;

type SwiftpayEnvironment = 'sandbox' | 'production';
type WebhookErrorClass =
  | 'transient'
  | 'rate_limited'
  | 'configuration'
  | 'validation'
  | 'permanent'
  | 'internal';

export interface RuntimeMerchantWebhookDeliveryClaim {
  readonly jobId: string;
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: string;
  readonly endpoint: {
    readonly id: string;
    readonly url: string;
    readonly environment: SwiftpayEnvironment;
    readonly signingSecretVersion: number;
    readonly signingSecretCiphertext: string | null;
  };
  readonly event: {
    readonly id: string;
    readonly type: string;
    readonly occurredAt: string;
    readonly payloadVersion: string;
    readonly payload: Record<string, unknown>;
  };
}

export interface RuntimeMerchantWebhookResolution {
  readonly jobId: string;
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly outcome: 'success' | 'retry' | 'terminal';
  readonly httpStatus: number | null;
  readonly errorClass: WebhookErrorClass | null;
  readonly errorCode: string | null;
  readonly retryAfterSeconds: number | null;
}

export interface RuntimeMerchantWebhookDeliveryStore {
  claim(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<readonly RuntimeMerchantWebhookDeliveryClaim[]>;
  resolve(input: RuntimeMerchantWebhookResolution): Promise<boolean>;
}

export class RuntimeWebhookDeliveryStoreError extends Error {
  constructor() {
    super('Runtime webhook delivery database operation failed');
    this.name = 'RuntimeWebhookDeliveryStoreError';
  }
}

const CLAIM_SQL = `
select delivery
from app.claim_merchant_webhook_deliveries(
  $1::text,
  $2::integer,
  $3::integer
) as delivery
`;

const RESOLVE_SQL = `
select app.resolve_merchant_webhook_delivery(
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4::text,
  $5::integer,
  $6::text,
  $7::text,
  $8::integer
) as resolved
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CLASSES = new Set<WebhookErrorClass>([
  'transient',
  'rate_limited',
  'configuration',
  'validation',
  'permanent',
  'internal',
]);

function invalid(): never {
  throw new RuntimeWebhookDeliveryStoreError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function mapClaim(value: unknown): RuntimeMerchantWebhookDeliveryClaim {
  if (!isRecord(value) || !hasExactKeys(value, [
    'jobId', 'deliveryId', 'leaseToken', 'attemptNumber', 'maxAttempts',
    'leaseExpiresAt', 'endpoint', 'event',
  ])) invalid();

  const endpoint = value.endpoint;
  const event = value.event;
  if (!isRecord(endpoint) || !hasExactKeys(endpoint, [
    'id', 'url', 'environment', 'signingSecretVersion', 'signingSecretCiphertext',
  ])) invalid();
  if (!isRecord(event) || !hasExactKeys(event, [
    'id', 'type', 'occurredAt', 'payloadVersion', 'payload',
  ])) invalid();

  if (!isUuid(value.jobId)
    || !isUuid(value.deliveryId)
    || !isUuid(value.leaseToken)
    || !isPositiveInteger(value.attemptNumber)
    || !isPositiveInteger(value.maxAttempts)
    || value.maxAttempts > 8
    || value.attemptNumber > value.maxAttempts
    || !isIsoTimestamp(value.leaseExpiresAt)
    || !isUuid(endpoint.id)
    || typeof endpoint.url !== 'string'
    || endpoint.url.length === 0
    || (endpoint.environment !== 'sandbox' && endpoint.environment !== 'production')
    || !isPositiveInteger(endpoint.signingSecretVersion)
    || !(endpoint.signingSecretCiphertext === null || typeof endpoint.signingSecretCiphertext === 'string')
    || !isUuid(event.id)
    || typeof event.type !== 'string'
    || event.type.length === 0
    || !isIsoTimestamp(event.occurredAt)
    || typeof event.payloadVersion !== 'string'
    || event.payloadVersion.length === 0
    || !isRecord(event.payload)) {
    invalid();
  }

  return {
    jobId: value.jobId,
    deliveryId: value.deliveryId,
    leaseToken: value.leaseToken,
    attemptNumber: value.attemptNumber,
    maxAttempts: value.maxAttempts,
    leaseExpiresAt: value.leaseExpiresAt,
    endpoint: {
      id: endpoint.id,
      url: endpoint.url,
      environment: endpoint.environment,
      signingSecretVersion: endpoint.signingSecretVersion,
      signingSecretCiphertext: endpoint.signingSecretCiphertext,
    },
    event: {
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      payloadVersion: event.payloadVersion,
      payload: event.payload,
    },
  };
}

function validateClaimInput(input: { workerId: string; limit: number; leaseSeconds: number }): void {
  if (typeof input.workerId !== 'string'
    || input.workerId.trim().length === 0
    || input.workerId.trim().length > 160
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || input.limit > 50
    || !Number.isSafeInteger(input.leaseSeconds)
    || input.leaseSeconds < 5
    || input.leaseSeconds > 300) {
    invalid();
  }
}

function validateResolutionInput(input: RuntimeMerchantWebhookResolution): void {
  if (!isUuid(input.jobId)
    || !isUuid(input.deliveryId)
    || !isUuid(input.leaseToken)
    || !['success', 'retry', 'terminal'].includes(input.outcome)
    || !(input.httpStatus === null
      || (Number.isSafeInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599))
    || !(input.errorClass === null || ERROR_CLASSES.has(input.errorClass))
    || !(input.errorCode === null || (typeof input.errorCode === 'string' && input.errorCode.length <= 80))
    || !(input.retryAfterSeconds === null
      || (Number.isSafeInteger(input.retryAfterSeconds)
        && input.retryAfterSeconds >= 1
        && input.retryAfterSeconds <= 7200))) {
    invalid();
  }

  if (input.outcome === 'success') {
    if (input.httpStatus === null
      || input.httpStatus < 200
      || input.httpStatus > 299
      || input.errorClass !== null
      || input.errorCode !== null
      || input.retryAfterSeconds !== null) invalid();
  } else if (input.outcome === 'retry') {
    if (input.retryAfterSeconds === null || input.errorClass === null || input.errorCode === null) invalid();
  } else if (input.retryAfterSeconds !== null || input.errorClass === null || input.errorCode === null) {
    invalid();
  }
}

export function createMerchantWebhookDeliveryStore(pool: QueryOnlyPool): RuntimeMerchantWebhookDeliveryStore {
  return {
    async claim(input) {
      validateClaimInput(input);
      try {
        const result = await pool.query<{ delivery: unknown }>(CLAIM_SQL, [
          input.workerId.trim(),
          input.limit,
          input.leaseSeconds,
        ]);
        return result.rows.map((row) => mapClaim(row.delivery));
      } catch (error) {
        if (error instanceof RuntimeWebhookDeliveryStoreError) throw error;
        throw new RuntimeWebhookDeliveryStoreError();
      }
    },

    async resolve(input) {
      validateResolutionInput(input);
      try {
        const result = await pool.query<{ resolved: unknown }>(RESOLVE_SQL, [
          input.jobId,
          input.deliveryId,
          input.leaseToken,
          input.outcome,
          input.httpStatus,
          input.errorClass,
          input.errorCode,
          input.retryAfterSeconds,
        ]);
        const resolved = result.rows[0]?.resolved;
        if (typeof resolved !== 'boolean') invalid();
        return resolved;
      } catch (error) {
        if (error instanceof RuntimeWebhookDeliveryStoreError) throw error;
        throw new RuntimeWebhookDeliveryStoreError();
      }
    },
  };
}
