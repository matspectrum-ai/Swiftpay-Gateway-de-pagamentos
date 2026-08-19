export type DashboardEnvironment = 'sandbox' | 'production';
export type MerchantLifecycleStatus = 'draft' | 'active' | 'suspended' | 'closed';
export type MembershipRole = 'member' | 'admin' | 'owner';
export type TransactionStatus = 'creating' | 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled';
export type DashboardApiErrorCategory = 'session' | 'forbidden' | 'not_found' | 'unavailable' | 'validation' | 'step_up' | 'conflict' | 'error';

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

export interface ApiCredential {
  readonly id: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly name: string;
  readonly publicKey: string;
  readonly status: 'active' | 'revoked';
  readonly secretVersion: number;
  readonly revision: number;
  readonly ipAllowlist: readonly string[] | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  readonly revokedAt: string | null;
}

export interface ApiCredentialMutationResult {
  readonly credential: ApiCredential;
  readonly replayed: boolean;
  readonly secretAvailable: boolean;
  readonly secretKey: string | null;
}

export interface WebhookEndpoint {
  readonly id: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly url: string;
  readonly status: 'active' | 'disabled';
  readonly subscribedEvents: readonly string[];
  readonly secretVersion: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WebhookMutationResult {
  readonly endpoint: WebhookEndpoint;
  readonly replayed: boolean;
  readonly secretAvailable: boolean;
  readonly signingSecret: string | null;
}

export class DashboardApiError extends Error {
  constructor(readonly category: DashboardApiErrorCategory) {
    super('Dashboard request failed.');
    this.name = 'DashboardApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicErrorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.code !== 'string') return null;
  return value.error.code;
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseError(status: number, code: string | null): DashboardApiError {
  if (status === 401) return new DashboardApiError('session');
  if (status === 403 && code === 'step_up_required') return new DashboardApiError('step_up');
  if (status === 403) return new DashboardApiError('forbidden');
  if (status === 404) return new DashboardApiError('not_found');
  if (status === 400 || code === 'validation_error') return new DashboardApiError('validation');
  if (status === 409) return new DashboardApiError('conflict');
  if (status === 503) return new DashboardApiError('unavailable');
  return new DashboardApiError('error');
}

async function requestJson(accessToken: string, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new DashboardApiError('unavailable');
  }

  const body = await responseBody(response);
  if (!response.ok) throw responseError(response.status, publicErrorCode(body));
  if (body === null) throw new DashboardApiError('error');
  return body;
}

async function mutateJson(input: {
  readonly accessToken: string;
  readonly path: string;
  readonly method: 'POST' | 'PATCH';
  readonly idempotencyKey: string;
  readonly body: unknown;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(input.path, {
      method: input.method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify(input.body),
    });
  } catch {
    throw new DashboardApiError('unavailable');
  }

  const body = await responseBody(response);
  if (!response.ok) throw responseError(response.status, publicErrorCode(body));
  if (body === null) throw new DashboardApiError('error');
  return body;
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

function credential(value: unknown): ApiCredential {
  if (!isRecord(value)
      || typeof value.id !== 'string'
      || typeof value.merchantId !== 'string'
      || (value.environment !== 'sandbox' && value.environment !== 'production')
      || typeof value.name !== 'string'
      || typeof value.publicKey !== 'string'
      || (value.status !== 'active' && value.status !== 'revoked')
      || !Number.isInteger(value.secretVersion) || Number(value.secretVersion) < 1
      || !Number.isInteger(value.revision) || Number(value.revision) < 1
      || !(value.ipAllowlist === null || (Array.isArray(value.ipAllowlist) && value.ipAllowlist.every((item) => typeof item === 'string')))
      || !(value.lastUsedAt === null || typeof value.lastUsedAt === 'string')
      || typeof value.createdAt !== 'string') {
    throw new DashboardApiError('error');
  }
  return value as unknown as ApiCredential;
}

function webhookEndpoint(value: unknown): WebhookEndpoint {
  if (!isRecord(value)
      || typeof value.id !== 'string'
      || typeof value.merchantId !== 'string'
      || (value.environment !== 'sandbox' && value.environment !== 'production')
      || typeof value.url !== 'string'
      || (value.status !== 'active' && value.status !== 'disabled')
      || !Array.isArray(value.subscribedEvents)
      || !value.subscribedEvents.every((item) => typeof item === 'string')
      || !Number.isInteger(value.secretVersion) || Number(value.secretVersion) < 1
      || !Number.isInteger(value.revision) || Number(value.revision) < 1
      || typeof value.createdAt !== 'string'
      || typeof value.updatedAt !== 'string') {
    throw new DashboardApiError('error');
  }
  return value as unknown as WebhookEndpoint;
}

function credentialMutation(value: unknown): ApiCredentialMutationResult {
  if (!isRecord(value) || !('credential' in value)) throw new DashboardApiError('error');
  return {
    credential: credential(value.credential),
    replayed: value.replayed === true,
    secretAvailable: value.secretAvailable === true,
    secretKey: typeof value.secretKey === 'string' ? value.secretKey : null,
  };
}

function webhookSecretMutation(value: unknown): WebhookMutationResult {
  if (!isRecord(value)) throw new DashboardApiError('error');
  return {
    endpoint: webhookEndpoint(value),
    replayed: value.replayed === true,
    secretAvailable: value.secretAvailable === true,
    signingSecret: typeof value.signingSecret === 'string' ? value.signingSecret : null,
  };
}

function dashboardBase(merchantId: string, environment: DashboardEnvironment): string {
  return `/api/dashboard/v1/merchants/${encodeURIComponent(merchantId)}/environments/${environment}`;
}

export async function listContexts(accessToken: string): Promise<readonly MerchantContext[]> {
  const body = await requestJson(accessToken, '/api/dashboard/v1/contexts');
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
    `${dashboardBase(input.merchantId, input.environment)}/transactions?${query.toString()}`,
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
    `${dashboardBase(input.merchantId, input.environment)}/transactions/${encodeURIComponent(input.transactionId)}`,
  );
  const base = transaction(body);
  if (!isRecord(body) || !('pix' in body)) throw new DashboardApiError('error');
  return { ...base, pix: body.pix as TransactionDetail['pix'] };
}

export async function listApiCredentials(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
}): Promise<readonly ApiCredential[]> {
  const body = await requestJson(input.accessToken, `${dashboardBase(input.merchantId, input.environment)}/api-credentials`);
  if (!isRecord(body) || body.object !== 'list' || !Array.isArray(body.data)) throw new DashboardApiError('error');
  return body.data.map(credential);
}

export async function createApiCredential(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly idempotencyKey: string;
  readonly name: string;
}): Promise<ApiCredentialMutationResult> {
  return credentialMutation(await mutateJson({
    accessToken: input.accessToken,
    path: `${dashboardBase(input.merchantId, input.environment)}/api-credentials`,
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: { name: input.name },
  }));
}

