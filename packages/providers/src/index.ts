import { Buffer } from 'node:buffer';

export interface ProviderRequest {
  method: 'GET' | 'POST';
  relativePath: string;
  headers: Record<string, string>;
  bodyUtf8?: string;
}

export interface ProviderResponse {
  statusCode: number;
  headers: Record<string, string>;
  bodyUtf8: string;
}

export interface ProviderTransport {
  send(request: ProviderRequest): Promise<ProviderResponse>;
}

export interface ProviderAdapterOptions {
  transport: ProviderTransport;
}

export class ProviderTransportError extends Error {
  readonly kind: string;
  readonly code: string | undefined;

  constructor(kind: string, code?: string) {
    super('Provider transport failed.');
    this.name = 'ProviderTransportError';
    this.kind = kind;
    this.code = code;
  }
}

export const PROVIDER_CAPABILITIES = Object.freeze({
  akkadpag: {
    provider: 'akkadpag',
    activation: 'fixture_only',
    pixIn: true,
    pixQuery: true,
    pixOut: true,
    refund: false,
    webhookAuthority: false,
  },
  flevopay: {
    provider: 'flevopay',
    activation: 'fixture_only',
    pixIn: true,
    pixQuery: true,
    pixOut: false,
    refund: false,
    webhookAuthority: false,
  },
});

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value;
}

function trimmed(value: unknown): string | null {
  const text = nonBlank(value);
  return text === null ? null : text.trim();
}

function digits(value: unknown): string | null {
  const text = nonBlank(value);
  if (text === null) return null;
  const normalized = text.replace(/\D/g, '');
  return normalized.length > 0 ? normalized : null;
}

function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function normalizeCustomer(value: unknown):
  | { name: string; email: string; phone: string; document: string; documentType: 'CPF' | 'CNPJ' }
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
    document,
    documentType: document.length === 11 ? 'CPF' : 'CNPJ',
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

function scalarId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function is2xx(statusCode: unknown): statusCode is number {
  return typeof statusCode === 'number' && statusCode >= 200 && statusCode <= 299;
}

function basicAuthorization(publicKey: string, secretKey: string): string {
  return `Basic ${Buffer.from(`${publicKey}:${secretKey}`, 'utf8').toString('base64')}`;
}

function normalizeAkkadPaymentStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  switch (value.toUpperCase()) {
    case 'WAITING_PAYMENT':
    case 'PENDING':
      return 'pending';
    case 'APPROVED':
    case 'PAID':
      return 'paid';
    case 'REFUSED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    case 'REFUNDED':
      return 'refunded';
    case 'IN_PROTEST':
    case 'CHARGEBACK':
      return 'disputed';
    default:
      return null;
  }
}

function normalizeFlevoPaymentStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  switch (value.toLowerCase()) {
    case 'pending':
      return 'pending';
    case 'processing':
    case 'under_review':
      return 'processing';
    case 'approved':
      return 'paid';
    case 'failed':
      return 'failed';
    case 'refunded':
      return 'refunded';
    case 'chargeback':
      return 'disputed';
    default:
      return null;
  }
}

function queryKind(status: string): string {
  switch (status) {
    case 'pending': return 'found_pending';
    case 'processing': return 'found_processing';
    case 'paid': return 'found_paid';
    case 'failed': return 'found_failed';
    case 'cancelled': return 'found_cancelled';
    case 'refunded': return 'found_refunded';
    case 'disputed': return 'found_disputed';
    default: return 'unrecognized_provider_status';
  }
}

function normalizeAkkadPayoutStatus(value: unknown): string {
  if (typeof value !== 'string') return 'unrecognized_provider_status';
  switch (value.toUpperCase()) {
    case 'PENDING_ANALYSIS':
    case 'PROCESSING':
      return 'processing';
    case 'COMPLETED':
      return 'completed';
    case 'REFUSED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'unrecognized_provider_status';
  }
}

function normalizePixKeyType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  switch (value.toLowerCase()) {
    case 'cpf': return 'CPF';
    case 'cnpj': return 'CNPJ';
    case 'email': return 'EMAIL';
    case 'phone': return 'PHONE';
    case 'evp': return 'EVP';
    default: return null;
  }
}

function unsupported() {
  return { kind: 'unsupported' as const };
}

function verificationUnavailable() {
  return { kind: 'verification_unavailable' as const, trusted: false as const };
}

function configurationError() {
  return { kind: 'configuration_error' as const };
}

function preExecutionFailure() {
  return { kind: 'pre_execution_failure' as const };
}

function executionUnknown() {
  return { kind: 'execution_unknown' as const };
}

