export interface PublicPaymentLink {
  readonly merchantName: string;
  readonly amount: number;
  readonly currency: 'BRL';
  readonly description: string | null;
  readonly environment: 'sandbox';
  readonly pixExpirationMinutes: number;
}

export interface CheckoutPayment {
  readonly id: string;
  readonly externalId: string | null;
  readonly method: 'pix';
  readonly amount: number;
  readonly fee: number;
  readonly netAmount: number;
  readonly currency: 'BRL';
  readonly status: 'creating' | 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
  readonly description: string | null;
  readonly environment: 'sandbox';
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly pix: null | {
    readonly txId: string;
    readonly qrCode: string;
    readonly copyAndPaste: string;
    readonly expiresAt: string;
  };
}

export class CheckoutApiError extends Error {
  constructor(readonly kind: 'not_found' | 'validation' | 'conflict' | 'rate_limited' | 'unavailable' | 'error') {
    super('Checkout request failed.');
    this.name = 'CheckoutApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function body(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function errorKind(status: number): CheckoutApiError['kind'] {
  if (status === 404) return 'not_found';
  if (status === 400) return 'validation';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  return 'error';
}

function link(value: unknown): PublicPaymentLink {
  if (!isRecord(value)
      || typeof value.merchantName !== 'string'
      || typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount < 1
      || value.currency !== 'BRL'
      || !(value.description === null || typeof value.description === 'string')
      || value.environment !== 'sandbox'
      || typeof value.pixExpirationMinutes !== 'number') throw new CheckoutApiError('error');
  return value as unknown as PublicPaymentLink;
}

function payment(value: unknown): CheckoutPayment {
  if (!isRecord(value)
      || typeof value.id !== 'string'
      || value.method !== 'pix'
      || typeof value.amount !== 'number'
      || value.currency !== 'BRL'
      || !['creating','pending','paid','failed','expired','cancelled'].includes(String(value.status))
      || value.environment !== 'sandbox'
      || typeof value.expiresAt !== 'string'
      || typeof value.createdAt !== 'string') throw new CheckoutApiError('error');
  return value as unknown as CheckoutPayment;
}

function base(publicToken: string): string {
  return `/api/checkout/v1/payment-links/${encodeURIComponent(publicToken)}`;
}

export async function getPaymentLink(publicToken: string): Promise<PublicPaymentLink> {
  let response: Response;
  try {
    response = await fetch(base(publicToken), { cache: 'no-store', headers: { Accept: 'application/json' } });
  } catch { throw new CheckoutApiError('unavailable'); }
  const value = await body(response);
  if (!response.ok) throw new CheckoutApiError(errorKind(response.status));
  return link(value);
}

export async function createCheckoutPayment(input: { readonly publicToken: string; readonly idempotencyKey: string }): Promise<CheckoutPayment> {
  let response: Response;
  try {
    response = await fetch(`${base(input.publicToken)}/payments`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: '{}',
    });
  } catch { throw new CheckoutApiError('unavailable'); }
  const value = await body(response);
  if (!response.ok) throw new CheckoutApiError(errorKind(response.status));
  return payment(value);
}
