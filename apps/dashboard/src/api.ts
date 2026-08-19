const API_BASE = '/api';

export type DashboardEnvironment = 'sandbox' | 'production';
export type MerchantLifecycleStatus = 'draft' | 'active' | 'suspended' | 'closed';
export type MembershipRole = 'member' | 'admin' | 'owner';
export type TransactionStatus = 'creating' | 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';

export interface MerchantContext {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly lifecycleStatus: MerchantLifecycleStatus;
  readonly membershipRole: MembershipRole;
  readonly environments: readonly ['sandbox', 'production'];
}

export interface TransactionListItem {
  readonly id: string;
  readonly externalId: string | null;
  readonly method: 'pix';
  readonly source: 'api' | 'checkout' | 'payment_link' | 'quick_pix';
  readonly amount: number;
  readonly fee: number;
  readonly netAmount: number;
  readonly refundedAmount: number;
  readonly currency: 'BRL';
  readonly status: TransactionStatus;
  readonly description: string | null;
  readonly environment: DashboardEnvironment;
  readonly expiresAt: string | null;
  readonly paidAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TransactionDetail extends TransactionListItem {
  readonly pix: {
    readonly txId: string;
    readonly qrCode: string;
    readonly copyAndPaste: string;
    readonly expiresAt: string;
  } | null;
}

export class DashboardApiError extends Error {
  constructor(readonly category: 'session' | 'forbidden' | 'not_found' | 'unavailable' | 'error') {
    super('Dashboard request failed.');
    this.name = 'DashboardApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestJson(accessToken: string, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new DashboardApiError('unavailable');
  }

  if (response.status === 401) throw new DashboardApiError('session');
  if (response.status === 403) throw new DashboardApiError('forbidden');
  if (response.status === 404) throw new DashboardApiError('not_found');
  if (response.status === 503) throw new DashboardApiError('unavailable');
  if (!response.ok) throw new DashboardApiError('error');

  try {
    return await response.json();
  } catch {
    throw new DashboardApiError('error');
  }
}

function context(value: unknown): MerchantContext {
  if (!isRecord(value)
      || typeof value.merchantId !== 'string'
      || typeof value.merchantName !== 'string'
      || !['draft', 'active', 'suspended', 'closed'].includes(String(value.lifecycleStatus))
      || !['member', 'admin', 'owner'].includes(String(value.membershipRole))
      || !Array.isArray(value.environments)
      || value.environments.length !== 2
      || value.environments[0] !== 'sandbox'
      || value.environments[1] !== 'production') {
    throw new DashboardApiError('error');
  }
  return value as unknown as MerchantContext;
}

function transaction(value: unknown): TransactionListItem {
  if (!isRecord(value)
      || typeof value.id !== 'string'
      || value.method !== 'pix'
      || typeof value.amount !== 'number'
      || value.currency !== 'BRL'
      || !['creating', 'pending', 'paid', 'expired', 'failed', 'cancelled'].includes(String(value.status))
      || (value.environment !== 'sandbox' && value.environment !== 'production')
      || typeof value.createdAt !== 'string') {
    throw new DashboardApiError('error');
  }
  return value as unknown as TransactionListItem;
}

export async function listContexts(accessToken: string): Promise<readonly MerchantContext[]> {
  const body = await requestJson(accessToken, '/dashboard/v1/contexts');
  if (!isRecord(body) || body.object !== 'list' || !Array.isArray(body.data)) {
    throw new DashboardApiError('error');
  }
  return body.data.map(context);
}

export async function listTransactions(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly cursor?: string;
}): Promise<{ readonly items: readonly TransactionListItem[]; readonly nextCursor: string | null }> {
  const query = new URLSearchParams({ limit: '25' });
  if (input.cursor) query.set('cursor', input.cursor);
  const body = await requestJson(
    input.accessToken,
    `/dashboard/v1/merchants/${encodeURIComponent(input.merchantId)}/environments/${input.environment}/transactions?${query.toString()}`,
  );
  if (!isRecord(body) || !Array.isArray(body.items)
      || !(body.nextCursor === null || typeof body.nextCursor === 'string')) {
    throw new DashboardApiError('error');
  }
  return { items: body.items.map(transaction), nextCursor: body.nextCursor };
}

export async function getTransaction(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly transactionId: string;
}): Promise<TransactionDetail> {
  const body = await requestJson(
    input.accessToken,
    `/dashboard/v1/merchants/${encodeURIComponent(input.merchantId)}/environments/${input.environment}/transactions/${encodeURIComponent(input.transactionId)}`,
  );
  const base = transaction(body);
  if (!isRecord(body) || !('pix' in body)) throw new DashboardApiError('error');
  return { ...base, pix: body.pix as TransactionDetail['pix'] };
}
