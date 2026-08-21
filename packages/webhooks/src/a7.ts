import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  randomUUID,
} from 'node:crypto';

export type DashboardWebhookEnvironment = 'sandbox' | 'production';
export type DashboardWebhookRole = 'member' | 'admin' | 'owner';

export interface DashboardWebhookEndpointProjection {
  readonly id: string;
  readonly merchantId: string;
  readonly environment: DashboardWebhookEnvironment;
  readonly url: string;
  readonly status: 'active' | 'disabled';
  readonly subscribedEvents: readonly ['payment.paid'];
  readonly secretVersion: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type DashboardAuthResult =
  | { kind: 'authenticated'; principal: { userId: string } }
  | { kind: 'invalid_session' }
  | { kind: 'authentication_unavailable' };

type DashboardContextResult =
  | { kind: 'authorized'; context: { merchantId: string; environment: DashboardWebhookEnvironment; membershipRole: DashboardWebhookRole } }
  | { kind: 'forbidden' }
  | { kind: 'validation_error' }
  | { kind: 'internal_error' };

export interface DashboardWebhookEndpointStore {
  list(input: { userId: string; merchantId: string; environment: DashboardWebhookEnvironment }): Promise<readonly DashboardWebhookEndpointProjection[]>;
  get(input: { userId: string; merchantId: string; environment: DashboardWebhookEnvironment; endpointId: string }): Promise<DashboardWebhookEndpointProjection | null>;
  create(input: {
    userId: string;
    merchantId: string;
    environment: DashboardWebhookEnvironment;
    idempotencyKey: string;
    requestHash: string;
    command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  update(input: {
    userId: string;
    merchantId: string;
    environment: DashboardWebhookEnvironment;
    endpointId: string;
    idempotencyKey: string;
    requestHash: string;
    command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  disable(input: {
    userId: string;
    merchantId: string;
    environment: DashboardWebhookEnvironment;
    endpointId: string;
    idempotencyKey: string;
    requestHash: string;
    command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  enable(input: {
    userId: string;
    merchantId: string;
    environment: DashboardWebhookEnvironment;
    endpointId: string;
    idempotencyKey: string;
    requestHash: string;
    command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  rotateSecret(input: {
    userId: string;
    merchantId: string;
    environment: DashboardWebhookEnvironment;
    endpointId: string;
    idempotencyKey: string;
    requestHash: string;
    command: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

export class DashboardWebhookManagementError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('Dashboard webhook management operation failed');
    this.name = 'DashboardWebhookManagementError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new DashboardWebhookManagementError(code);
}

function decodeBase64Url(value: string): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.includes('=')) {
    return fail('webhook_wrapping_key_invalid');
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length === 0 || decoded.toString('base64url') !== value) {
      return fail('webhook_wrapping_key_invalid');
    }
    return decoded;
  } catch {
    return fail('webhook_wrapping_key_invalid');
  }
}

function validateKeyId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) return fail('webhook_wrapping_key_invalid');
  return value;
}

function validateEndpointId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return fail('webhook_wrapping_input_invalid');
  }
  return value;
}

function validateSecretVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return fail('webhook_wrapping_input_invalid');
  return value;
}

function oaepLabel(endpointId: string, secretVersion: number, wrappingKeyId: string): Buffer {
  return Buffer.from(
    `swiftpay-webhook-secret-wrap-v1\n${validateEndpointId(endpointId)}\n${validateSecretVersion(secretVersion)}\n${validateKeyId(wrappingKeyId)}`,
    'utf8',
  );
}

function assertRsaStrength(key: ReturnType<typeof createPublicKey> | ReturnType<typeof createPrivateKey>): void {
  if (key.asymmetricKeyType !== 'rsa') fail('webhook_wrapping_key_invalid');
  const modulusLength = key.asymmetricKeyDetails?.modulusLength;
  if (typeof modulusLength !== 'number' || modulusLength < 2048 || modulusLength > 4096) {
    fail('webhook_wrapping_key_invalid');
  }
}

export function parseWebhookWrappingPublicKey(value: string) {
  try {
    const bytes = decodeBase64Url(value);
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    assertRsaStrength(key);
    return key;
  } catch (error) {
    if (error instanceof DashboardWebhookManagementError) throw error;
    return fail('webhook_wrapping_key_invalid');
  }
}

export function parseWebhookWrappingPrivateKeyring(
  value: string | Readonly<Record<string, string>>,
): Readonly<Record<string, ReturnType<typeof createPrivateKey>>> {
  try {
    const source: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    if (source === null || typeof source !== 'object' || Array.isArray(source)) {
      return fail('webhook_wrapping_key_invalid');
    }
    const entries = Object.entries(source as Record<string, unknown>);
    if (entries.length === 0 || entries.length > 16) fail('webhook_wrapping_key_invalid');
    const result: Record<string, ReturnType<typeof createPrivateKey>> = {};
    for (const [keyId, encoded] of entries) {
      validateKeyId(keyId);
      if (typeof encoded !== 'string') fail('webhook_wrapping_key_invalid');
      const key = createPrivateKey({ key: decodeBase64Url(encoded), format: 'der', type: 'pkcs8' });
      assertRsaStrength(key);
      result[keyId] = key;
    }
    return result;
  } catch (error) {
    if (error instanceof DashboardWebhookManagementError) throw error;
    return fail('webhook_wrapping_key_invalid');
  }
}

export function generateWebhookSigningSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

function validateSigningSecret(secret: string): void {
  if (!/^whsec_[A-Za-z0-9_-]+$/.test(secret)) fail('signing_secret_invalid');
  const encoded = secret.slice('whsec_'.length);
  const decoded = Buffer.from(encoded, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== encoded) fail('signing_secret_invalid');
}

export function wrapWebhookSigningSecret(input: {
  publicKey: string;
  wrappingKeyId: string;
  endpointId: string;
  secretVersion: number;
  secret: string;
}): { format: 'rsa-oaep-sha256-v1'; wrappingKeyId: string; ciphertext: string } {
  try {
    validateSigningSecret(input.secret);
    const keyId = validateKeyId(input.wrappingKeyId);
    const key = parseWebhookWrappingPublicKey(input.publicKey);
    const encrypted = publicEncrypt({
      key,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
      oaepLabel: oaepLabel(input.endpointId, input.secretVersion, keyId),
    }, Buffer.from(input.secret, 'utf8'));
    return {
      format: 'rsa-oaep-sha256-v1',
      wrappingKeyId: keyId,
      ciphertext: `rsa-oaep-sha256-v1$${encrypted.toString('base64url')}`,
    };
  } catch (error) {
    if (error instanceof DashboardWebhookManagementError) throw error;
    return fail('signing_secret_invalid');
  }
}

export function unwrapWebhookSigningSecret(input: {
  privateKeyring: string | Readonly<Record<string, string>>;
  wrappingKeyId: string;
  endpointId: string;
  secretVersion: number;
  ciphertext: string;
}): string {
  try {
    const keyId = validateKeyId(input.wrappingKeyId);
    const keyring = parseWebhookWrappingPrivateKeyring(input.privateKeyring);
    const key = keyring[keyId];
    if (key === undefined) fail('signing_secret_unavailable');
    const parts = input.ciphertext.split('$');
    if (parts.length !== 2 || parts[0] !== 'rsa-oaep-sha256-v1') fail('signing_secret_invalid');
    const plaintext = privateDecrypt({
      key,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
      oaepLabel: oaepLabel(input.endpointId, input.secretVersion, keyId),
    }, decodeBase64Url(parts[1] ?? '')).toString('utf8');
    validateSigningSecret(plaintext);
    return plaintext;
  } catch (error) {
    if (error instanceof DashboardWebhookManagementError) throw error;
    return fail('signing_secret_invalid');
  }
}

type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue };

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return fail('validation_error');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const result: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue;
      result[key] = canonicalize(child);
    }
    return result;
  }
  return fail('validation_error');
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
}

