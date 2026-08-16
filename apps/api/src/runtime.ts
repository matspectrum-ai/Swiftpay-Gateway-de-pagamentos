import {
  authenticateAccessToken,
  createDashboardAuthorizationService,
  createSupabaseDashboardSessionVerifier,
  createTokenExchangeHandler,
  type DashboardAuthorizationService,
  type TokenExchangeHandler,
  type TokenExchangeServiceOptions,
} from '@swiftpay/auth';
import {
  createApiCredentialAuthStore,
  createDashboardMerchantContextStore,
  createDashboardWebhookEndpointStore,
  createMerchantBalanceStore,
  createPixPaymentStore,
  verifyRuntimeBoundary,
} from '@swiftpay/db';
import {
  createDeterministicPixEmulator,
  createPixPaymentService,
} from '../../../packages/payments/dist/index.js';
import {
  createDashboardWebhookEndpointManagementService,
  createNodeWebhookEndpointPolicy,
  parseWebhookWrappingPublicKey,
} from '../../../packages/webhooks/dist/index.js';
import type {
  BearerAuthenticator,
  DashboardWebhookEndpointsHttpService,
  MerchantBalanceHttpService,
  PixPaymentsHttpService,
} from './app.js';

type ApiRuntimePool = Parameters<typeof verifyRuntimeBoundary>[0];

export interface ApiRuntimeServicesOptions extends TokenExchangeServiceOptions {
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly webhookSecretWrapKeyId?: string;
  readonly webhookSecretWrapPublicKey?: string;
}

export interface ApiRuntimeServices {
  readonly readinessProbe: () => Promise<void>;
  readonly tokenExchange: TokenExchangeHandler;
  readonly authenticateBearer: BearerAuthenticator;
  readonly dashboardAuthorization: DashboardAuthorizationService;
  readonly dashboardWebhookEndpoints?: DashboardWebhookEndpointsHttpService;
  readonly pixPayments: PixPaymentsHttpService;
  readonly merchantBalance: MerchantBalanceHttpService;
}

export function createApiRuntimeServices(
  pool: ApiRuntimePool,
  options: ApiRuntimeServicesOptions,
): ApiRuntimeServices {
  const authStore = createApiCredentialAuthStore(pool);
  const dashboardContextStore = createDashboardMerchantContextStore(pool);
  const dashboardSessionVerifier = createSupabaseDashboardSessionVerifier({
    projectUrl: options.supabaseUrl,
    publishableKey: options.supabasePublishableKey,
  });
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
    tokenExchange: createTokenExchangeHandler(authStore, options),
    authenticateBearer: (token) => authenticateAccessToken(
      token,
      options.signingKey,
      authStore,
      options.nowSeconds?.(),
    ),
    dashboardAuthorization: createDashboardAuthorizationService({
      sessionVerifier: dashboardSessionVerifier,
      contextStore: dashboardContextStore,
    }),
    ...(dashboardWebhookEndpoints === undefined ? {} : { dashboardWebhookEndpoints }),
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
