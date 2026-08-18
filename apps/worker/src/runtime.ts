import {
  createMerchantWebhookDeliveryStore,
  createSandboxPaidEvidenceStore,
  verifyRuntimeBoundary,
  type SandboxPaidEvidenceDatabaseStore,
} from '@swiftpay/db';
import {
  createNodeWebhookEndpointPolicy,
  createNodeWebhookTransport,
  createWebhookDeliveryService,
  type WebhookDeliveryService,
  type WebhookEndpointPolicy,
  type WebhookTransport,
} from '../../../packages/webhooks/dist/index.js';

type WorkerRuntimePool = Parameters<typeof verifyRuntimeBoundary>[0];

export interface WorkerRuntimeOptions {
  readonly webhookPrivateKeyring: string | Readonly<Record<string, string>>;
  readonly webhookEndpointPolicy?: WebhookEndpointPolicy;
  readonly webhookTransport?: WebhookTransport;
  readonly clock?: { nowUnixSeconds(): number };
}

export interface WorkerRuntimeServices {
  readonly readinessProbe: () => Promise<void>;
  readonly sandboxPaidEvidence: SandboxPaidEvidenceDatabaseStore;
  readonly webhookDeliveries: WebhookDeliveryService;
}

function unconfiguredWebhookDeliveryService(): WebhookDeliveryService {
  return {
    async runBatch() {
      throw new Error('Webhook delivery runtime is not configured');
    },
  };
}

export function createWorkerRuntimeServices(
  pool: WorkerRuntimePool,
  options?: WorkerRuntimeOptions,
): WorkerRuntimeServices {
  let webhookDeliveries: WebhookDeliveryService;

  if (options === undefined) {
    webhookDeliveries = unconfiguredWebhookDeliveryService();
  } else {
    const webhookStore = createMerchantWebhookDeliveryStore(pool);
    const endpointPolicy = options.webhookEndpointPolicy ?? createNodeWebhookEndpointPolicy();
    const transport = options.webhookTransport ?? createNodeWebhookTransport();
    const clock = options.clock ?? {
      nowUnixSeconds: () => Math.floor(Date.now() / 1000),
    };

    webhookDeliveries = createWebhookDeliveryService({
      store: webhookStore,
      privateKeyring: options.webhookPrivateKeyring,
      endpointPolicy,
      transport,
      clock,
    });
  }

  return {
    readinessProbe: () => verifyRuntimeBoundary(pool, 'worker'),
    sandboxPaidEvidence: createSandboxPaidEvidenceStore(pool),
    webhookDeliveries,
  };
}