export async function rotateApiCredentialSecret(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly credentialId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}): Promise<ApiCredentialMutationResult> {
  return credentialMutation(await mutateJson({
    accessToken: input.accessToken,
    path: `${dashboardBase(input.merchantId, input.environment)}/api-credentials/${encodeURIComponent(input.credentialId)}/rotate-secret`,
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: { expectedRevision: input.expectedRevision },
  }));
}

export async function revokeApiCredential(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly credentialId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}): Promise<ApiCredentialMutationResult> {
  return credentialMutation(await mutateJson({
    accessToken: input.accessToken,
    path: `${dashboardBase(input.merchantId, input.environment)}/api-credentials/${encodeURIComponent(input.credentialId)}/revoke`,
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: { expectedRevision: input.expectedRevision },
  }));
}

export async function listWebhookEndpoints(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
}): Promise<readonly WebhookEndpoint[]> {
  const body = await requestJson(input.accessToken, `${dashboardBase(input.merchantId, input.environment)}/webhook-endpoints`);
  if (!isRecord(body) || body.object !== 'list' || !Array.isArray(body.data)) throw new DashboardApiError('error');
  return body.data.map(webhookEndpoint);
}

export async function createWebhookEndpoint(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly idempotencyKey: string;
  readonly url: string;
}): Promise<WebhookMutationResult> {
  return webhookSecretMutation(await mutateJson({
    accessToken: input.accessToken,
    path: `${dashboardBase(input.merchantId, input.environment)}/webhook-endpoints`,
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: { url: input.url, subscribedEvents: ['payment.paid'] },
  }));
}

export async function updateWebhookEndpoint(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly endpointId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly url?: string;
}): Promise<WebhookEndpoint> {
  const body = await mutateJson({
    accessToken: input.accessToken,
    path: `${dashboardBase(input.merchantId, input.environment)}/webhook-endpoints/${encodeURIComponent(input.endpointId)}`,
    method: 'PATCH',
    idempotencyKey: input.idempotencyKey,
    body: {
      expectedRevision: input.expectedRevision,
      ...(input.url === undefined ? {} : { url: input.url }),
      subscribedEvents: ['payment.paid'],
    },
  });
  return webhookEndpoint(body);
}

async function mutateWebhookState(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly endpointId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly operation: 'disable' | 'enable';
}): Promise<WebhookEndpoint> {
  const body = await mutateJson({
    accessToken: input.accessToken,
    path: `${dashboardBase(input.merchantId, input.environment)}/webhook-endpoints/${encodeURIComponent(input.endpointId)}/${input.operation}`,
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: { expectedRevision: input.expectedRevision },
  });
  return webhookEndpoint(body);
}

export async function disableWebhookEndpoint(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly endpointId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}): Promise<WebhookEndpoint> {
  return mutateWebhookState({ ...input, operation: 'disable' });
}

export async function enableWebhookEndpoint(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly endpointId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}): Promise<WebhookEndpoint> {
  return mutateWebhookState({ ...input, operation: 'enable' });
}

export async function rotateWebhookEndpointSecret(input: {
  readonly accessToken: string;
  readonly merchantId: string;
  readonly environment: DashboardEnvironment;
  readonly endpointId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
}): Promise<WebhookMutationResult> {
  return webhookSecretMutation(await mutateJson({
    accessToken: input.accessToken,
    path: `${dashboardBase(input.merchantId, input.environment)}/webhook-endpoints/${encodeURIComponent(input.endpointId)}/rotate-secret`,
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: { expectedRevision: input.expectedRevision },
  }));
}