function normalizeEnvironment(value: unknown): DashboardWebhookEnvironment | null {
  return value === 'sandbox' || value === 'production' ? value : null;
}

function normalizeUuid(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 160 ? normalized : null;
}

function normalizeExpectedRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 1 ? value as number : null;
}

function normalizeEvents(value: unknown): readonly ['payment.paid'] | null {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'payment.paid') return null;
  return ['payment.paid'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
}

function publicKind(value: unknown): string {
  return isRecord(value) && typeof value.kind === 'string' ? value.kind : 'internal_error';
}

function projectionFrom(value: unknown): DashboardWebhookEndpointProjection | null {
  if (!isRecord(value)) return null;
  const endpoint = value.endpoint;
  if (!isRecord(endpoint)) return null;
  return endpoint as unknown as DashboardWebhookEndpointProjection;
}

function mapStoreResult(value: Record<string, unknown>): Record<string, unknown> {
  const kind = publicKind(value);
  if (['resource_not_found', 'resource_conflict', 'idempotency_conflict', 'idempotency_in_progress', 'endpoint_limit_reached', 'validation_error', 'internal_error'].includes(kind)) {
    return { kind };
  }
  const endpoint = projectionFrom(value);
  if (endpoint === null) return { kind: 'internal_error' };
  return { kind, endpoint, replayed: value.replayed === true };
}

