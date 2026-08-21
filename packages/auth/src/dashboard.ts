export interface DashboardUserPrincipal {
  readonly userId: string;
}

export type DashboardSessionVerificationResult =
  | { readonly kind: 'authenticated'; readonly principal: DashboardUserPrincipal }
  | { readonly kind: 'invalid_session' }
  | { readonly kind: 'authentication_unavailable' };

export interface DashboardAuthTransportRequest {
  readonly method: 'GET';
  readonly url: string;
  readonly headers: Readonly<{
    accept: 'application/json';
    apikey: string;
    authorization: string;
  }>;
  readonly timeoutMs: 5000;
  readonly redirect: 'manual';
}

export interface DashboardAuthTransportResponse {
  readonly status: number;
  readonly body: unknown;
}

export type DashboardAuthTransport = (
  request: DashboardAuthTransportRequest,
) => Promise<DashboardAuthTransportResponse>;

export type DashboardSessionVerifier = (
  authorization: unknown,
) => Promise<DashboardSessionVerificationResult>;

export interface DashboardMerchantContextInput {
  readonly userId: string;
  readonly merchantId: string;
  readonly environment: 'sandbox' | 'production';
  readonly requiredRole: 'member' | 'admin' | 'owner';
}

export interface DashboardMerchantContext {
  readonly merchantId: string;
  readonly environment: 'sandbox' | 'production';
  readonly membershipRole: 'member' | 'admin' | 'owner';
}

export type DashboardMerchantContextResult =
  | { readonly kind: 'authorized'; readonly context: DashboardMerchantContext }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'validation_error' }
  | { readonly kind: 'internal_error' };

export interface DashboardMerchantContextStore {
  requireContext(input: DashboardMerchantContextInput): Promise<DashboardMerchantContextResult>;
}

export type DashboardAuthorizationResult =
  | DashboardMerchantContextResult
  | { readonly kind: 'invalid_session' }
  | { readonly kind: 'authentication_unavailable' };

export interface DashboardAuthorizationInput {
  readonly authorization: unknown;
  readonly merchantId: string;
  readonly environment: 'sandbox' | 'production';
  readonly requiredRole: 'member' | 'admin' | 'owner';
}

export type DashboardAuthorizationService = (
  input: DashboardAuthorizationInput,
) => Promise<DashboardAuthorizationResult>;

export interface DashboardSessionVerifierOptions {
  readonly projectUrl: string;
  readonly publishableKey: string;
  readonly transport?: DashboardAuthTransport;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEARER_SHAPE = /^Bearer ([^\s]+)$/i;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function nodeFetchTransport(
  request: DashboardAuthTransportRequest,
): Promise<DashboardAuthTransportResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      redirect: request.redirect,
      signal: controller.signal,
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

export function createSupabaseDashboardSessionVerifier(
  options: DashboardSessionVerifierOptions,
): DashboardSessionVerifier {
  const transport = options.transport ?? nodeFetchTransport;
  const projectOrigin = typeof options.projectUrl === 'string'
    ? options.projectUrl.replace(/\/+$/, '')
    : null;
  const publishableKey = typeof options.publishableKey === 'string'
    ? options.publishableKey
    : null;

  return async (authorization) => {
    if (typeof authorization !== 'string') {
      return { kind: 'invalid_session' };
    }

    const match = BEARER_SHAPE.exec(authorization);
    const accessToken = match?.[1];
    if (accessToken === undefined) {
      return { kind: 'invalid_session' };
    }

    if (projectOrigin === null || publishableKey === null) {
      return { kind: 'authentication_unavailable' };
    }

    let response: DashboardAuthTransportResponse;
    try {
      response = await transport({
        method: 'GET',
        url: `${projectOrigin}/auth/v1/user`,
        headers: {
          accept: 'application/json',
          apikey: publishableKey,
          authorization: `Bearer ${accessToken}`,
        },
        timeoutMs: 5000,
        redirect: 'manual',
      });
    } catch {
      return { kind: 'authentication_unavailable' };
    }

    if (response.status === 401 || response.status === 403) {
      return { kind: 'invalid_session' };
    }

    if (response.status !== 200 || !isRecord(response.body)) {
      return { kind: 'authentication_unavailable' };
    }

    const userId = response.body.id;
    if (typeof userId !== 'string' || !UUID_SHAPE.test(userId)) {
      return { kind: 'authentication_unavailable' };
    }

    return {
      kind: 'authenticated',
      principal: { userId },
    };
  };
}

export function createDashboardAuthorizationService(options: {
  readonly sessionVerifier: DashboardSessionVerifier;
  readonly contextStore: DashboardMerchantContextStore;
}): DashboardAuthorizationService {
  return async (input) => {
    const verification = await options.sessionVerifier(input.authorization);
    if (verification.kind !== 'authenticated') {
      return verification;
    }

    return options.contextStore.requireContext({
      userId: verification.principal.userId,
      merchantId: input.merchantId,
      environment: input.environment,
      requiredRole: input.requiredRole,
    });
  };
}