function akkadCredentials(input: unknown, requireWithdrawal = false):
  | { publicKey: string; secretKey: string; withdrawalKey?: string }
  | null {
  if (!isRecord(input) || !isRecord(input.credentials)) return null;
  const publicKey = nonBlank(input.credentials.publicKey);
  const secretKey = nonBlank(input.credentials.secretKey);
  if (publicKey === null || secretKey === null) return null;
  if (!requireWithdrawal) return { publicKey, secretKey };
  const withdrawalKey = nonBlank(input.credentials.withdrawalKey);
  return withdrawalKey === null ? null : { publicKey, secretKey, withdrawalKey };
}

function flevoCredentials(input: unknown): { secretKey: string } | null {
  if (!isRecord(input) || !isRecord(input.credentials)) return null;
  const secretKey = nonBlank(input.credentials.secretKey);
  return secretKey === null ? null : { secretKey };
}

export function createAkkadPagAdapter(options: ProviderAdapterOptions) {
  return {
    async createPixCharge(input: unknown) {
      const credentials = akkadCredentials(input);
      if (credentials === null) return configurationError();
      if (!isRecord(input) || !validAmount(input.amountCents)) return preExecutionFailure();
      const clientReference = trimmed(input.clientReference);
      const description = trimmed(input.description);
      const postbackUrl = trimmed(input.postbackUrl);
      const customer = normalizeCustomer(input.customer);
      if (clientReference === null || description === null || postbackUrl === null || customer === null) {
        return preExecutionFailure();
      }

      const request: ProviderRequest = {
        method: 'POST',
        relativePath: 'transactions',
        headers: { Authorization: basicAuthorization(credentials.publicKey, credentials.secretKey) },
        bodyUtf8: JSON.stringify({
          amount: input.amountCents,
          payment_method: 'PIX',
          items: [{
            title: description,
            unit_price: input.amountCents,
            quantity: 1,
            tangible: false,
            external_ref: clientReference,
          }],
          customer: {
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            document: { number: customer.document, type: customer.documentType },
          },
          postback_url: postbackUrl,
        }),
      };

      let response: ProviderResponse;
      try {
        response = await options.transport.send(request);
      } catch {
        return executionUnknown();
      }
      if (!is2xx(response.statusCode)) return executionUnknown();
      const body = parseJsonObject(response.bodyUtf8);
      if (body === null) return executionUnknown();
      const providerPaymentId = scalarId(body.id);
      const pix = isRecord(body.pix) ? body.pix : null;
      const copyAndPaste = pix === null ? null : nonBlank(pix.copy_paste);
      const paymentStatus = normalizeAkkadPaymentStatus(body.status);
      if (providerPaymentId === null || copyAndPaste === null || paymentStatus === null) return executionUnknown();
      const providerEndToEndId = pix === null ? null : scalarId(pix.end_to_end);
      const expiresAt = pix === null ? null : nonBlank(pix.expires_at);
      return {
        kind: 'succeeded' as const,
        providerPaymentId,
        providerTransactionId: providerPaymentId,
        providerEndToEndId,
        paymentStatus,
        pix: { copyAndPaste, expiresAt },
      };
    },

    async queryPixCharge(input: unknown) {
      const credentials = akkadCredentials(input);
      if (credentials === null) return configurationError();
      if (!isRecord(input)) return preExecutionFailure();
      const providerPaymentId = trimmed(input.providerPaymentId);
      if (providerPaymentId === null) return preExecutionFailure();
      let response: ProviderResponse;
      try {
        response = await options.transport.send({
          method: 'GET',
          relativePath: `transactions/${encodeURIComponent(providerPaymentId)}`,
          headers: { Authorization: basicAuthorization(credentials.publicKey, credentials.secretKey) },
        });
      } catch {
        return { kind: 'query_unavailable' as const };
      }
      if (!is2xx(response.statusCode)) return { kind: 'query_unavailable' as const };
      const outer = parseJsonObject(response.bodyUtf8);
      const data = outer !== null && isRecord(outer.data) ? outer.data : null;
      if (data === null) return { kind: 'query_unavailable' as const };
      const status = normalizeAkkadPaymentStatus(data.status);
      if (status === null) return { kind: 'unrecognized_provider_status' as const, providerStatusRaw: data.status };
      const pix = isRecord(data.pix) ? data.pix : null;
      return {
        kind: queryKind(status),
        providerPaymentId: scalarId(data.id),
        providerEndToEndId: pix === null ? null : scalarId(pix.end_to_end),
        providerStatusRaw: data.status,
      };
    },

    async createPixPayout(input: unknown) {
      const credentials = akkadCredentials(input, true);
      if (credentials === null || credentials.withdrawalKey === undefined) return configurationError();
      if (!isRecord(input) || !validAmount(input.amountCents)) return preExecutionFailure();
      const clientReference = trimmed(input.clientReference);
      const pixKey = trimmed(input.pixKey);
      const pixKeyType = normalizePixKeyType(input.pixKeyType);
      const postbackUrl = trimmed(input.postbackUrl);
      if (clientReference === null || pixKey === null || pixKeyType === null || postbackUrl === null) return preExecutionFailure();

      let response: ProviderResponse;
      try {
        response = await options.transport.send({
          method: 'POST',
          relativePath: 'transfers',
          headers: {
            Authorization: basicAuthorization(credentials.publicKey, credentials.secretKey),
            'x-withdrawal-key': credentials.withdrawalKey,
          },
          bodyUtf8: JSON.stringify({
            amount: input.amountCents,
            pix_key: pixKey,
            pix_key_type: pixKeyType,
            postback_url: postbackUrl,
          }),
        });
      } catch {
        return executionUnknown();
      }
      if (!is2xx(response.statusCode)) return executionUnknown();
      const body = parseJsonObject(response.bodyUtf8);
      if (body === null) return executionUnknown();
      const providerPayoutId = scalarId(body.id);
      if (providerPayoutId === null) return executionUnknown();
      return {
        kind: 'succeeded' as const,
        providerPayoutId,
        providerTransactionId: providerPayoutId,
        payoutStatus: normalizeAkkadPayoutStatus(body.status),
      };
    },

    async createRefund(_input: unknown) {
      return unsupported();
    },

    async verifyWebhook(_input: unknown) {
      return verificationUnavailable();
    },
  };
}

