import {
  authenticateAccessToken,
  createTokenExchangeHandler,
  type TokenExchangeHandler,
  type TokenExchangeServiceOptions,
} from '@swiftpay/auth';
import {
  createApiCredentialAuthStore,
  createPixPaymentStore,
  verifyRuntimeBoundary,
} from '@swiftpay/db';
import {
  createDeterministicPixEmulator,
  createPixPaymentService,
} from '../../../packages/payments/dist/index.js';
import type { BearerAuthenticator, PixPaymentsHttpService } from './app.js';

type ApiRuntimePool = Parameters<typeof verifyRuntimeBoundary>[0];

export type ApiRuntimeServicesOptions = TokenExchangeServiceOptions;

export interface ApiRuntimeServices {
  readonly readinessProbe: () => Promise<void>;
  readonly tokenExchange: TokenExchangeHandler;
  readonly authenticateBearer: BearerAuthenticator;
  readonly pixPayments: PixPaymentsHttpService;
}

export function createApiRuntimeServices(
  pool: ApiRuntimePool,
  options: ApiRuntimeServicesOptions,
): ApiRuntimeServices {
  const authStore = createApiCredentialAuthStore(pool);
  const pixStore = createPixPaymentStore(pool);
  const pixService = createPixPaymentService(
    pixStore,
    createDeterministicPixEmulator(),
  );

  return {
    readinessProbe: () => verifyRuntimeBoundary(pool, 'api'),
    tokenExchange: createTokenExchangeHandler(authStore, options),
    authenticateBearer: (token) => authenticateAccessToken(
      token,
      options.signingKey,
      authStore,
      options.nowSeconds?.(),
    ),
    pixPayments: {
      create: (input) => pixService.create(input),
      get: ({ principal, paymentId }) => pixStore.getPayment({
        merchantId: principal.merchantId,
        environment: principal.environment,
        paymentId,
      }),
    },
  };
}
