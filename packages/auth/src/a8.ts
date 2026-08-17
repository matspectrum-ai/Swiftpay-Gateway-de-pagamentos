import { createHash, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { isIP } from 'node:net';
import {
  createSupabaseDashboardSessionVerifier,
  type DashboardMerchantContextStore,
  type DashboardSessionVerifier,
  type DashboardSessionVerifierOptions,
} from './dashboard.js';

export type ApiCredentialEnvironment = 'sandbox' | 'production';
export type ApiCredentialRole = 'member' | 'admin' | 'owner';

export interface PrivilegedDashboardPrincipal {
  readonly userId: string;
  readonly assuranceLevel: 'aal2';
}

export type PrivilegedDashboardSessionResult =
  | { readonly kind: 'authenticated'; readonly principal: PrivilegedDashboardPrincipal }
  | { readonly kind: 'invalid_session' }
  | { readonly kind: 'step_up_required' }
  | { readonly kind: 'authentication_unavailable' };

export type PrivilegedDashboardSessionVerifier = (
  authorization: unknown,
) => Promise<PrivilegedDashboardSessionResult>;

export interface ApiCredentialProjection {
  readonly id: string;
  readonly merchantId: string;
  readonly environment: ApiCredentialEnvironment;
  readonly name: string;
  readonly publicKey: string;
  readonly status: 'active' | 'revoked';
  readonly secretVersion: number;
  readonly revision: number;
  readonly ipAllowlist: readonly string[] | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
  readonly revokedAt: string | null;
}

export interface ApiCredentialMaterial {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly secretVerifier: string;
}

export interface DashboardApiCredentialStore {
  list(input: {
    userId: string;
    merchantId: string;
    environment: ApiCredentialEnvironment;
  }): Promise<readonly ApiCredentialProjection[]>;
  get(input: {
    userId: string;
    merchantId: string;
    environment: ApiCredentialEnvironment;
    credentialId: string;
  }): Promise<ApiCredentialProjection | null>;
  create(input: ApiCredentialMutationCommand): Promise<Record<string, unknown>>;
  rotateSecret(input: ApiCredentialMutationCommand & { credentialId: string }): Promise<Record<string, unknown>>;
  revoke(input: ApiCredentialMutationCommand & { credentialId: string }): Promise<Record<string, unknown>>;
}

export interface ApiCredentialMutationCommand {
  readonly userId: string;
  readonly merchantId: string;
  readonly environment: ApiCredentialEnvironment;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly command: Record<string, unknown>;
}

export interface DashboardApiCredentialManagementService {
  list(input: { authorization?: string; merchantId: string; environment: string }): Promise<Record<string, unknown>>;
  get(input: { authorization?: string; merchantId: string; environment: string; credentialId: string }): Promise<Record<string, unknown>>;
  create(input: { authorization?: string; merchantId: string; environment: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
  rotateSecret(input: { authorization?: string; merchantId: string; environment: string; credentialId: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
  revoke(input: { authorization?: string; merchantId: string; environment: string; credentialId: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_MAX_MEMORY_BYTES = 64 * 1024 * 1024;

function strictBearerToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/.exec(value);
  return match?.[1] ?? null;
}

function decodeValidatedJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const encoded = parts[1];
  if (encoded === undefined || encoded.length === 0 || !BASE64URL_RE.test(encoded)) return null;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) return null;
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function createPrivilegedDashboardSessionVerifier(
  options: DashboardSessionVerifierOptions,
): PrivilegedDashboardSessionVerifier {
  const onlineVerifier = createSupabaseDashboardSessionVerifier(options);
  return async (authorization) => {
    const online = await onlineVerifier(authorization);
    if (online.kind !== 'authenticated') return online;

    const token = strictBearerToken(authorization);
    if (token === null) return { kind: 'invalid_session' };
    const payload = decodeValidatedJwtPayload(token);
    if (payload === null || typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) {
      return { kind: 'invalid_session' };
    }
    if (payload.sub.toLowerCase() !== online.principal.userId.toLowerCase()) {
      return { kind: 'invalid_session' };
    }
    if (payload.aal === undefined || payload.aal === 'aal1') {
      return { kind: 'step_up_required' };
    }
    if (payload.aal !== 'aal2') return { kind: 'invalid_session' };

    return {
      kind: 'authenticated',
      principal: { userId: online.principal.userId, assuranceLevel: 'aal2' },
    };
  };
}

function deriveScrypt(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, SCRYPT_KEY_BYTES, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY_BYTES,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function createCredentialSecretVerifier(
  secret: string,
  options: { readonly salt?: Buffer } = {},
): Promise<string> {
  if (typeof secret !== 'string' || secret.length < 1 || secret.length > 512) {
    throw new Error('Invalid credential secret');
  }
  const salt = options.salt ?? randomBytes(SCRYPT_SALT_BYTES);
  if (!Buffer.isBuffer(salt) || salt.length !== SCRYPT_SALT_BYTES) {
    throw new Error('Invalid credential verifier salt');
  }
  const key = await deriveScrypt(secret, salt);
  return `scrypt-v1$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function generateApiCredentialMaterial(
  environment: ApiCredentialEnvironment,
  options: {
    readonly randomBytes?: (size: number) => Buffer;
    readonly verifierFactory?: (secret: string) => Promise<string>;
  } = {},
): Promise<ApiCredentialMaterial> {
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('Invalid credential environment');
  }
  const random = options.randomBytes ?? randomBytes;
  const publicBytes = random(18);
  const secretBytes = random(32);
  if (!Buffer.isBuffer(publicBytes) || publicBytes.length !== 18
      || !Buffer.isBuffer(secretBytes) || secretBytes.length !== 32) {
    throw new Error('Invalid credential randomness');
  }
  const publicKey = `pk_${environment}_${publicBytes.toString('base64url')}`;
  const secretKey = `sk_${environment}_${secretBytes.toString('base64url')}`;
  const secretVerifier = await (options.verifierFactory ?? createCredentialSecretVerifier)(secretKey);
  return { publicKey, secretKey, secretVerifier };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
}

function normalizeEnvironment(value: unknown): ApiCredentialEnvironment | null {
  return value === 'sandbox' || value === 'production' ? value : null;
}

function normalizeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null;
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 160 ? normalized : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 120 ? normalized : null;
}

function normalizeIpAllowlist(value: unknown): readonly string[] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 32) return undefined;
  if (value.length === 0) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() !== entry || isIP(entry) === 0
        || entry.includes('/') || entry.includes('*') || seen.has(entry)) return undefined;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function normalizeExpectedRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 1 ? value as number : null;
}

type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical };
function canonicalize(value: unknown): Canonical {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Invalid canonical number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const result: Record<string, Canonical> = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) result[key] = canonicalize(child);
    }
    return result;
  }
  throw new Error('Invalid canonical value');
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
}

function resultKind(value: unknown): string {
  return isRecord(value) && typeof value.kind === 'string' ? value.kind : 'internal_error';
}

function resultCredential(value: unknown): ApiCredentialProjection | null {
  if (!isRecord(value) || !isRecord(value.credential)) return null;
  return value.credential as unknown as ApiCredentialProjection;
}

function mapMutationResult(value: unknown): Record<string, unknown> {
  const kind = resultKind(value);
  if (kind !== 'created' && kind !== 'ok') return { kind };
  const credential = resultCredential(value);
  if (credential === null || !isRecord(value) || typeof value.replayed !== 'boolean') {
    return { kind: 'internal_error' };
  }
  return { kind, credential, replayed: value.replayed };
}

export function createDashboardApiCredentialManagementService(options: {
  ordinarySessionVerifier: DashboardSessionVerifier;
  privilegedSessionVerifier: PrivilegedDashboardSessionVerifier;
  contextStore: DashboardMerchantContextStore;
  store: DashboardApiCredentialStore;
  materialFactory?: (environment: ApiCredentialEnvironment) => Promise<ApiCredentialMaterial>;
  idFactory?: () => string;
}): DashboardApiCredentialManagementService {
  const materialFactory = options.materialFactory ?? ((environment) => generateApiCredentialMaterial(environment));
  const idFactory = options.idFactory ?? randomUUID;

  async function authorizeRead(authorization: string | undefined, merchantIdInput: string, environmentInput: string) {
    const merchantId = normalizeUuid(merchantIdInput);
    const environment = normalizeEnvironment(environmentInput);
    if (merchantId === null || environment === null) return { kind: 'validation_error' } as const;
    const session = await options.ordinarySessionVerifier(authorization);
    if (session.kind !== 'authenticated') return session;
    const context = await options.contextStore.requireContext({
      userId: session.principal.userId, merchantId, environment, requiredRole: 'member',
    });
    if (context.kind !== 'authorized') return context;
    return { kind: 'authorized' as const, userId: session.principal.userId, merchantId, environment };
  }

  async function authorizeMutation(authorization: string | undefined, merchantIdInput: string, environmentInput: string) {
    const merchantId = normalizeUuid(merchantIdInput);
    const environment = normalizeEnvironment(environmentInput);
    if (merchantId === null || environment === null) return { kind: 'validation_error' } as const;
    const session = await options.privilegedSessionVerifier(authorization);
    if (session.kind !== 'authenticated') return session;
    const requiredRole: ApiCredentialRole = environment === 'production' ? 'owner' : 'admin';
    const context = await options.contextStore.requireContext({
      userId: session.principal.userId, merchantId, environment, requiredRole,
    });
    if (context.kind !== 'authorized') return context;
    return { kind: 'authorized' as const, userId: session.principal.userId, merchantId, environment };
  }

  return {
    async list(input) {
      const authority = await authorizeRead(input.authorization, input.merchantId, input.environment);
      if (authority.kind !== 'authorized') return { kind: authority.kind };
      try {
        const credentials = await options.store.list(authority);
        return { kind: 'ok', credentials };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async get(input) {
      const authority = await authorizeRead(input.authorization, input.merchantId, input.environment);
      if (authority.kind !== 'authorized') return { kind: authority.kind };
      const credentialId = normalizeUuid(input.credentialId);
      if (credentialId === null) return { kind: 'validation_error' };
      try {
        const credential = await options.store.get({ ...authority, credentialId });
        return credential === null ? { kind: 'resource_not_found' } : { kind: 'ok', credential };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async create(input) {
      const authority = await authorizeMutation(input.authorization, input.merchantId, input.environment);
      if (authority.kind !== 'authorized') return { kind: authority.kind };
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      if (idempotencyKey === null || !isRecord(input.request)
          || !exactKeys(input.request, ['name', 'ipAllowlist'], ['name'])) return { kind: 'validation_error' };
      const name = normalizeName(input.request.name);
      const ipAllowlist = normalizeIpAllowlist(input.request.ipAllowlist);
      if (name === null || ipAllowlist === undefined) return { kind: 'validation_error' };

      try {
        const material = await materialFactory(authority.environment);
        const credentialId = normalizeUuid(idFactory());
        if (credentialId === null) return { kind: 'internal_error' };
        const hash = requestHash({
          operation: 'dashboard_api_credential_create_v0',
          merchantId: authority.merchantId,
          environment: authority.environment,
          name,
          ipAllowlist,
        });
        const raw = await options.store.create({
          ...authority,
          idempotencyKey,
          requestHash: hash,
          command: {
            credentialId,
            name,
            publicKey: material.publicKey,
            secretVerifier: material.secretVerifier,
            ipAllowlist,
          },
        });
        const result = mapMutationResult(raw);
        if (result.kind !== 'created') return result;
        const replayed = result.replayed === true;
        return {
          ...result,
          secretKey: replayed ? null : material.secretKey,
          secretAvailable: !replayed,
        };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async rotateSecret(input) {
      const authority = await authorizeMutation(input.authorization, input.merchantId, input.environment);
      if (authority.kind !== 'authorized') return { kind: authority.kind };
      const credentialId = normalizeUuid(input.credentialId);
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      if (credentialId === null || idempotencyKey === null || !isRecord(input.request)
          || !exactKeys(input.request, ['expectedRevision'], ['expectedRevision'])) return { kind: 'validation_error' };
      const expectedRevision = normalizeExpectedRevision(input.request.expectedRevision);
      if (expectedRevision === null) return { kind: 'validation_error' };

      try {
        const material = await materialFactory(authority.environment);
        const hash = requestHash({
          operation: 'dashboard_api_credential_rotate_secret_v0',
          merchantId: authority.merchantId,
          environment: authority.environment,
          credentialId,
          expectedRevision,
        });
        const raw = await options.store.rotateSecret({
          ...authority, credentialId, idempotencyKey, requestHash: hash,
          command: { expectedRevision, secretVerifier: material.secretVerifier },
        });
        const result = mapMutationResult(raw);
        if (result.kind !== 'ok') return result;
        const replayed = result.replayed === true;
        return {
          ...result,
          secretKey: replayed ? null : material.secretKey,
          secretAvailable: !replayed,
        };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async revoke(input) {
      const authority = await authorizeMutation(input.authorization, input.merchantId, input.environment);
      if (authority.kind !== 'authorized') return { kind: authority.kind };
      const credentialId = normalizeUuid(input.credentialId);
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      if (credentialId === null || idempotencyKey === null || !isRecord(input.request)
          || !exactKeys(input.request, ['expectedRevision'], ['expectedRevision'])) return { kind: 'validation_error' };
      const expectedRevision = normalizeExpectedRevision(input.request.expectedRevision);
      if (expectedRevision === null) return { kind: 'validation_error' };

      try {
        const hash = requestHash({
          operation: 'dashboard_api_credential_revoke_v0',
          merchantId: authority.merchantId,
          environment: authority.environment,
          credentialId,
          expectedRevision,
        });
        const raw = await options.store.revoke({
          ...authority, credentialId, idempotencyKey, requestHash: hash,
          command: { expectedRevision },
        });
        return mapMutationResult(raw);
      } catch {
        return { kind: 'internal_error' };
      }
    },
  };
}
