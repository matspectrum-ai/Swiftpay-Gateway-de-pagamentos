import { normalizeCanonicalIp } from '../../abuse/dist/index.js';
import { parseWebhookWrappingPrivateKeyring } from '../../webhooks/dist/index.js';

export type SwiftpayEnvironment = 'sandbox' | 'production';

export const ACCESS_TOKEN_ACTIVE_KEY_ID_ENV = 'SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID';
export const ACCESS_TOKEN_SIGNING_KEYS_ENV = 'SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS';
export const ACCESS_TOKEN_LEGACY_NO_KID_KEY_ENV = 'SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY';
export const MIN_ACCESS_TOKEN_SIGNING_KEY_BYTES = 32;
export const MAX_ACCESS_TOKEN_SIGNING_KEYS = 4;
export const DASHBOARD_CURSOR_HMAC_KEY_ENV = 'SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY';
export const MIN_DASHBOARD_CURSOR_HMAC_KEY_BYTES = 32;
export const WEBHOOK_SECRET_WRAP_KEY_ID_ENV = 'SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID';
export const WEBHOOK_SECRET_WRAP_PUBLIC_KEY_ENV = 'SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY';
export const WEBHOOK_SECRET_WRAP_PRIVATE_KEYS_ENV = 'SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS';
export const SUPABASE_URL_ENV = 'SWIFTPAY_SUPABASE_URL';
export const SUPABASE_PUBLISHABLE_KEY_ENV = 'SWIFTPAY_SUPABASE_PUBLISHABLE_KEY';
export const API_METRICS_PORT_ENV = 'SWIFTPAY_API_METRICS_PORT';
export const WORKER_METRICS_PORT_ENV = 'SWIFTPAY_WORKER_METRICS_PORT';
export const TRUSTED_PROXY_IPS_ENV = 'SWIFTPAY_TRUSTED_PROXY_IPS';
export const ABUSE_HMAC_KEY_ENV = 'SWIFTPAY_ABUSE_HMAC_KEY';
export const ABUSE_HMAC_PREVIOUS_KEY_ENV = 'SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY';
export const MIN_ABUSE_HMAC_KEY_BYTES = 32;

export interface AccessTokenSigningKeyConfig {
  readonly id: string;
  readonly secret: string;
}

export interface ApiConfig {
  readonly environment: SwiftpayEnvironment;
  readonly databaseUrl: string;
  readonly accessTokenActiveKeyId: string;
  readonly accessTokenSigningKeys: readonly AccessTokenSigningKeyConfig[];
  readonly accessTokenLegacyNoKidKey?: string;
  readonly dashboardCursorHmacKey: string;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly webhookSecretWrapKeyId: string;
  readonly webhookSecretWrapPublicKey: string;
  readonly trustedProxyIps: readonly string[];
  readonly abuseHmacKey: string;
  readonly abuseHmacPreviousKey?: string;
  readonly host: string;
  readonly port: number;
  readonly metricsPort?: number;
}

export interface WorkerConfig {
  readonly environment: SwiftpayEnvironment;
  readonly databaseUrl: string;
  readonly webhookSecretWrapPrivateKeys: string;
  readonly metricsPort?: number;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const ACCESS_TOKEN_KEY_ID_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function required(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();
  if (!value) {
    throw new ConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value;
}

function postgresUrl(source: EnvironmentSource, name: string): string {
  const value = required(source, name);

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new ConfigurationError(`${name} must be a valid PostgreSQL URL`);
  }
  return value;
}

function environment(source: EnvironmentSource): SwiftpayEnvironment {
  const value = required(source, 'SWIFTPAY_ENVIRONMENT');
  if (value !== 'sandbox' && value !== 'production') {
    throw new ConfigurationError('SWIFTPAY_ENVIRONMENT must be sandbox or production');
  }
  return value;
}

function port(source: EnvironmentSource): number {
  const raw = source.SWIFTPAY_API_PORT?.trim() || '3000';
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535 || String(parsed) !== raw) {
    throw new ConfigurationError('SWIFTPAY_API_PORT must be an integer between 1 and 65535');
  }
  return parsed;
}

