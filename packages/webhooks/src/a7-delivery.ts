import {
  classifyWebhookOutcome,
  computeWebhookRetryDelay,
  serializeWebhookEvent,
  signWebhookRequest,
  type MerchantWebhookDeliveryClaim as LegacyClaim,
  type MerchantWebhookDeliveryStore,
  type ValidatedWebhookEndpoint,
  type WebhookDeliveryService,
  type WebhookEndpointPolicy,
  type WebhookErrorClass,
  type WebhookOutcome,
  type WebhookTransport,
} from './legacy.js';
import { unwrapWebhookSigningSecret } from './a7.js';

type A7Endpoint = LegacyClaim['endpoint'] & {
  readonly signingSecretCiphertextFormat?: string | null;
  readonly signingSecretWrappingKeyId?: string | null;
};

type A7Claim = Omit<LegacyClaim, 'endpoint'> & { readonly endpoint: A7Endpoint };

type A7Store = Omit<MerchantWebhookDeliveryStore, 'claim'> & {
  claim(input: { workerId: string; limit: number; leaseSeconds: number }): Promise<readonly A7Claim[]>;
};

function safeSecretError(code: 'signing_secret_unavailable' | 'signing_secret_invalid'): Error & { code: string } {
  return Object.assign(new Error('signing secret unavailable'), { code });
}

function secretForClaim(input: {
  claim: A7Claim;
  privateKeyring: string | Readonly<Record<string, string>>;
}): string {
  const endpoint = input.claim.endpoint;
  if (endpoint.signingSecretCiphertext === null || endpoint.signingSecretCiphertext.trim().length === 0) {
    throw safeSecretError('signing_secret_unavailable');
  }
  if (endpoint.signingSecretCiphertextFormat !== 'rsa-oaep-sha256-v1') {
    throw safeSecretError('signing_secret_invalid');
  }
  const keyId = endpoint.signingSecretWrappingKeyId;
  if (keyId === null || keyId === undefined) {
    throw safeSecretError('signing_secret_unavailable');
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(keyId)) {
    throw safeSecretError('signing_secret_invalid');
  }

  return unwrapWebhookSigningSecret({
    privateKeyring: input.privateKeyring,
    wrappingKeyId: keyId,
    endpointId: endpoint.id,
    secretVersion: endpoint.signingSecretVersion,
    ciphertext: endpoint.signingSecretCiphertext,
  });
}

