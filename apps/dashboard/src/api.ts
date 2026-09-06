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

export interface GatewayAccount {
  readonly id: string;
  readonly object: 'account';
  readonly type: string;
  readonly currency: 'BRL';
  readonly environment: DashboardEnvironment;
  readonly balance_cents: number;
}

export interface GatewayStatementItem {
  readonly id: string;
  readonly occurred_at: string;
  readonly operation_type: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly amount_cents: number;
  readonly currency: 'BRL';
  readonly balance_effect: 'credit' | 'debit';
}

export interface GatewayCustomer {
  readonly id: string;
  readonly object: 'customer';
  readonly organization_id: string | null;
  readonly external_ref: string | null;
  readonly name: string | null;
  readonly document: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface GatewayPayout {
  readonly id: string;
  readonly object: 'payout';
  readonly environment: DashboardEnvironment;
  readonly currency: 'BRL';
  readonly amount_cents: number;
  readonly recipient_amount_cents: number;
  readonly merchant_fee_cents: number;
  readonly state: 'requested' | 'processing' | 'execution_unknown' | 'completed' | 'failed' | 'rejected' | 'cancelled';
  readonly external_ref: string | null;
  readonly created_at: string;
  readonly updated_at: string;
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

function account(value: unknown): GatewayAccount {
  if (!isRecord(value) || typeof value.id !== 'string' || value.object !== 'account'
      || typeof value.type !== 'string' || value.currency !== 'BRL'
      || (value.environment !== 'sandbox' && value.environment !== 'production')
      || typeof value.balance_cents !== 'number' || !Number.isSafeInteger(value.balance_cents)) {
    throw new DashboardApiError('error');
  }
  return value as unknown as GatewayAccount;
}

function statementItem(value: unknown): GatewayStatementItem {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.occurred_at !== 'string'
      || typeof value.operation_type !== 'string' || typeof value.source_type !== 'string'
      || typeof value.source_id !== 'string' || typeof value.amount_cents !== 'number'
      || !Number.isSafeInteger(value.amount_cents) || value.currency !== 'BRL'
      || (value.balance_effect !== 'credit' && value.balance_effect !== 'debit')) {
    throw new DashboardApiError('error');
  }
  return value as unknown as GatewayStatementItem;
}

function customer(value: unknown): GatewayCustomer {
  if (!isRecord(value) || typeof value.id !== 'string' || value.object !== 'customer'
      || !(value.organization_id === null || typeof value.organization_id === 'string')
      || !(value.external_ref === null || typeof value.external_ref === 'string')
      || !(value.name === null || typeof value.name === 'string')
      || !(value.document === null || typeof value.document === 'string')
      || !(value.email === null || typeof value.email === 'string')
      || !(value.phone === null || typeof value.phone === 'string')
      || !isRecord(value.metadata) || typeof value.created_at !== 'string' || typeof value.updated_at !== 'string') {
    throw new DashboardApiError('error');
  }
  return value as unknown as GatewayCustomer;
}

function payout(value: unknown): GatewayPayout {
  const states = new Set(['requested', 'processing', 'execution_unknown', 'completed', 'failed', 'rejected', 'cancelled']);
  if (!isRecord(value) || typeof value.id !== 'string' || value.object !== 'payout'
      || (value.environment !== 'sandbox' && value.environment !== 'production') || value.currency !== 'BRL'
      || typeof value.amount_cents !== 'number' || !Number.isSafeInteger(value.amount_cents)
      || typeof value.recipient_amount_cents !== 'number' || !Number.isSafeInteger(value.recipient_amount_cents)
      || typeof value.merchant_fee_cents !== 'number' || !Number.isSafeInteger(value.merchant_fee_cents)
      || typeof value.state !== 'string' || !states.has(value.state)
      || !(value.external_ref === null || typeof value.external_ref === 'string')
      || typeof value.created_at !== 'string' || typeof value.updated_at !== 'string') {
    throw new DashboardApiError('error');
  }
  return value as unknown as GatewayPayout;
}

function base(merchantId: string, environment: DashboardEnvironment): string {
  return `/api/dashboard/v1/merchants/${encodeURIComponent(merchantId)}/environments/${environment}/payment-links`;
}

function resourceBase(merchantId: string, environment: DashboardEnvironment): string {
  return `/api/dashboard/v1/merchants/${encodeURIComponent(merchantId)}/environments/${environment}`;
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
  readonly method?: 'POST' | 'PATCH';
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input.path, {
      method: input.method ?? 'POST',
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

export async function listGatewayAccounts(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
}): Promise<readonly GatewayAccount[]> {
  const body = await read(input.accessToken, `${resourceBase(input.merchantId, input.environment)}/accounts`);
  if (!isRecord(body) || body.object !== 'list' || !Array.isArray(body.data)) throw new DashboardApiError('error');
  return body.data.map(account);
}

export async function listGatewayAccountStatement(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly accountId: string;
}): Promise<readonly GatewayStatementItem[]> {
  const body = await read(input.accessToken, `${resourceBase(input.merchantId, input.environment)}/accounts/${encodeURIComponent(input.accountId)}/statement`);
  if (!isRecord(body) || body.object !== 'list' || !Array.isArray(body.data)) throw new DashboardApiError('error');
  return body.data.map(statementItem);
}

export async function listGatewayCustomers(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
}): Promise<readonly GatewayCustomer[]> {
  const body = await read(input.accessToken, `${resourceBase(input.merchantId, input.environment)}/customers`);
  if (!isRecord(body) || body.object !== 'list' || !Array.isArray(body.data)) throw new DashboardApiError('error');
  return body.data.map(customer);
}

export async function createGatewayCustomer(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly idempotencyKey: string;
  readonly name?: string;
  readonly document?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly externalRef?: string;
}): Promise<GatewayCustomer> {
  return customer(await mutate({
    accessToken: input.accessToken,
    path: `${resourceBase(input.merchantId, input.environment)}/customers`,
    idempotencyKey: input.idempotencyKey,
    body: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.document ? { document: input.document } : {}),
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.externalRef ? { external_ref: input.externalRef } : {}),
    },
  }));
}

export async function updateGatewayCustomer(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly customerId: string;
  readonly idempotencyKey: string;
  readonly patch: Record<string, unknown>;
}): Promise<GatewayCustomer> {
  return customer(await mutate({
    accessToken: input.accessToken,
    path: `${resourceBase(input.merchantId, input.environment)}/customers/${encodeURIComponent(input.customerId)}`,
    idempotencyKey: input.idempotencyKey,
    body: input.patch,
    method: 'PATCH',
  }));
}

export async function listGatewayPayouts(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
}): Promise<readonly GatewayPayout[]> {
  const body = await read(input.accessToken, `${resourceBase(input.merchantId, input.environment)}/payouts`);
  if (!isRecord(body) || body.object !== 'list' || !Array.isArray(body.data)) throw new DashboardApiError('error');
  return body.data.map(payout);
}

export async function createGatewayPayout(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly idempotencyKey: string;
  readonly amountCents: number;
  readonly keyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
  readonly pixKey: string;
  readonly externalRef?: string;
}): Promise<GatewayPayout> {
  return payout(await mutate({
    accessToken: input.accessToken,
    path: `${resourceBase(input.merchantId, input.environment)}/payouts`,
    idempotencyKey: input.idempotencyKey,
    body: {
      amount_cents: input.amountCents,
      destination: { type: 'pix', key_type: input.keyType, key: input.pixKey },
      ...(input.externalRef ? { external_ref: input.externalRef } : {}),
    },
  }));
}
