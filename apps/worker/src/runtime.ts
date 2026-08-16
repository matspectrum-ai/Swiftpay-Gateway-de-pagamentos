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
  readonly webhookEncryptionKey: string;
  readonly webhookEndpointPolicy?: WebhookEndpointPolicy;
  readonly webhookTransport?: WebhookTransport;
  readonly clock?: { nowUnixSeconds(): number };
}

export interface WorkerRuntimeServices {
  readonly readinessProbe: () => Promise<void>;
  readonly sandboxPaidEvidence: SandboxPaidEvidenceDatabaseStore;
  readonly webhookDeliveries: WebhookDeliveryService;
}

export function createWorkerRuntimeServices(
  pool: WorkerRuntimePool,
  options: WorkerRuntimeOptions,
): WorkerRuntimeServices {
  const webhookStore = createMerchantWebhookDeliveryStore(pool);
  const endpointPolicy = options.webhookEndpointPolicy ?? createNodeWebhookEndpointPolicy();
  const transport = options.webhookTransport ?? createNodeWebhookTransport();
  const clock = options.clock ?? {
    nowUnixSeconds: () => Math.floor(Date.now() / 1000),
  };

  return {
    readinessProbe: () => verifyRuntimeBoundary(pool, 'worker'),
    sandboxPaidEvidence: createSandboxPaidEvidenceStore(pool),
    webhookDeliveries: createWebhookDeliveryService({
      store: webhookStore,
      encryptionKey: options.webhookEncryptionKey,
      endpointPolicy,
      transport,
      clock,
    }),
  };
}
