import { createApiAbuseControls, type ApiAbuseControls } from '../../../packages/abuse/dist/index.js';
import {
  authenticateAccessToken,
  createAccessTokenSigningAuthority,
  createDashboardApiCredentialManagementService,
  createDashboardAuthorizationService,
  createPrivilegedDashboardSessionVerifier,
  createSupabaseDashboardSessionVerifier,
  createTokenExchangeHandler,
  type AccessTokenSigningKeyEntry,
  type DashboardApiCredentialManagementService,
  type DashboardAuthorizationService,
  type TokenExchangeHandler,
} from '@swiftpay/auth';
import {
  createApiAbuseRateLimitStore,
  createApiCredentialAuthStore,
  createDashboardApiCredentialStore,
  createDashboardMerchantContextStore,
  createDashboardTransactionStore,
  createDashboardWebhookEndpointStore,
  createMerchantBalanceStore,
  createPixPaymentStore,
  verifyRuntimeBoundary,
} from '@swiftpay/db';
import {
  createDashboardTransactionCursorCodec,
  createDashboardTransactionReadService,
  createDeterministicPixEmulator,
  createPixPaymentService,
  type DashboardTransactionCursorHmacKey,
} from '../../../packages/payments/dist/index.js';
import {
  createDashboardWebhookEndpointManagementService,
  createNodeWebhookEndpointPolicy,
  parseWebhookWrappingPublicKey,
} from '../../../packages/webhooks/dist/index.js';
import type {
  BearerAuthenticator,
  DashboardTransactionsHttpService,
  DashboardWebhookEndpointsHttpService,
  MerchantBalanceHttpService,
  PixPaymentsHttpService,
} from './app.js';

type ApiRuntimePool = Parameters<typeof verifyRuntimeBoundary>[0];

export interface ApiRuntimeServicesOptions {
  readonly accessTokenActiveKeyId: string;
  readonly accessTokenSigningKeys: readonly AccessTokenSigningKeyEntry[];
  readonly accessTokenLegacyNoKidKey?: string;
  readonly nowSeconds?: () => number;
  readonly jti?: () => string;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly dashboardCursorActiveKeyId: string;
  readonly dashboardCursorHmacKeys: readonly DashboardTransactionCursorHmacKey[];
  readonly dashboardCursorLegacyV0Key?: string;
  readonly trustedProxyIps?: readonly string[];
  readonly abuseHmacKey?: string;
  readonly webhookSecretWrapKeyId?: string;
  readonly webhookSecretWrapPublicKey?: string;
}

export interface ApiRuntimeServices {
  readonly readinessProbe: () => Promise<void>;
  readonly abuseControls?: ApiAbuseControls;
  readonly tokenExchange: TokenExchangeHandler;
  readonly authenticateBearer: BearerAuthenticator;
  readonly dashboardAuthorization: DashboardAuthorizationService;
  readonly dashboardWebhookEndpoints?: DashboardWebhookEndpointsHttpService;
  readonly dashboardApiCredentials: DashboardApiCredentialManagementService;
  readonly dashboardTransactions: DashboardTransactionsHttpService;
  readonly pixPayments: PixPaymentsHttpService;
  readonly merchantBalance: MerchantBalanceHttpService;
}