export interface DashboardWebhookEndpointManagementService {
  list(input: { authorization?: string; merchantId: string; environment: string }): Promise<Record<string, unknown>>;
  get(input: { authorization?: string; merchantId: string; environment: string; endpointId: string }): Promise<Record<string, unknown>>;
  create(input: { authorization?: string; merchantId: string; environment: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
  update(input: { authorization?: string; merchantId: string; environment: string; endpointId: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
  disable(input: { authorization?: string; merchantId: string; environment: string; endpointId: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
  enable(input: { authorization?: string; merchantId: string; environment: string; endpointId: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
  rotateSecret(input: { authorization?: string; merchantId: string; environment: string; endpointId: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
}

export function createDashboardWebhookEndpointManagementService(input: {
  sessionVerifier: (authorization?: string) => Promise<DashboardAuthResult>;
  contextStore: { requireContext(value: { userId: string; merchantId: string; environment: DashboardWebhookEnvironment; requiredRole: DashboardWebhookRole }): Promise<DashboardContextResult> };
  endpointPolicy: { resolveAndValidate(url: string, environment: DashboardWebhookEnvironment): Promise<{ url: string }> };
  store: DashboardWebhookEndpointStore;
  wrappingKeyId: string;
  wrappingPublicKey: string;
  idFactory?: () => string;
  secretGenerator?: () => string;
  secretWrapper?: typeof wrapWebhookSigningSecret;
}): DashboardWebhookEndpointManagementService {
  const idFactory = input.idFactory ?? randomUUID;
  const secretGenerator = input.secretGenerator ?? generateWebhookSigningSecret;
  const secretWrapper = input.secretWrapper ?? wrapWebhookSigningSecret;

  async function authorize(
    authorization: string | undefined,
    merchantIdInput: string,
    environmentInput: string,
    requiredRole: DashboardWebhookRole,
  ): Promise<DashboardAuthResult | DashboardContextResult | { kind: 'authorized_user'; userId: string; merchantId: string; environment: DashboardWebhookEnvironment }> {
    const merchantId = normalizeUuid(merchantIdInput);
    const environment = normalizeEnvironment(environmentInput);
    if (merchantId === null || environment === null) return { kind: 'validation_error' };
    const verified = await input.sessionVerifier(authorization);
    if (verified.kind !== 'authenticated') return verified;
    const context = await input.contextStore.requireContext({
      userId: verified.principal.userId,
      merchantId,
      environment,
      requiredRole,
    });
    if (context.kind !== 'authorized') return context;
    return { kind: 'authorized_user', userId: verified.principal.userId, merchantId, environment };
  }

  async function itemAuth(value: { authorization?: string; merchantId: string; environment: string; endpointId: string }, role: DashboardWebhookRole) {
    const auth = await authorize(value.authorization, value.merchantId, value.environment, role);
    if (auth.kind !== 'authorized_user') return { auth, endpointId: null as string | null };
    const endpointId = normalizeUuid(value.endpointId);
    if (endpointId === null) return { auth: { kind: 'validation_error' } as const, endpointId: null };
    return { auth, endpointId };
  }

  return {
    async list(value) {
      const auth = await authorize(value.authorization, value.merchantId, value.environment, 'member');
      if (auth.kind !== 'authorized_user') return auth;
      try {
        const endpoints = await input.store.list(auth);
        return { kind: 'ok', endpoints };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async get(value) {
      const { auth, endpointId } = await itemAuth(value, 'member');
      if (auth.kind !== 'authorized_user' || endpointId === null) return auth;
      try {
        const endpoint = await input.store.get({ ...auth, endpointId });
        return endpoint === null ? { kind: 'resource_not_found' } : { kind: 'ok', endpoint };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async create(value) {
      const auth = await authorize(value.authorization, value.merchantId, value.environment, 'admin');
      if (auth.kind !== 'authorized_user') return auth;
      const idempotencyKey = normalizeIdempotencyKey(value.idempotencyKey);
      if (idempotencyKey === null || !isRecord(value.request)
          || !exactKeys(value.request, ['url', 'subscribedEvents'], ['url', 'subscribedEvents'])
          || typeof value.request.url !== 'string') {
        return { kind: 'validation_error' };
      }
      const events = normalizeEvents(value.request.subscribedEvents);
      if (events === null) return { kind: 'validation_error' };
      let validated: { url: string };
      try {
        validated = await input.endpointPolicy.resolveAndValidate(value.request.url, auth.environment);
      } catch {
        return { kind: 'validation_error' };
      }
      const hash = requestHash({
        operation: 'dashboard_webhook_endpoint_create_v0',
        merchantId: auth.merchantId,
        environment: auth.environment,
        url: validated.url,
        subscribedEvents: events,
      });
      const endpointId = normalizeUuid(idFactory());
      if (endpointId === null) return { kind: 'internal_error' };
      const secret = secretGenerator();
      let wrapped: ReturnType<typeof wrapWebhookSigningSecret>;
      try {
        wrapped = secretWrapper({
          publicKey: input.wrappingPublicKey,
          wrappingKeyId: input.wrappingKeyId,
          endpointId,
          secretVersion: 1,
          secret,
        });
      } catch {
        return { kind: 'internal_error' };
      }
      try {
        const stored = await input.store.create({
          userId: auth.userId,
          merchantId: auth.merchantId,
          environment: auth.environment,
          idempotencyKey,
          requestHash: hash,
          command: {
            endpointId,
            url: validated.url,
            subscribedEvents: events,
            secretVersion: 1,
            secretCiphertext: wrapped.ciphertext,
            secretCiphertextFormat: wrapped.format,
            wrappingKeyId: wrapped.wrappingKeyId,
          },
        });
        const mapped = mapStoreResult(stored);
        if (mapped.kind !== 'created') return mapped;
        const replayed = mapped.replayed === true;
        return {
          ...mapped,
          signingSecret: replayed ? null : secret,
          secretAvailable: !replayed,
        };
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async update(value) {
      const { auth, endpointId } = await itemAuth(value, 'admin');
      if (auth.kind !== 'authorized_user' || endpointId === null) return auth;
      const idempotencyKey = normalizeIdempotencyKey(value.idempotencyKey);
      if (idempotencyKey === null || !isRecord(value.request)
          || !exactKeys(value.request, ['expectedRevision','url','subscribedEvents'], ['expectedRevision'])) {
        return { kind: 'validation_error' };
      }
      const expectedRevision = normalizeExpectedRevision(value.request.expectedRevision);
      if (expectedRevision === null || (!('url' in value.request) && !('subscribedEvents' in value.request))) {
        return { kind: 'validation_error' };
      }
      const command: Record<string, unknown> = { expectedRevision };
      let normalizedUrl: string | undefined;
      if ('url' in value.request) {
        if (typeof value.request.url !== 'string') return { kind: 'validation_error' };
        try {
          normalizedUrl = (await input.endpointPolicy.resolveAndValidate(value.request.url, auth.environment)).url;
        } catch {
          return { kind: 'validation_error' };
        }
        command.url = normalizedUrl;
      }
      let events: readonly ['payment.paid'] | undefined;
      if ('subscribedEvents' in value.request) {
        const normalized = normalizeEvents(value.request.subscribedEvents);
        if (normalized === null) return { kind: 'validation_error' };
        events = normalized;
        command.subscribedEvents = events;
      }
      const hash = requestHash({ operation: 'dashboard_webhook_endpoint_update_v0', merchantId: auth.merchantId, environment: auth.environment, endpointId, expectedRevision, url: normalizedUrl, subscribedEvents: events });
      try {
        return mapStoreResult(await input.store.update({ userId: auth.userId, merchantId: auth.merchantId, environment: auth.environment, endpointId, idempotencyKey, requestHash: hash, command }));
      } catch {
        return { kind: 'internal_error' };
      }
    },

    async disable(value) {
      const { auth, endpointId } = await itemAuth(value, 'admin');
      if (auth.kind !== 'authorized_user' || endpointId === null) return auth;
      const idempotencyKey = normalizeIdempotencyKey(value.idempotencyKey);
      if (idempotencyKey === null || !isRecord(value.request) || !exactKeys(value.request, ['expectedRevision'], ['expectedRevision'])) return { kind: 'validation_error' };
      const expectedRevision = normalizeExpectedRevision(value.request.expectedRevision);
      if (expectedRevision === null) return { kind: 'validation_error' };
      const hash = requestHash({ operation:'dashboard_webhook_endpoint_disable_v0', merchantId:auth.merchantId, environment:auth.environment, endpointId, expectedRevision });
      try {
        return mapStoreResult(await input.store.disable({ userId:auth.userId, merchantId:auth.merchantId, environment:auth.environment, endpointId, idempotencyKey, requestHash:hash, command:{ expectedRevision } }));
      } catch { return { kind:'internal_error' }; }
    },

    async enable(value) {
      const { auth, endpointId } = await itemAuth(value, 'admin');
      if (auth.kind !== 'authorized_user' || endpointId === null) return auth;
      const idempotencyKey = normalizeIdempotencyKey(value.idempotencyKey);
      if (idempotencyKey === null || !isRecord(value.request) || !exactKeys(value.request, ['expectedRevision'], ['expectedRevision'])) return { kind: 'validation_error' };
      const expectedRevision = normalizeExpectedRevision(value.request.expectedRevision);
      if (expectedRevision === null) return { kind: 'validation_error' };
      const hash = requestHash({ operation:'dashboard_webhook_endpoint_enable_v0', merchantId:auth.merchantId, environment:auth.environment, endpointId, expectedRevision });
      try {
        return mapStoreResult(await input.store.enable({ userId:auth.userId, merchantId:auth.merchantId, environment:auth.environment, endpointId, idempotencyKey, requestHash:hash, command:{ expectedRevision } }));
      } catch { return { kind:'internal_error' }; }
    },

    async rotateSecret(value) {
      const { auth, endpointId } = await itemAuth(value, 'admin');
      if (auth.kind !== 'authorized_user' || endpointId === null) return auth;
      const idempotencyKey = normalizeIdempotencyKey(value.idempotencyKey);
      if (idempotencyKey === null || !isRecord(value.request) || !exactKeys(value.request, ['expectedRevision'], ['expectedRevision'])) return { kind: 'validation_error' };
      const expectedRevision = normalizeExpectedRevision(value.request.expectedRevision);
      if (expectedRevision === null) return { kind:'validation_error' };
      let current: DashboardWebhookEndpointProjection | null;
      try { current = await input.store.get({ userId:auth.userId, merchantId:auth.merchantId, environment:auth.environment, endpointId }); }
      catch { return { kind:'internal_error' }; }
      if (current === null) return { kind:'resource_not_found' };
      if (!Number.isSafeInteger(current.secretVersion) || current.secretVersion < 1 || current.secretVersion >= 2_147_483_647) return { kind:'resource_conflict' };
      const newSecretVersion = current.secretVersion + 1;
      const hash = requestHash({ operation:'dashboard_webhook_endpoint_rotate_secret_v0', merchantId:auth.merchantId, environment:auth.environment, endpointId, expectedRevision });
      const secret = secretGenerator();
      let wrapped: ReturnType<typeof wrapWebhookSigningSecret>;
      try {
        wrapped = secretWrapper({ publicKey:input.wrappingPublicKey, wrappingKeyId:input.wrappingKeyId, endpointId, secretVersion:newSecretVersion, secret });
      } catch { return { kind:'internal_error' }; }
      try {
        const stored = mapStoreResult(await input.store.rotateSecret({
          userId:auth.userId, merchantId:auth.merchantId, environment:auth.environment,
          endpointId, idempotencyKey, requestHash:hash,
          command:{ expectedRevision, newSecretVersion, secretCiphertext:wrapped.ciphertext, secretCiphertextFormat:wrapped.format, wrappingKeyId:wrapped.wrappingKeyId },
        }));
        if (stored.kind !== 'ok') return stored;
        const replayed = stored.replayed === true;
        return { ...stored, signingSecret: replayed ? null : secret, secretAvailable: !replayed };
      } catch { return { kind:'internal_error' }; }
    },
  };
}
