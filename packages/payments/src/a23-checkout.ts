import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import type {
  ClaimPixAttemptResult,
  PixEmulator,
  PublicPayment,
} from './core.js';

export type DashboardPaymentLinkEnvironment = 'sandbox' | 'production';
export type DashboardPaymentLinkRole = 'member' | 'admin' | 'owner';

export interface DashboardPaymentLink {
  readonly id: string;
  readonly publicToken: string;
  readonly checkoutPath: string;
  readonly status: 'active' | 'disabled';
  readonly amount: number;
  readonly currency: 'BRL';
  readonly description: string | null;
  readonly pixExpirationMinutes: number;
  readonly createdAt: string;
  readonly disabledAt: string | null;
}

export interface PublicPaymentLink {
  readonly merchantName: string;
  readonly amount: number;
  readonly currency: 'BRL';
  readonly description: string | null;
  readonly environment: 'sandbox';
  readonly pixExpirationMinutes: number;
}

interface DashboardSessionVerifierLike {
  (authorization: unknown): Promise<
    | { readonly kind: 'authenticated'; readonly principal: { readonly userId: string } }
    | { readonly kind: 'invalid_session' }
    | { readonly kind: 'authentication_unavailable' }
  >;
}

interface DashboardContextStoreLike {
  requireContext(input: {
    readonly userId: string;
    readonly merchantId: string;
    readonly environment: DashboardPaymentLinkEnvironment;
    readonly requiredRole: DashboardPaymentLinkRole;
  }): Promise<
    | { readonly kind: 'authorized'; readonly context: { readonly membershipRole: DashboardPaymentLinkRole } }
    | { readonly kind: 'forbidden' | 'validation_error' | 'internal_error' }
  >;
}

