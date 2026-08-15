import { createHash } from 'node:crypto';

export type PaymentEnvironment = 'sandbox' | 'production';

export interface PixCreateRequest {
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

export interface ValidationViolation {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export type PixCreateValidationResult =
  | { readonly ok: true; readonly value: PixCreateRequest }
  | { readonly ok: false; readonly violations: readonly ValidationViolation[] };

export type IdempotencyKeyResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly violation: ValidationViolation };

export type PixEmulatorOutcome = 'success_pending' | 'execution_unknown' | 'definitive_rejection';

export interface PixEmulatorCreateInput {
  readonly providerAttemptId: string;
  readonly amountCents: number;
  readonly expiresAt: string;
}

export interface PixEmulatorSuccess {
  readonly certainty: 'success';
  readonly providerPaymentId: string;
  readonly txId: string;
  readonly copyAndPaste: string;
  readonly qrCode: string;
  readonly expiresAt: string;
}

export interface PixEmulatorExecutionUnknown {
  readonly certainty: 'execution_unknown';
  readonly errorClass: 'execution_unknown';
}

export interface PixEmulatorDefinitiveRejection {
  readonly certainty: 'definitive_rejection';
  readonly errorClass: 'definitive_rejection';
  readonly errorCode: 'emulator_rejected';
}

export type PixEmulatorCreateResult =
  | PixEmulatorSuccess
  | PixEmulatorExecutionUnknown
  | PixEmulatorDefinitiveRejection;

export interface PixEmulator {
  createPixCharge(input: PixEmulatorCreateInput): Promise<PixEmulatorCreateResult>;
}

export interface MachinePaymentPrincipal {
  readonly merchantId: string;
  readonly credentialId: string;
  readonly environment: PaymentEnvironment;
  readonly secretVersion: number;
  readonly tokenId: string;
}

export interface PublicPixFields {
  readonly txId: string;
  readonly qrCode: string;
  readonly copyAndPaste: string;
  readonly expiresAt: string;
}

export interface PublicPayment {
  readonly id: string;
  readonly externalId: string | null;
  readonly method: 'pix';
  readonly amount: number;
  readonly fee: number;
  readonly netAmount: number;
  readonly currency: 'BRL';
  readonly status: 'creating' | 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
  readonly description: string | null;
  readonly environment: PaymentEnvironment;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly pix: PublicPixFields | null;
}

export interface SandboxPricingSnapshot {
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

export interface PreparePixPaymentInput {
  readonly merchantId: string;
  readonly environment: 'sandbox';
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly request: PixCreateRequest;
  readonly pricing: SandboxPricingSnapshot;
  readonly routingPolicyVersion: 'sandbox-emulator-v0';
}

export interface PreparedProviderAttempt {
  readonly id: string;
  readonly amountCents: number;
  readonly expiresAt: string;
}

export type PreparePixPaymentResult =
  | {
    readonly kind: 'prepared';
    readonly payment: PublicPayment;
    readonly providerAttempt: PreparedProviderAttempt;
  }
  | {
    readonly kind: 'completed';
    readonly httpStatus: 201;
    readonly payment: PublicPayment;
  }
  | {
    readonly kind: 'executing' | 'execution_unknown';
    readonly payment: PublicPayment;
  }
  | { readonly kind: 'conflict' };

export interface ClaimPixAttemptInput {
  readonly merchantId: string;
  readonly environment: 'sandbox';
  readonly paymentId: string;
  readonly providerAttemptId: string;
}

export type ClaimPixAttemptResult =
  | { readonly claimed: true; readonly executionToken: string }
  | { readonly claimed: false };

export interface ResolvePixAttemptInput {
  readonly merchantId: string;
  readonly environment: 'sandbox';
  readonly paymentId: string;
  readonly providerAttemptId: string;
  readonly executionToken: string;
  readonly resolution: PixEmulatorCreateResult;
}

export interface GetPaymentInput {
  readonly merchantId: string;
  readonly environment: PaymentEnvironment;
  readonly paymentId: string;
}

export interface PixPaymentStore {
  preparePixPayment(input: PreparePixPaymentInput): Promise<PreparePixPaymentResult>;
  claimPixAttempt(input: ClaimPixAttemptInput): Promise<ClaimPixAttemptResult>;
  resolvePixAttempt(input: ResolvePixAttemptInput): Promise<PublicPayment>;
  getPayment(input: GetPaymentInput): Promise<PublicPayment | null>;
}

export interface CreatePixPaymentInput {
  readonly principal: MachinePaymentPrincipal;
  readonly idempotencyKey: unknown;
  readonly request: unknown;
}

export type PixPaymentServiceErrorCode =
  | 'validation_error'
  | 'idempotency_key_reused'
  | 'operation_forbidden'
  | 'internal_error';

export type CreatePixPaymentResult =
  | {
    readonly ok: true;
    readonly httpStatus: 201 | 202;
    readonly payment: PublicPayment;
    readonly replayed: boolean;
  }
  | {
    readonly ok: false;
    readonly httpStatus: 400 | 403 | 409 | 500;
    readonly error: {
      readonly code: PixPaymentServiceErrorCode;
      readonly message: string;
      readonly details?: readonly ValidationViolation[];
    };
  };

export interface PixPaymentService {
  create(input: CreatePixPaymentInput): Promise<CreatePixPaymentResult>;
}

const PIX_CREATE_FIELDS = new Set([
  'method',
  'amount',
  'currency',
  'description',
  'externalId',
  'pixExpirationMinutes',
  'customerName',
  'customerDocument',
  'customerEmail',
  'customerPhone',
]);

function violation(field: string, code: string, message: string): ValidationViolation {
  return { field, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateOptionalString(
  body: Record<string, unknown>,
  field: string,
  allowEmpty: boolean,
  violations: ValidationViolation[],
): string | undefined {
  if (!(field in body)) return undefined;

  const value = body[field];
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    violations.push(violation(field, 'invalid_field', `${field} is invalid.`));
    return undefined;
  }
  return value;
}

export function validatePixCreateRequest(input: unknown): PixCreateValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      violations: [violation('$', 'invalid_body', 'Request body must be a JSON object.')],
    };
  }