export function createWebhookDeliveryService(input: {
  store: A7Store;
  privateKeyring: string | Readonly<Record<string, string>>;
  endpointPolicy: WebhookEndpointPolicy;
  transport: WebhookTransport;
  clock: { nowUnixSeconds(): number };
}): WebhookDeliveryService {
  async function terminal(
    claim: A7Claim,
    errorClass: WebhookErrorClass,
    errorCode: string,
  ): Promise<void> {
    await input.store.resolve({
      jobId: claim.jobId,
      deliveryId: claim.deliveryId,
      leaseToken: claim.leaseToken,
      outcome: 'terminal',
      httpStatus: null,
      errorClass,
      errorCode,
      retryAfterSeconds: null,
    });
  }

  return {
    async runBatch(batch) {
      const claims = await input.store.claim(batch);
      const result = { claimed: claims.length, succeeded: 0, retried: 0, terminal: 0 };

      for (const claim of claims) {
        if (claim.event.payloadVersion !== 'payment-v1') {
          await terminal(claim, 'validation', 'unsupported_payload_version');
          result.terminal += 1;
          continue;
        }
        if (claim.endpoint.signingSecretCiphertext === null) {
          await terminal(claim, 'configuration', 'signing_secret_unavailable');
          result.terminal += 1;
          continue;
        }

        let secret: string;
        try {
          secret = secretForClaim({ claim, privateKeyring: input.privateKeyring });
        } catch (error) {
          const code = error instanceof Error && 'code' in error && error.code === 'signing_secret_unavailable'
            ? 'signing_secret_unavailable'
            : 'signing_secret_invalid';
          await terminal(claim, 'configuration', code);
          result.terminal += 1;
          continue;
        }

        let destination: ValidatedWebhookEndpoint;
        try {
          destination = await input.endpointPolicy.resolveAndValidate(
            claim.endpoint.url,
            claim.endpoint.environment,
          );
        } catch {
          await terminal(claim, 'configuration', 'endpoint_policy');
          result.terminal += 1;
          continue;
        }

        const body = serializeWebhookEvent(claim.event);
        const timestamp = input.clock.nowUnixSeconds();
        const signature = signWebhookRequest({
          secret,
          timestamp,
          eventId: claim.event.id,
          deliveryId: claim.deliveryId,
          body,
        });
        const headers: Record<string, string> = {
          'content-type': 'application/json; charset=utf-8',
          'user-agent': 'SwiftPay-Webhooks/1',
          'x-swiftpay-event': claim.event.id,
          'x-swiftpay-delivery': claim.deliveryId,
          'x-swiftpay-timestamp': String(timestamp),
          'x-swiftpay-signature': signature,
          'x-swiftpay-signature-version': String(claim.endpoint.signingSecretVersion),
        };

        let status: number | undefined;
        let responseHeaders: Readonly<Record<string, string | string[] | undefined>> | undefined;
        let classified: WebhookOutcome;
        try {
          const response = await input.transport.send({
            method: 'POST',
            url: destination.url,
            hostname: destination.hostname,
            pinnedAddress: destination.pinnedAddress,
            headers,
            body,
            timeoutMs: 5000,
            redirects: 'manual',
          });
          status = response.status;
          responseHeaders = response.headers;
          classified = classifyWebhookOutcome({ status });
        } catch (error) {
          classified = classifyWebhookOutcome({
            timeout: error instanceof Error && error.name === 'WebhookTransportTimeout',
            networkError: !(error instanceof Error && error.name === 'WebhookTransportTimeout'),
          });
        }

        if (classified.kind === 'success') {
          await input.store.resolve({
            jobId: claim.jobId,
            deliveryId: claim.deliveryId,
            leaseToken: claim.leaseToken,
            outcome: 'success',
            httpStatus: status ?? null,
            errorClass: null,
            errorCode: null,
            retryAfterSeconds: null,
          });
          result.succeeded += 1;
          continue;
        }

        if (classified.kind === 'terminal') {
          await input.store.resolve({
            jobId: claim.jobId,
            deliveryId: claim.deliveryId,
            leaseToken: claim.leaseToken,
            outcome: 'terminal',
            httpStatus: status ?? null,
            errorClass: classified.errorClass,
            errorCode: classified.errorCode,
            retryAfterSeconds: null,
          });
          result.terminal += 1;
          continue;
        }

        const retryAfterHeader = status === 429 ? responseHeaders?.['retry-after'] : undefined;
        const retryAfter = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader;
        const delay = computeWebhookRetryDelay({
          deliveryId: claim.deliveryId,
          attemptNumber: claim.attemptNumber,
          ...(status === undefined ? {} : { status }),
          ...(retryAfter === undefined ? {} : { retryAfter }),
        });

        if (delay === null) {
          await input.store.resolve({
            jobId: claim.jobId,
            deliveryId: claim.deliveryId,
            leaseToken: claim.leaseToken,
            outcome: 'terminal',
            httpStatus: status ?? null,
            errorClass: classified.errorClass,
            errorCode: classified.errorCode,
            retryAfterSeconds: null,
          });
          result.terminal += 1;
        } else {
          await input.store.resolve({
            jobId: claim.jobId,
            deliveryId: claim.deliveryId,
            leaseToken: claim.leaseToken,
            outcome: 'retry',
            httpStatus: status ?? null,
            errorClass: classified.errorClass,
            errorCode: classified.errorCode,
            retryAfterSeconds: delay,
          });
          result.retried += 1;
        }
      }
      return result;
    },
  };
}