interface DashboardPaymentLinkStoreLike {
  list(input: {
    readonly userId: string;
    readonly merchantId: string;
    readonly environment: DashboardPaymentLinkEnvironment;
  }): Promise<readonly DashboardPaymentLink[]>;
  create(input: {
    readonly userId: string;
    readonly merchantId: string;
    readonly environment: DashboardPaymentLinkEnvironment;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  disable(input: {
    readonly userId: string;
    readonly merchantId: string;
    readonly environment: DashboardPaymentLinkEnvironment;
    readonly paymentLinkId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

interface HostedCheckoutStoreLike {
  getLink(publicToken: string): Promise<PublicPaymentLink | null>;
  preparePayment(input: {
    readonly publicToken: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
  }): Promise<
    | {
        readonly kind: 'prepared';
        readonly merchantId: string;
        readonly payment: PublicPayment;
        readonly providerAttempt: { readonly id: string; readonly amountCents: number; readonly expiresAt: string };
      }
    | { readonly kind: 'completed'; readonly httpStatus: 201; readonly payment: PublicPayment }
    | { readonly kind: 'executing' | 'execution_unknown'; readonly payment: PublicPayment }
    | { readonly kind: 'not_found' | 'validation_error' | 'conflict' }
  >;
}

interface PixAttemptStoreLike {
  claimPixAttempt(input: {
    readonly merchantId: string;
    readonly environment: 'sandbox';
    readonly paymentId: string;
    readonly providerAttemptId: string;
  }): Promise<ClaimPixAttemptResult>;
  resolvePixAttempt(input: {
    readonly merchantId: string;
    readonly environment: 'sandbox';
    readonly paymentId: string;
    readonly providerAttemptId: string;
    readonly executionToken: string;
    readonly resolution: unknown;
  }): Promise<PublicPayment>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^plink_sandbox_[A-Za-z0-9_-]{32}$/;
const CREATE_FIELDS = new Set(['amount', 'currency', 'description', 'pixExpirationMinutes']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(namespace: string, vector: readonly unknown[]): string {
  return createHash('sha256').update(`${namespace}\n${JSON.stringify(vector)}`, 'utf8').digest('hex');
}

function idempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 160 ? normalized : null;
}

function environment(value: string): DashboardPaymentLinkEnvironment | null {
  return value === 'sandbox' || value === 'production' ? value : null;
}

function scalarKind(value: unknown): string {
  return isRecord(value) && typeof value.kind === 'string' ? value.kind : 'internal_error';
}

export function generatePaymentLinkPublicToken(
  randomBytes: (size: number) => Buffer = nodeRandomBytes,
): string {
  const material = randomBytes(24);
  if (!Buffer.isBuffer(material) || material.length !== 24) {
    throw new Error('Invalid payment-link token generator.');
  }
  return `plink_sandbox_${material.toString('base64url')}`;
}

async function authorizeDashboard(
  sessionVerifier: DashboardSessionVerifierLike,
  contextStore: DashboardContextStoreLike,
  input: {
    authorization?: string;
    merchantId: string;
    environment: string;
    requiredRole: DashboardPaymentLinkRole;
  },
): Promise<
  | { readonly kind: 'authorized'; readonly userId: string; readonly environment: DashboardPaymentLinkEnvironment }
  | { readonly kind: 'invalid_session' | 'authentication_unavailable' | 'forbidden' | 'validation_error' | 'internal_error' }
> {
  const parsedEnvironment = environment(input.environment);
  if (!UUID_RE.test(input.merchantId) || parsedEnvironment === null) return { kind: 'validation_error' };
  const session = await sessionVerifier(input.authorization);
  if (session.kind !== 'authenticated') return session;
  const context = await contextStore.requireContext({
    userId: session.principal.userId,
    merchantId: input.merchantId,
    environment: parsedEnvironment,
    requiredRole: input.requiredRole,
  });
  if (context.kind !== 'authorized') return context;
  return { kind: 'authorized', userId: session.principal.userId, environment: parsedEnvironment };
}

function validateCreateRequest(value: unknown): {
  amount: number;
  currency: 'BRL';
  description: string | null;
  pixExpirationMinutes: number;
} | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !CREATE_FIELDS.has(key))) return null;
  if (typeof value.amount !== 'number' || !Number.isSafeInteger(value.amount) || value.amount < 1) return null;
  if (value.currency !== 'BRL') return null;
  if ('description' in value && typeof value.description !== 'string') return null;
  const expiration = 'pixExpirationMinutes' in value ? value.pixExpirationMinutes : 60;
  if (typeof expiration !== 'number' || !Number.isSafeInteger(expiration) || expiration < 5 || expiration > 1440) return null;
  return {
    amount: value.amount,
    currency: 'BRL',
    description: typeof value.description === 'string' ? value.description : null,
    pixExpirationMinutes: expiration,
  };
}

export function createDashboardPaymentLinksService(options: {
  readonly sessionVerifier: DashboardSessionVerifierLike;
  readonly contextStore: DashboardContextStoreLike;
  readonly store: DashboardPaymentLinkStoreLike;
  readonly randomBytes?: (size: number) => Buffer;
}) {
  return Object.freeze({
    async list(input: { authorization?: string; merchantId: string; environment: string }): Promise<Record<string, unknown>> {
      try {
        const authorization = await authorizeDashboard(options.sessionVerifier, options.contextStore, {
          ...input, requiredRole: 'member',
        });
        if (authorization.kind !== 'authorized') return authorization;
        const data = await options.store.list({
          userId: authorization.userId,
          merchantId: input.merchantId,
          environment: authorization.environment,
        });
        return { kind: 'ok', data };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async create(input: {
      authorization?: string; merchantId: string; environment: string;
      idempotencyKey?: string; request: unknown;
    }): Promise<Record<string, unknown>> {
      try {
        const authorization = await authorizeDashboard(options.sessionVerifier, options.contextStore, {
          authorization: input.authorization,
          merchantId: input.merchantId,
          environment: input.environment,
          requiredRole: 'admin',
        });
        if (authorization.kind !== 'authorized') return authorization;
        if (authorization.environment === 'production') return { kind: 'forbidden' };

        const key = idempotencyKey(input.idempotencyKey);
        const request = validateCreateRequest(input.request);
        if (key === null || request === null) return { kind: 'validation_error' };
        const requestHash = sha256('a23-dashboard-payment-link-create-v0', [
          input.merchantId.toLowerCase(), authorization.environment,
          request.amount, request.currency, request.description, request.pixExpirationMinutes,
        ]);
        const baseCommand: Record<string, unknown> = { ...request };

        let result = await options.store.create({
          userId: authorization.userId,
          merchantId: input.merchantId,
          environment: authorization.environment,
          idempotencyKey: key,
          requestHash,
          command: baseCommand,
        });

        if (scalarKind(result) !== 'token_required') return result;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          const publicToken = generatePaymentLinkPublicToken(options.randomBytes);
          result = await options.store.create({
            userId: authorization.userId,
            merchantId: input.merchantId,
            environment: authorization.environment,
            idempotencyKey: key,
            requestHash,
            command: { ...baseCommand, publicToken },
          });
          if (scalarKind(result) !== 'token_collision') return result;
        }
        return { kind: 'internal_error' };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async disable(input: {
      authorization?: string; merchantId: string; environment: string; paymentLinkId: string;
      idempotencyKey?: string; request: unknown;
    }): Promise<Record<string, unknown>> {
      try {
        const authorization = await authorizeDashboard(options.sessionVerifier, options.contextStore, {
          authorization: input.authorization,
          merchantId: input.merchantId,
          environment: input.environment,
          requiredRole: 'admin',
        });
        if (authorization.kind !== 'authorized') return authorization;
        if (authorization.environment === 'production') return { kind: 'forbidden' };
        if (!UUID_RE.test(input.paymentLinkId) || !isRecord(input.request) || Object.keys(input.request).length !== 0) {
          return { kind: 'validation_error' };
        }
        const key = idempotencyKey(input.idempotencyKey);
        if (key === null) return { kind: 'validation_error' };
        const requestHash = sha256('a23-dashboard-payment-link-disable-v0', [
          input.merchantId.toLowerCase(), authorization.environment, input.paymentLinkId.toLowerCase(),
        ]);
        return await options.store.disable({
          userId: authorization.userId,
          merchantId: input.merchantId,
          environment: authorization.environment,
          paymentLinkId: input.paymentLinkId,
          idempotencyKey: key,
          requestHash,
          command: {},
        });
      } catch {
        return { kind: 'internal_error' };
      }
    },
  });
}

export function createHostedCheckoutService(options: {
  readonly store: HostedCheckoutStoreLike;
  readonly pixStore: PixAttemptStoreLike;
  readonly emulator: PixEmulator;
}) {
  return Object.freeze({
    async getLink(publicToken: string): Promise<
      | { readonly kind: 'ok'; readonly link: PublicPaymentLink }
      | { readonly kind: 'not_found' | 'internal_error' }
    > {
      if (!TOKEN_RE.test(publicToken)) return { kind: 'not_found' };
      try {
        const link = await options.store.getLink(publicToken);
        return link === null ? { kind: 'not_found' } : { kind: 'ok', link };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async createPayment(input: { publicToken: string; idempotencyKey: unknown; request: unknown }): Promise<
      | { readonly kind: 'ok'; readonly httpStatus: 201 | 202; readonly payment: PublicPayment; readonly replayed: boolean }
      | { readonly kind: 'not_found' | 'validation_error' | 'idempotency_conflict' | 'internal_error' }
    > {
      if (!TOKEN_RE.test(input.publicToken)) return { kind: 'not_found' };
      if (!isRecord(input.request) || Object.keys(input.request).length !== 0) return { kind: 'validation_error' };
      const key = idempotencyKey(input.idempotencyKey);
      if (key === null) return { kind: 'validation_error' };
      const requestHash = sha256('a23-checkout-create-payment-v0', [input.publicToken, {}]);

      try {
        const prepared = await options.store.preparePayment({
          publicToken: input.publicToken,
          idempotencyKey: key,
          requestHash,
        });
        if (prepared.kind === 'not_found') return { kind: 'not_found' };
        if (prepared.kind === 'validation_error') return { kind: 'validation_error' };
        if (prepared.kind === 'conflict') return { kind: 'idempotency_conflict' };
        if (prepared.kind === 'completed') {
          return { kind: 'ok', httpStatus: 201, payment: prepared.payment, replayed: true };
        }
        if (prepared.kind === 'executing' || prepared.kind === 'execution_unknown') {
          return { kind: 'ok', httpStatus: 202, payment: prepared.payment, replayed: true };
        }

        const claim = await options.pixStore.claimPixAttempt({
          merchantId: prepared.merchantId,
          environment: 'sandbox',
          paymentId: prepared.payment.id,
          providerAttemptId: prepared.providerAttempt.id,
        });
        if (!claim.claimed) {
          return { kind: 'ok', httpStatus: 202, payment: prepared.payment, replayed: true };
        }

        const resolution = await options.emulator.createPixCharge({
          providerAttemptId: prepared.providerAttempt.id,
          amountCents: prepared.providerAttempt.amountCents,
          expiresAt: prepared.providerAttempt.expiresAt,
        });
        const payment = await options.pixStore.resolvePixAttempt({
          merchantId: prepared.merchantId,
          environment: 'sandbox',
          paymentId: prepared.payment.id,
          providerAttemptId: prepared.providerAttempt.id,
          executionToken: claim.executionToken,
          resolution,
        });
        return {
          kind: 'ok',
          httpStatus: resolution.certainty === 'execution_unknown' ? 202 : 201,
          payment,
          replayed: false,
        };
      } catch {
        return { kind: 'internal_error' };
      }
    },
  });
}
