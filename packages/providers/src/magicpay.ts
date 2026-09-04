import { Buffer } from 'node:buffer';

import type { ProviderRequest, ProviderResponse, ProviderTransport } from './index.js';

const MAGICPAY_GAPS = Object.freeze([
  'pix_create_success_response_schema',
  'pix_qr_copy_and_paste_field',
  'transaction_query_response_envelope',
  'create_idempotency_semantics',
  'ambiguous_create_recovery',
  'provider_error_certainty_contract',
  'sandbox_environment',
  'webhook_authentication',
  'webhook_replay_identity',
  'rate_limits',
] as const);

export const MAGICPAY_CONTRACT_EVIDENCE = Object.freeze({
  provider: 'magicpay' as const,
  status: 'partial_contract_only' as const,
  sourceSha256: 'b9b493227d45b880077383c145e9ca5a0c16e6fae327b84d2c614566b8c47104',
  baseUrl: 'https://api.dashboardmagicpay.com/v1',
  auth: 'basic_public_secret' as const,
  livePixAdapter: false as const,
  webhookAuthority: false as const,
  withdrawalAuthority: false as const,
  gaps: MAGICPAY_GAPS,
});

const MAGICPAY_RESPONSE_QUERY_GAPS = Object.freeze([
  'pix_create_nested_pix_object_fields',
  'canonical_pix_copy_and_paste_semantics',
  'create_idempotency_semantics',
  'ambiguous_create_recovery',
  'provider_error_certainty_contract',
  'sandbox_environment',
  'authenticated_provider_proof',
  'webhook_authentication',
  'webhook_replay_identity',
  'rate_limits',
] as const);

export const MAGICPAY_RESPONSE_QUERY_EVIDENCE = Object.freeze({
  provider: 'magicpay' as const,
  status: 'response_query_contract_proven' as const,
  sourceSha256: '8838db6276152af9d43d16ce71fa32cb9310b01f46f10c20897dea668d2f6833',
  livePixAdapter: false as const,
  canonicalPixCopyAndPaste: false as const,
  a10Registered: false as const,
  gaps: MAGICPAY_RESPONSE_QUERY_GAPS,
});

type AnyRecord = Record<string, unknown>;

type MagicPayCredentials = {
  publicKey: string;
  secretKey: string;
};

type MagicPayPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'disputed';

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function digits(value: unknown): string | null {
  const text = trimmed(value);
  if (text === null) return null;
  const normalized = text.replace(/\D/g, '');
  return normalized.length > 0 ? normalized : null;
}

function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validPositiveInt32(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= 2_147_483_647;
}

function positiveProviderId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  return value;
}

function credentialsFrom(input: unknown): MagicPayCredentials | null {
  if (!isRecord(input) || !isRecord(input.credentials)) return null;
  const publicKey = trimmed(input.credentials.publicKey);
  const secretKey = trimmed(input.credentials.secretKey);
  if (publicKey === null || secretKey === null) return null;
  return { publicKey, secretKey };
}

function basicAuthorization(credentials: MagicPayCredentials): string {
  return `Basic ${Buffer.from(`${credentials.publicKey}:${credentials.secretKey}`, 'utf8').toString('base64')}`;
}

function normalizeCustomer(value: unknown):
  | {
      name: string;
      email: string;
      phone: string;
      document: { number: string; type: 'cpf' | 'cnpj' };
    }
  | null {
  if (!isRecord(value)) return null;
  const name = trimmed(value.name);
  const email = trimmed(value.email);
  const phone = digits(value.phone);
  const document = digits(value.document);
  if (name === null || email === null || phone === null || document === null) return null;
  if (phone.length < 10 || phone.length > 15) return null;
  if (document.length !== 11 && document.length !== 14) return null;
  return {
    name,
    email,
    phone,
    document: {
      number: document,
      type: document.length === 11 ? 'cpf' : 'cnpj',
    },
  };
}

