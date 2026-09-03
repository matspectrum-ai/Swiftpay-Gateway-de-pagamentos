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

type AnyRecord = Record<string, unknown>;

type MagicPayCredentials = {
  publicKey: string;
  secretKey: string;
};

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
