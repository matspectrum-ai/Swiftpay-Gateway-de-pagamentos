import {
  createTokenExchangeHandler,
  type TokenExchangeHandler,
  type TokenExchangeServiceOptions,
} from '@swiftpay/auth';
import { createApiCredentialAuthStore, verifyRuntimeBoundary } from '@swiftpay/db';

type ApiRuntimePool = Parameters<typeof verifyRuntimeBoundary>[0];

export type ApiRuntimeServicesOptions = TokenExchangeServiceOptions;

export interface ApiRuntimeServices {
  readonly readinessProbe: () => Promise<void>;
  readonly tokenExchange: TokenExchangeHandler;
}

export function createApiRuntimeServices(
  pool: ApiRuntimePool,
  options: ApiRuntimeServicesOptions,
): ApiRuntimeServices {
  const authStore = createApiCredentialAuthStore(pool);

  return {
    readinessProbe: () => verifyRuntimeBoundary(pool, 'api'),
    tokenExchange: createTokenExchangeHandler(authStore, options),
  };
}