export function createApiRuntimeServices(
  pool: ApiRuntimePool,
  options: ApiRuntimeServicesOptions,
): ApiRuntimeServices {
  if (options.abuseHmacKey === undefined && options.trustedProxyIps !== undefined) {
    throw new Error('Invalid abuse-control runtime configuration.');
  }
  const abuseControls = options.abuseHmacKey === undefined
    ? undefined
    : createApiAbuseControls(
      createApiAbuseRateLimitStore(pool),
      { trustedProxyIps: options.trustedProxyIps ?? [], hmacKey: options.abuseHmacKey },
    );
  const signingAuthority = createAccessTokenSigningAuthority({
    activeKeyId: options.accessTokenActiveKeyId,
    keys: options.accessTokenSigningKeys,
    ...(options.accessTokenLegacyNoKidKey === undefined
      ? {}
      : { legacyNoKidKey: options.accessTokenLegacyNoKidKey }),
  });
  const authStore = createApiCredentialAuthStore(pool);
  const dashboardContextStore = createDashboardMerchantContextStore(pool);
  const dashboardSessionVerifier = createSupabaseDashboardSessionVerifier({
    projectUrl: options.supabaseUrl,
    publishableKey: options.supabasePublishableKey,
  });
  const privilegedDashboardSessionVerifier = createPrivilegedDashboardSessionVerifier({
    projectUrl: options.supabaseUrl,
    publishableKey: options.supabasePublishableKey,
  });
  const dashboardApiCredentialStore = createDashboardApiCredentialStore(pool);
  const dashboardApiCredentials = createDashboardApiCredentialManagementService({
    ordinarySessionVerifier: dashboardSessionVerifier,
    privilegedSessionVerifier: privilegedDashboardSessionVerifier,
    contextStore: dashboardContextStore,
    store: dashboardApiCredentialStore,
  });
  const dashboardTransactionStore = createDashboardTransactionStore(pool);
  const dashboardTransactionCursorCodec = createDashboardTransactionCursorCodec({
    activeKeyId: options.dashboardCursorActiveKeyId,
    keys: options.dashboardCursorHmacKeys,
    ...(options.dashboardCursorLegacyV0Key === undefined
      ? {}
      : { legacyV0Key: options.dashboardCursorLegacyV0Key }),
  });
  const dashboardTransactionReadService = createDashboardTransactionReadService({
    sessionVerifier: dashboardSessionVerifier,
    contextStore: dashboardContextStore as unknown as Parameters<typeof createDashboardTransactionReadService>[0]['contextStore'],
    store: dashboardTransactionStore,
    cursorCodec: dashboardTransactionCursorCodec,
  });
  const dashboardTransactions: DashboardTransactionsHttpService = {
    list: async (input) => ({ ...(await dashboardTransactionReadService.list(input)) }),
    get: async (input) => ({ ...(await dashboardTransactionReadService.get(input)) }),
  };
  const pixStore = createPixPaymentStore(pool);
  const balanceStore = createMerchantBalanceStore(pool);
  const pixService = createPixPaymentService(
    pixStore,
    createDeterministicPixEmulator(),
  );

  let dashboardWebhookEndpoints: DashboardWebhookEndpointsHttpService | undefined;
  if (options.webhookSecretWrapKeyId !== undefined && options.webhookSecretWrapPublicKey !== undefined) {
    parseWebhookWrappingPublicKey(options.webhookSecretWrapPublicKey);
    const webhookEndpointStore = createDashboardWebhookEndpointStore(pool);
    dashboardWebhookEndpoints = createDashboardWebhookEndpointManagementService({
      sessionVerifier: dashboardSessionVerifier,
      contextStore: dashboardContextStore,
      endpointPolicy: createNodeWebhookEndpointPolicy(),
      store: webhookEndpointStore,
      wrappingKeyId: options.webhookSecretWrapKeyId,
      wrappingPublicKey: options.webhookSecretWrapPublicKey,
    });
  }

  return {
    readinessProbe: () => verifyRuntimeBoundary(pool, 'api'),
    ...(abuseControls === undefined ? {} : { abuseControls }),
    tokenExchange: createTokenExchangeHandler(authStore, {
      signingAuthority,
      ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
      ...(options.jti === undefined ? {} : { jti: options.jti }),
    }),
    authenticateBearer: (token) => authenticateAccessToken(
      token,
      signingAuthority,
      authStore,
      options.nowSeconds?.(),
    ),
    dashboardAuthorization: createDashboardAuthorizationService({
      sessionVerifier: dashboardSessionVerifier,
      contextStore: dashboardContextStore,
    }),
    ...(dashboardWebhookEndpoints === undefined ? {} : { dashboardWebhookEndpoints }),
    dashboardApiCredentials,
    dashboardTransactions,
    pixPayments: {
      create: (input) => pixService.create(input),
      get: ({ principal, paymentId }) => pixStore.getPayment({
        merchantId: principal.merchantId,
        environment: principal.environment,
        paymentId,
      }),
    },
    merchantBalance: {
      get: ({ principal }) => balanceStore.getBalance({
        merchantId: principal.merchantId,
        environment: principal.environment,
      }),
    },
  };
}
