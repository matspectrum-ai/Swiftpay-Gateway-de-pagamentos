export * from './api-base.js';

import {
  DashboardApiError,
  type DashboardEnvironment,
} from './api-base.js';

export interface PaymentLink {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicCode(value: unknown): string | null {
  return isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string'
    ? value.error.code
    : null;
}

function mappedError(status: number, code: string | null): DashboardApiError {
  if (status === 401) return new DashboardApiError('session');
  if (status === 403) return new DashboardApiError('forbidden');
  if (status === 404) return new DashboardApiError('not_found');
  if (status === 400) return new DashboardApiError('validation');
  if (status === 409) return new DashboardApiError('conflict');
  if (status === 503) return new DashboardApiError('unavailable');
  if (code === 'validation_error') return new DashboardApiError('validation');
  return new DashboardApiError('error');
}

async function parse(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

function paymentLink(value: unknown): PaymentLink {
  if (!isRecord(value)
      || typeof value.id !== 'string'
      || typeof value.publicToken !== 'string'
      || typeof value.checkoutPath !== 'string'
      || (value.status !== 'active' && value.status !== 'disabled')
      || typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount < 1
      || value.currency !== 'BRL'
      || !(value.description === null || typeof value.description === 'string')
      || typeof value.pixExpirationMinutes !== 'number'
      || typeof value.createdAt !== 'string'
      || !(value.disabledAt === null || typeof value.disabledAt === 'string')) {
    throw new DashboardApiError('error');
  }
  return value as unknown as PaymentLink;
}

function base(merchantId: string, environment: DashboardEnvironment): string {
  return `/api/dashboard/v1/merchants/${encodeURIComponent(merchantId)}/environments/${environment}/payment-links`;
}

async function read(accessToken: string, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    });
  } catch { throw new DashboardApiError('unavailable'); }
  const body = await parse(response);
  if (!response.ok) throw mappedError(response.status, publicCode(body));
  if (body === null) throw new DashboardApiError('error');
  return body;
}

async function mutate(input: {
  readonly accessToken: string;
  readonly path: string;
  readonly idempotencyKey: string;
  readonly body: unknown;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input.path, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify(input.body),
    });
  } catch { throw new DashboardApiError('unavailable'); }
  const body = await parse(response);
  if (!response.ok) throw mappedError(response.status, publicCode(body));
  if (body === null) throw new DashboardApiError('error');
  return body;
}

export async function listPaymentLinks(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
}): Promise<readonly PaymentLink[]> {
  const body = await read(input.accessToken, base(input.merchantId, input.environment));
  if (!isRecord(body) || body.object !== 'list' || !Array.isArray(body.data)) throw new DashboardApiError('error');
  return body.data.map(paymentLink);
}

export async function createPaymentLink(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly idempotencyKey: string;
  readonly amount: number;
  readonly description?: string;
  readonly pixExpirationMinutes?: number;
}): Promise<PaymentLink> {
  return paymentLink(await mutate({
    accessToken: input.accessToken,
    path: base(input.merchantId, input.environment),
    idempotencyKey: input.idempotencyKey,
    body: {
      amount: input.amount,
      currency: 'BRL',
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.pixExpirationMinutes === undefined ? {} : { pixExpirationMinutes: input.pixExpirationMinutes }),
    },
  }));
}

export async function disablePaymentLink(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly paymentLinkId: string;
  readonly idempotencyKey: string;
}): Promise<PaymentLink> {
  return paymentLink(await mutate({
    accessToken: input.accessToken,
    path: `${base(input.merchantId, input.environment)}/${encodeURIComponent(input.paymentLinkId)}/disable`,
    idempotencyKey: input.idempotencyKey,
    body: {},
  }));
}