  const violations: ValidationViolation[] = [];
  for (const field of Object.keys(input)) {
    if (!PIX_CREATE_FIELDS.has(field)) {
      violations.push(violation(field, 'unknown_field', `${field} is not allowed.`));
    }
  }

  if (input.method !== 'pix') {
    violations.push(violation('method', 'invalid_field', 'method must be pix.'));
  }

  if (typeof input.amount !== 'number' || !Number.isSafeInteger(input.amount) || input.amount < 1) {
    violations.push(violation('amount', 'invalid_field', 'amount must be a positive safe integer in centavos.'));
  }

  if (input.currency !== 'BRL') {
    violations.push(violation('currency', 'invalid_field', 'currency must be BRL.'));
  }

  const description = validateOptionalString(input, 'description', true, violations);
  const externalId = validateOptionalString(input, 'externalId', false, violations);
  const customerName = validateOptionalString(input, 'customerName', false, violations);
  const customerDocument = validateOptionalString(input, 'customerDocument', false, violations);
  const customerEmail = validateOptionalString(input, 'customerEmail', false, violations);
  const customerPhone = validateOptionalString(input, 'customerPhone', false, violations);

  let pixExpirationMinutes = 60;
  if ('pixExpirationMinutes' in input) {
    if (
      typeof input.pixExpirationMinutes !== 'number'
      || !Number.isSafeInteger(input.pixExpirationMinutes)
      || input.pixExpirationMinutes < 5
      || input.pixExpirationMinutes > 1440
    ) {
      violations.push(violation(
        'pixExpirationMinutes',
        'invalid_field',
        'pixExpirationMinutes must be an integer from 5 through 1440.',
      ));
    } else {
      pixExpirationMinutes = input.pixExpirationMinutes;
    }
  }

  if (violations.length > 0) {
    return { ok: false, violations };
  }

  const value: PixCreateRequest = {
    method: 'pix',
    amount: input.amount as number,
    currency: 'BRL',
    pixExpirationMinutes,
    ...(description !== undefined ? { description } : {}),
    ...(externalId !== undefined ? { externalId } : {}),
    ...(customerName !== undefined ? { customerName } : {}),
    ...(customerDocument !== undefined ? { customerDocument } : {}),
    ...(customerEmail !== undefined ? { customerEmail } : {}),
    ...(customerPhone !== undefined ? { customerPhone } : {}),
  };

  return { ok: true, value };
}

export function normalizePixCreateIdempotencyKey(input: unknown): IdempotencyKeyResult {
  if (typeof input !== 'string') {
    return {
      ok: false,
      violation: violation('Idempotency-Key', 'invalid_idempotency_key', 'Idempotency-Key is required.'),
    };
  }

  const value = input.trim();
  if (value.length < 1 || value.length > 160) {
    return {
      ok: false,
      violation: violation(
        'Idempotency-Key',
        'invalid_idempotency_key',
        'Idempotency-Key must contain from 1 through 160 characters.',
      ),
    };
  }

  return { ok: true, value };
}

export function hashPixCreateRequest(request: PixCreateRequest): string {
  const vector = [
    request.method,
    request.amount,
    request.currency,
    request.externalId ?? null,
    request.description ?? null,
    request.pixExpirationMinutes,
    request.customerName ?? null,
    request.customerDocument ?? null,
    request.customerEmail ?? null,
    request.customerPhone ?? null,
  ];

  return createHash('sha256')
    .update(`pix-create-v0\n${JSON.stringify(vector)}`, 'utf8')
    .digest('hex');
}