function optionalMetricsPort(source: EnvironmentSource, name: string): number | undefined {
  const rawValue = source[name];
  if (rawValue === undefined) return undefined;
  const raw = rawValue.trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535 || String(parsed) !== raw) {
    throw new ConfigurationError(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function accessTokenActiveKeyId(source: EnvironmentSource): string {
  const value = required(source, ACCESS_TOKEN_ACTIVE_KEY_ID_ENV);
  if (!ACCESS_TOKEN_KEY_ID_SHAPE.test(value)) {
    throw new ConfigurationError(`${ACCESS_TOKEN_ACTIVE_KEY_ID_ENV} must be a valid access-token key identifier`);
  }
  return value;
}

function hasExactFields(value: object, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function accessTokenSigningKeys(source: EnvironmentSource): readonly AccessTokenSigningKeyConfig[] {
  const raw = source[ACCESS_TOKEN_SIGNING_KEYS_ENV];
  if (raw === undefined) {
    throw new ConfigurationError(`Missing required environment variable: ${ACCESS_TOKEN_SIGNING_KEYS_ENV}`);
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_ACCESS_TOKEN_SIGNING_KEYS) {
      throw new Error('invalid keyring');
    }
    const ids = new Set<string>();
    const secrets = new Set<string>();
    const keys: AccessTokenSigningKeyConfig[] = [];
    for (const entry of parsed) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || !hasExactFields(entry, ['id', 'secret'])) {
        throw new Error('invalid keyring');
      }
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.id !== 'string'
        || !ACCESS_TOKEN_KEY_ID_SHAPE.test(candidate.id)
        || ids.has(candidate.id)
        || typeof candidate.secret !== 'string'
        || Buffer.byteLength(candidate.secret, 'utf8') < MIN_ACCESS_TOKEN_SIGNING_KEY_BYTES
        || secrets.has(candidate.secret)
      ) {
        throw new Error('invalid keyring');
      }
      ids.add(candidate.id);
      secrets.add(candidate.secret);
      keys.push(Object.freeze({ id: candidate.id, secret: candidate.secret }));
    }
    return Object.freeze(keys);
  } catch {
    throw new ConfigurationError(
      `${ACCESS_TOKEN_SIGNING_KEYS_ENV} must be a JSON array of 1..${MAX_ACCESS_TOKEN_SIGNING_KEYS} unique valid access-token signing keys`,
    );
  }
}

function accessTokenLegacyNoKidKey(source: EnvironmentSource): string | undefined {
  const value = source[ACCESS_TOKEN_LEGACY_NO_KID_KEY_ENV];
  if (value === undefined) return undefined;
  if (Buffer.byteLength(value, 'utf8') < MIN_ACCESS_TOKEN_SIGNING_KEY_BYTES) {
    throw new ConfigurationError(
      `${ACCESS_TOKEN_LEGACY_NO_KID_KEY_ENV} must contain at least ${MIN_ACCESS_TOKEN_SIGNING_KEY_BYTES} UTF-8 bytes`,
    );
  }
  return value;
}

function dashboardCursorHmacKey(source: EnvironmentSource): string {
  const value = source[DASHBOARD_CURSOR_HMAC_KEY_ENV];
  if (value === undefined) {
    throw new ConfigurationError(`Missing required environment variable: ${DASHBOARD_CURSOR_HMAC_KEY_ENV}`);
  }
  if (Buffer.byteLength(value, 'utf8') < MIN_DASHBOARD_CURSOR_HMAC_KEY_BYTES) {
    throw new ConfigurationError(
      `${DASHBOARD_CURSOR_HMAC_KEY_ENV} must contain at least ${MIN_DASHBOARD_CURSOR_HMAC_KEY_BYTES} UTF-8 bytes`,
    );
  }
  return value;
}

function trustedProxyIps(source: EnvironmentSource): readonly string[] {
  const raw = source[TRUSTED_PROXY_IPS_ENV];
  if (raw === undefined) return Object.freeze([]);

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 16) throw new Error('invalid proxy list');
    const canonical: string[] = [];
    const unique = new Set<string>();
    for (const value of parsed) {
      if (typeof value !== 'string') throw new Error('invalid proxy list');
      const normalized = normalizeCanonicalIp(value);
      if (normalized === null || unique.has(normalized)) throw new Error('invalid proxy list');
      unique.add(normalized);
      canonical.push(normalized);
    }
    return Object.freeze(canonical);
  } catch {
    throw new ConfigurationError(
      `${TRUSTED_PROXY_IPS_ENV} must be a JSON array of at most 16 unique exact IP addresses`,
    );
  }
}

function abuseHmacKey(source: EnvironmentSource): string {
  const value = source[ABUSE_HMAC_KEY_ENV];
  if (value === undefined) {
    throw new ConfigurationError(`Missing required environment variable: ${ABUSE_HMAC_KEY_ENV}`);
  }
  if (Buffer.byteLength(value, 'utf8') < MIN_ABUSE_HMAC_KEY_BYTES) {
    throw new ConfigurationError(
      `${ABUSE_HMAC_KEY_ENV} must contain at least ${MIN_ABUSE_HMAC_KEY_BYTES} UTF-8 bytes`,
    );
  }
  return value;
}

function abuseHmacPreviousKey(source: EnvironmentSource, activeKey: string): string | undefined {
  const value = source[ABUSE_HMAC_PREVIOUS_KEY_ENV];
  if (value === undefined) return undefined;
  if (Buffer.byteLength(value, 'utf8') < MIN_ABUSE_HMAC_KEY_BYTES || value === activeKey) {
    throw new ConfigurationError(
      `${ABUSE_HMAC_PREVIOUS_KEY_ENV} must contain at least ${MIN_ABUSE_HMAC_KEY_BYTES} UTF-8 bytes and differ from ${ABUSE_HMAC_KEY_ENV}`,
    );
  }
  return value;
}