export function createFlevoPayAdapter(options: ProviderAdapterOptions) {
  return {
    async createPixCharge(input: unknown) {
      const credentials = flevoCredentials(input);
      if (credentials === null) return configurationError();
      if (!isRecord(input) || !validAmount(input.amountCents)) return preExecutionFailure();
      const clientReference = trimmed(input.clientReference);
      const description = trimmed(input.description);
      const postbackUrl = trimmed(input.postbackUrl);
      const customer = normalizeCustomer(input.customer);
      if (clientReference === null || description === null || postbackUrl === null || customer === null) {
        return preExecutionFailure();
      }

      let response: ProviderResponse;
      try {
        response = await options.transport.send({
          method: 'POST',
          relativePath: 'transaction',
          headers: { 'X-API-Key': credentials.secretKey },
          bodyUtf8: JSON.stringify({
            amount: input.amountCents,
            description,
            reference: clientReference,
            postback_url: postbackUrl,
            source: 'api_externa',
            customer: {
              name: customer.name,
              email: customer.email,
              document: customer.document,
              phone: customer.phone,
            },
          }),
        });
      } catch {
        return executionUnknown();
      }
      if (!is2xx(response.statusCode)) return executionUnknown();
      const body = parseJsonObject(response.bodyUtf8);
      if (body === null) return executionUnknown();
      const providerPaymentId = scalarId(body.transaction_id) ?? scalarId(body.id);
      const copyAndPaste = nonBlank(body.qr_code);
      const paymentStatus = normalizeFlevoPaymentStatus(body.status);
      if (providerPaymentId === null || copyAndPaste === null || paymentStatus === null) return executionUnknown();
      return {
        kind: 'succeeded' as const,
        providerPaymentId,
        providerTransactionId: providerPaymentId,
        providerSpecificLookupReference: providerPaymentId,
        paymentStatus,
        pix: { copyAndPaste, expiresAt: nonBlank(body.expires_at) },
      };
    },

    async queryPixCharge(input: unknown) {
      const credentials = flevoCredentials(input);
      if (credentials === null) return configurationError();
      if (!isRecord(input)) return preExecutionFailure();
      const lookup = trimmed(input.providerSpecificLookupReference);
      if (lookup === null) return preExecutionFailure();
      let response: ProviderResponse;
      try {
        response = await options.transport.send({
          method: 'GET',
          relativePath: `query?action=get_transaction&id=${encodeURIComponent(lookup)}`,
          headers: { 'X-API-Key': credentials.secretKey },
        });
      } catch {
        return { kind: 'query_unavailable' as const };
      }
      if (!is2xx(response.statusCode)) return { kind: 'query_unavailable' as const };
      const body = parseJsonObject(response.bodyUtf8);
      if (body === null) return { kind: 'query_unavailable' as const };
      const status = normalizeFlevoPaymentStatus(body.status);
      if (status === null) return { kind: 'unrecognized_provider_status' as const, providerStatusRaw: body.status };
      return {
        kind: queryKind(status),
        providerPaymentId: scalarId(body.id),
        providerSpecificLookupReference: lookup,
        providerStatusRaw: body.status,
      };
    },

    async createPixPayout(_input: unknown) {
      return unsupported();
    },

    async createRefund(_input: unknown) {
      return unsupported();
    },

    async verifyWebhook(_input: unknown) {
      return verificationUnavailable();
    },
  };
}

export * from './activation.js';
export * from './http-transport.js';