export function createDeterministicPixEmulator(
  options: { readonly outcome?: PixEmulatorOutcome } = {},
): PixEmulator {
  const outcome = options.outcome ?? 'success_pending';

  return {
    async createPixCharge(input) {
      switch (outcome) {
        case 'execution_unknown':
          return {
            certainty: 'execution_unknown',
            errorClass: 'execution_unknown',
          };
        case 'definitive_rejection':
          return {
            certainty: 'definitive_rejection',
            errorClass: 'definitive_rejection',
            errorCode: 'emulator_rejected',
          };
        case 'success_pending':
          return {
            certainty: 'success',
            providerPaymentId: `swiftpay-emulator-payment:${input.providerAttemptId}`,
            txId: `swiftpay-emulator-tx:${input.providerAttemptId}`,
            copyAndPaste: `SWIFTPAY_EMULATOR_COPY_${input.providerAttemptId}`,
            qrCode: `SWIFTPAY_EMULATOR_QR_${input.providerAttemptId}`,
            expiresAt: input.expiresAt,
          };
      }
    },
  };
}

function createSandboxPricing(amountCents: number): SandboxPricingSnapshot {
  return {
    pricingVersion: 'sandbox-zero-fee-v0',
    feeMode: 'fixed',
    feeFixedCents: 0,
    feeBasisPoints: 0,
    feePercentageComponentCents: 0,
    merchantFeeCents: 0,
    merchantNetCents: amountCents,
    roundingPolicyVersion: 'ceil-bp-v1',
    refundFeePolicy: 'merchant_fee_non_refundable',
  };
}

function validationFailure(violations: readonly ValidationViolation[]): CreatePixPaymentResult {
  return {
    ok: false,
    httpStatus: 400,
    error: {
      code: 'validation_error',
      message: 'Pix create request is invalid.',
      details: violations,
    },
  };
}

export function createPixPaymentService(
  store: PixPaymentStore,
  emulator: PixEmulator,
): PixPaymentService {
  return {
    async create(input) {
      if (input.principal.environment !== 'sandbox') {
        return {
          ok: false,
          httpStatus: 403,
          error: {
            code: 'operation_forbidden',
            message: 'Pix creation is not enabled for this environment.',
          },
        };
      }

      const requestValidation = validatePixCreateRequest(input.request);
      const idempotencyValidation = normalizePixCreateIdempotencyKey(input.idempotencyKey);
      if (!requestValidation.ok || !idempotencyValidation.ok) {
        const violations: ValidationViolation[] = [];
        if (!requestValidation.ok) violations.push(...requestValidation.violations);
        if (!idempotencyValidation.ok) violations.push(idempotencyValidation.violation);
        return validationFailure(violations);
      }

      const request = requestValidation.value;
      const prepared = await store.preparePixPayment({
        merchantId: input.principal.merchantId,
        environment: 'sandbox',
        idempotencyKey: idempotencyValidation.value,
        requestHash: hashPixCreateRequest(request),
        request,
        pricing: createSandboxPricing(request.amount),
        routingPolicyVersion: 'sandbox-emulator-v0',
      });

      if (prepared.kind === 'conflict') {
        return {
          ok: false,
          httpStatus: 409,
          error: {
            code: 'idempotency_key_reused',
            message: 'Idempotency-Key was already used with a different request.',
          },
        };
      }

      if (prepared.kind === 'completed') {
        return {
          ok: true,
          httpStatus: prepared.httpStatus,
          payment: prepared.payment,
          replayed: true,
        };
      }

      if (prepared.kind === 'executing' || prepared.kind === 'execution_unknown') {
        return {
          ok: true,
          httpStatus: 202,
          payment: prepared.payment,
          replayed: true,
        };
      }

      if (prepared.kind !== 'prepared') {
        return {
          ok: false,
          httpStatus: 500,
          error: {
            code: 'internal_error',
            message: 'Payment preparation returned an invalid state.',
          },
        };
      }

      const claim = await store.claimPixAttempt({
        merchantId: input.principal.merchantId,
        environment: 'sandbox',
        paymentId: prepared.payment.id,
        providerAttemptId: prepared.providerAttempt.id,
      });

      if (!claim.claimed) {
        const currentPayment = await store.getPayment({
          merchantId: input.principal.merchantId,
          environment: 'sandbox',
          paymentId: prepared.payment.id,
        });

        if (currentPayment === null) {
          return {
            ok: false,
            httpStatus: 500,
            error: {
              code: 'internal_error',
              message: 'Payment state is unavailable.',
            },
          };
        }

        return {
          ok: true,
          httpStatus: 202,
          payment: currentPayment,
          replayed: true,
        };
      }

      const resolution = await emulator.createPixCharge({
        providerAttemptId: prepared.providerAttempt.id,
        amountCents: prepared.providerAttempt.amountCents,
        expiresAt: prepared.providerAttempt.expiresAt,
      });
      const resolvedPayment = await store.resolvePixAttempt({
        merchantId: input.principal.merchantId,
        environment: 'sandbox',
        paymentId: prepared.payment.id,
        providerAttemptId: prepared.providerAttempt.id,
        executionToken: claim.executionToken,
        resolution,
      });

      return {
        ok: true,
        httpStatus: resolution.certainty === 'execution_unknown' ? 202 : 201,
        payment: resolvedPayment,
        replayed: false,
      };
    },
  };
}