function supabaseUrl(source: EnvironmentSource): string {
  const value = required(source, SUPABASE_URL_ENV);
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:'
      || parsed.username !== ''
      || parsed.password !== ''
      || (parsed.pathname !== '' && parsed.pathname !== '/')
      || parsed.search !== ''
      || parsed.hash !== ''
    ) {
      throw new Error('invalid Supabase origin');
    }
    return parsed.origin;
  } catch {
    throw new ConfigurationError(`${SUPABASE_URL_ENV} must be a valid HTTPS origin`);
  }
}

function supabasePublishableKey(source: EnvironmentSource): string {
  const value = required(source, SUPABASE_PUBLISHABLE_KEY_ENV);
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) {
    throw new ConfigurationError(`${SUPABASE_PUBLISHABLE_KEY_ENV} must be a modern sb_publishable_ key`);
  }
  return value;
}

function webhookSecretWrapKeyId(source: EnvironmentSource): string {
  const value = required(source, WEBHOOK_SECRET_WRAP_KEY_ID_ENV);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    throw new ConfigurationError(`${WEBHOOK_SECRET_WRAP_KEY_ID_ENV} must be a valid wrapping key identifier`);
  }
  return value;
}

function canonicalBase64Url(source: EnvironmentSource, name: string): string {
  const value = required(source, name);
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes('=')) {
    throw new ConfigurationError(`${name} must be canonical base64url without padding`);
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length === 0 || decoded.toString('base64url') !== value) {
      throw new Error('invalid base64url');
    }
  } catch {
    throw new ConfigurationError(`${name} must be canonical base64url without padding`);
  }
  return value;
}

function requiredPrivateKeyring(source: EnvironmentSource): string {
  const raw = required(source, WEBHOOK_SECRET_WRAP_PRIVATE_KEYS_ENV);
  try {
    parseWebhookWrappingPrivateKeyring(raw);
    return raw;
  } catch {
    throw new ConfigurationError(
      `${WEBHOOK_SECRET_WRAP_PRIVATE_KEYS_ENV} must be a JSON keyId-to-base64url PKCS#8 RSA private-key object with 1..16 entries`,
    );
  }
}

export function loadApiConfig(source: EnvironmentSource = process.env): ApiConfig {
  const metricsPort = optionalMetricsPort(source, API_METRICS_PORT_ENV);
  const activeKeyId = accessTokenActiveKeyId(source);
  const signingKeys = accessTokenSigningKeys(source);
  if (!signingKeys.some((entry) => entry.id === activeKeyId)) {
    throw new ConfigurationError(`${ACCESS_TOKEN_ACTIVE_KEY_ID_ENV} must identify exactly one configured access-token signing key`);
  }
  const legacyNoKidKey = accessTokenLegacyNoKidKey(source);
  const config: ApiConfig = {
    environment: environment(source),
    databaseUrl: postgresUrl(source, 'SWIFTPAY_API_DATABASE_URL'),
    accessTokenActiveKeyId: activeKeyId,
    accessTokenSigningKeys: signingKeys,
    ...(legacyNoKidKey === undefined ? {} : { accessTokenLegacyNoKidKey: legacyNoKidKey }),
    dashboardCursorHmacKey: dashboardCursorHmacKey(source),
    supabaseUrl: supabaseUrl(source),
    supabasePublishableKey: supabasePublishableKey(source),
    webhookSecretWrapKeyId: webhookSecretWrapKeyId(source),
    webhookSecretWrapPublicKey: canonicalBase64Url(source, WEBHOOK_SECRET_WRAP_PUBLIC_KEY_ENV),
    trustedProxyIps: trustedProxyIps(source),
    abuseHmacKey: abuseHmacKey(source),
    host: source.SWIFTPAY_API_HOST?.trim() || '127.0.0.1',
    port: port(source),
    ...(metricsPort === undefined ? {} : { metricsPort }),
  };
  const previousAbuseHmacKey = abuseHmacPreviousKey(source, config.abuseHmacKey);
  return previousAbuseHmacKey === undefined
    ? config
    : { ...config, abuseHmacPreviousKey: previousAbuseHmacKey };
}

export function loadWorkerConfig(source: EnvironmentSource = process.env): WorkerConfig {
  const resolvedEnvironment = environment(source);
  const databaseUrl = postgresUrl(source, 'SWIFTPAY_WORKER_DATABASE_URL');
  const privateKeys = requiredPrivateKeyring(source);
  const metricsPort = optionalMetricsPort(source, WORKER_METRICS_PORT_ENV);

  return {
    environment: resolvedEnvironment,
    databaseUrl,
    webhookSecretWrapPrivateKeys: privateKeys,
    ...(metricsPort === undefined ? {} : { metricsPort }),
  };
}
