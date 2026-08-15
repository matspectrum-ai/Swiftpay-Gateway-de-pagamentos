import { createHash } from 'node:crypto';

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
