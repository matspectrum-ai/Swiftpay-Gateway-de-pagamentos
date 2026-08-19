import {
  createSupabaseDashboardSessionVerifier,
} from '@swiftpay/auth';
import {
  createDashboardMerchantContextStore,
  createDashboardPaymentLinkStore,
  createHostedCheckoutStore,
  createPixPaymentStore,
} from '@swiftpay/db';
import {
  createDashboardPaymentLinksService,
  createDeterministicPixEmulator,
  createHostedCheckoutService,
} from '../../../packages/payments/dist/index.js';
import type {
  DashboardPaymentLinksHttpService,
  HostedCheckoutHttpService,
} from './app.js';
import {
  createApiRuntimeServices as createBaseApiRuntimeServices,
  type ApiRuntimeServices as BaseApiRuntimeServices,
  type ApiRuntimeServicesOptions as BaseApiRuntimeServicesOptions,
} from './runtime-base.js';

export type ApiRuntimeServicesOptions = BaseApiRuntimeServicesOptions;

export interface ApiRuntimeServices extends BaseApiRuntimeServices {
  readonly dashboardPaymentLinks: DashboardPaymentLinksHttpService;
  readonly hostedCheckout: HostedCheckoutHttpService;
}

export function createApiRuntimeServices(
  pool: Parameters<typeof createBaseApiRuntimeServices>[0],
  options: ApiRuntimeServicesOptions,
): ApiRuntimeServices {
  const base = createBaseApiRuntimeServices(pool, options);

  const dashboardSessionVerifier = createSupabaseDashboardSessionVerifier({
    projectUrl: options.supabaseUrl,
    publishableKey: options.supabasePublishableKey,
  });
  const dashboardContextStore = createDashboardMerchantContextStore(pool);
  const dashboardPaymentLinkStore = createDashboardPaymentLinkStore(pool);
  const hostedCheckoutStore = createHostedCheckoutStore(pool);
  const pixStore = createPixPaymentStore(pool);

  const dashboardPaymentLinks = createDashboardPaymentLinksService({
    sessionVerifier: dashboardSessionVerifier,
    contextStore: dashboardContextStore,
    store: dashboardPaymentLinkStore,
  });
  const hostedCheckout = createHostedCheckoutService({
    store: hostedCheckoutStore,
    pixStore,
    emulator: createDeterministicPixEmulator(),
  });

  return {
    ...base,
    dashboardPaymentLinks: {
      list: (input) => dashboardPaymentLinks.list(input),
      create: (input) => dashboardPaymentLinks.create(input),
      disable: (input) => dashboardPaymentLinks.disable(input),
    },
    hostedCheckout: {
      getLink: async (publicToken) => ({ ...(await hostedCheckout.getLink(publicToken)) }),
      createPayment: async (input) => ({ ...(await hostedCheckout.createPayment(input)) }),
    },
  };
}