function parseJsonObject(bodyUtf8: unknown): AnyRecord | null {
  if (typeof bodyUtf8 !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(bodyUtf8);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function is2xx(statusCode: unknown): statusCode is number {
  return typeof statusCode === 'number' && statusCode >= 200 && statusCode <= 299;
}

export function normalizeMagicPayPaymentStatus(value: unknown): MagicPayPaymentStatus | null {
  const status = trimmed(value)?.toLowerCase();
  switch (status) {
    case 'waiting_payment':
    case 'pending':
      return 'pending';
    case 'paid':
      return 'paid';
    case 'refused':
      return 'failed';
    case 'refunded':
      return 'refunded';
    case 'chargedback':
      return 'disputed';
    default:
      return null;
  }
}

export function buildMagicPayPixCreateRequest(input: unknown):
  | { readonly ok: true; readonly request: ProviderRequest }
  | { readonly ok: false; readonly reason: 'invalid_input' } {
  if (!isRecord(input) || !validAmount(input.amountCents)) {
    return { ok: false, reason: 'invalid_input' };
  }
  const credentials = credentialsFrom(input);
  const clientReference = trimmed(input.clientReference);
  const description = trimmed(input.description);
  const customer = normalizeCustomer(input.customer);
  if (credentials === null || clientReference === null || description === null || customer === null) {
    return { ok: false, reason: 'invalid_input' };
  }

  let postbackUrl: string | null = null;
  if (input.postbackUrl !== undefined) {
    postbackUrl = trimmed(input.postbackUrl);
    if (postbackUrl === null) return { ok: false, reason: 'invalid_input' };
  }

  let expiresInDays: number | null = null;
  if (input.expiresInDays !== undefined) {
    if (!validPositiveInt32(input.expiresInDays)) return { ok: false, reason: 'invalid_input' };
    expiresInDays = input.expiresInDays;
  }

  const body: AnyRecord = {
    amount: input.amountCents,
    paymentMethod: 'pix',
    items: [{
      title: description,
      unitPrice: input.amountCents,
      quantity: 1,
      tangible: false,
      externalRef: clientReference,
    }],
    customer,
    externalRef: clientReference,
  };
  if (postbackUrl !== null) body.postbackUrl = postbackUrl;
  if (expiresInDays !== null) body.pix = { expiresInDays };

  return {
    ok: true,
    request: {
      method: 'POST',
      relativePath: 'transactions',
      headers: {
        Authorization: basicAuthorization(credentials),
        'Content-Type': 'application/json',
      },
      bodyUtf8: JSON.stringify(body),
    },
  };
}

function parseTransactionCore(bodyUtf8: unknown):
  | {
      readonly ok: true;
      readonly body: AnyRecord;
      readonly providerPaymentId: string;
      readonly providerStatusRaw: string;
      readonly paymentStatus: MagicPayPaymentStatus;
    }
  | { readonly ok: false; readonly reason: 'response_invalid' }
  | {
      readonly ok: false;
      readonly reason: 'unrecognized_provider_status';
      readonly providerStatusRaw: string;
    } {
  const body = parseJsonObject(bodyUtf8);
  if (body === null
      || typeof body.id !== 'number'
      || !Number.isSafeInteger(body.id)
      || body.id <= 0
      || typeof body.status !== 'string'
      || body.status.trim().length === 0) {
    return { ok: false, reason: 'response_invalid' };
  }

  const providerStatusRaw = body.status;
  const paymentStatus = normalizeMagicPayPaymentStatus(providerStatusRaw);
  if (paymentStatus === null) {
    return { ok: false, reason: 'unrecognized_provider_status', providerStatusRaw };
  }

  return {
    ok: true,
    body,
    providerPaymentId: String(body.id),
    providerStatusRaw,
    paymentStatus,
  };
}

export function parseMagicPayCreateResponse(bodyUtf8: unknown) {
  const core = parseTransactionCore(bodyUtf8);
  if (!core.ok) return core;

  return {
    ok: true as const,
    transaction: {
      providerPaymentId: core.providerPaymentId,
      amountCents: validNonNegativeInteger(core.body.amount) ? core.body.amount : null,
      paymentMethodRaw: trimmed(core.body.paymentMethod),
      providerStatusRaw: core.providerStatusRaw,
      paymentStatus: core.paymentStatus,
      externalRef: trimmed(core.body.externalRef),
    },
  };
}

export function parseMagicPayCreateErrorResponse(bodyUtf8: unknown) {
  const body = parseJsonObject(bodyUtf8);
  if (body === null
      || typeof body.code !== 'number'
      || !Number.isSafeInteger(body.code)
      || trimmed(body.message) === null) {
    return { ok: false as const, reason: 'response_invalid' as const };
  }

  return {
    ok: true as const,
    error: {
      code: body.code,
      message: trimmed(body.message) as string,
    },
  };
}

export function buildMagicPayTransactionQueryRequest(input: unknown):
  | { readonly ok: true; readonly request: ProviderRequest }
  | { readonly ok: false; readonly reason: 'invalid_input' } {
  if (!isRecord(input)) return { ok: false, reason: 'invalid_input' };
  const credentials = credentialsFrom(input);
  const providerPaymentId = positiveProviderId(input.providerPaymentId);
  if (credentials === null || providerPaymentId === null) return { ok: false, reason: 'invalid_input' };

  return {
    ok: true,
    request: {
      method: 'GET',
      relativePath: `transactions/${encodeURIComponent(providerPaymentId)}`,
      headers: { Authorization: basicAuthorization(credentials) },
    },
  };
}

export function parseMagicPayTransactionQueryResponse(bodyUtf8: unknown) {
  const core = parseTransactionCore(bodyUtf8);
  if (!core.ok) return core;

  return {
    ok: true as const,
    transaction: {
      providerPaymentId: core.providerPaymentId,
      amountCents: validNonNegativeInteger(core.body.amount) ? core.body.amount : null,
      paymentMethodRaw: trimmed(core.body.paymentMethod),
      providerStatusRaw: core.providerStatusRaw,
      paymentStatus: core.paymentStatus,
      providerPixValue: trimmed(core.body.pix),
      paidAt: trimmed(core.body.paidAt),
      externalRef: trimmed(core.body.externalRef),
    },
  };
}

export function createMagicPayReadOnlyClient(options: { readonly transport: ProviderTransport }) {
  async function read(relativePath: 'company' | 'balance/available', input: unknown) {
    const credentials = credentialsFrom(input);
    if (credentials === null) return { kind: 'configuration_error' as const };

    let response: ProviderResponse;
    try {
      response = await options.transport.send({
        method: 'GET',
        relativePath,
        headers: { Authorization: basicAuthorization(credentials) },
      });
    } catch {
      return { kind: 'read_unavailable' as const };
    }

    if (!is2xx(response.statusCode)) return { kind: 'read_unavailable' as const };
    const data = parseJsonObject(response.bodyUtf8);
    if (data === null) return { kind: 'read_unavailable' as const };
    return { kind: 'ok' as const, data };
  }

  return Object.freeze({
    getCompany(input: unknown) {
      return read('company', input);
    },
    getBalance(input: unknown) {
      return read('balance/available', input);
    },
  });
}
