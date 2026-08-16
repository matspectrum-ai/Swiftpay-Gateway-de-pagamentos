export type SwiftpayEnvironment = 'sandbox' | 'production';

export const ACCESS_TOKEN_SIGNING_KEY_ENV = 'SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY';
export const MIN_ACCESS_TOKEN_SIGNING_KEY_BYTES = 32;
export const WEBHOOK_SECRET_ENCRYPTION_KEY_ENV = 'SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY';
export const WEBHOOK_SECRET_WRAP_KEY_ID_ENV = 'SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID';
export const WEBHOOK_SECRET_WRAP_PUBLIC_KEY_ENV = 'SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY';
export const WEBHOOK_SECRET_WRAP_PRIVATE_KEYS_ENV = 'SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS';
export const SUPABASE_URL_ENV = 'SWIFTPAY_SUPABASE_URL';
export const SUPABASE_PUBLISHABLE_KEY_ENV = 'SWIFTPAY_SUPABASE_PUBLISHABLE_KEY';

export interface ApiConfig {
  readonly environment: SwiftpayEnvironment;
  readonly databaseUrl: string;
  readonly accessTokenSigningKey: string;
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  readonly webhookSecretWrapKeyId: string;
  readonly webhookSecretWrapPublicKey: string;
  readonly host: string;
  readonly port: number;
}

export interface WorkerConfig {
  readonly environment: SwiftpayEnvironment;
  readonly databaseUrl: string;
  readonly webhookSecretEncryptionKey: string;
  readonly webhookSecretWrapPrivateKeys?: string;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

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

function accessTokenSigningKey(source: EnvironmentSource): string {
  const value = source[ACCESS_TOKEN_SIGNING_KEY_ENV];
  if (value === undefined) {
    throw new ConfigurationError(`Missing required environment variable: ${ACCESS_TOKEN_SIGNING_KEY_ENV}`);
  }
  if (Buffer.byteLength(value, 'utf8') < MIN_ACCESS_TOKEN_SIGNING_KEY_BYTES) {
    throw new ConfigurationError(
      `${ACCESS_TOKEN_SIGNING_KEY_ENV} must contain at least ${MIN_ACCESS_TOKEN_SIGNING_KEY_BYTES} UTF-8 bytes`,
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

function webhookSecretEncryptionKey(source: EnvironmentSource): string {
  const value = required(source, WEBHOOK_SECRET_ENCRYPTION_KEY_ENV);
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes('=')) {
    throw new ConfigurationError(`${WEBHOOK_SECRET_ENCRYPTION_KEY_ENV} must be a valid 32-byte base64url-no-padding key`);
  }

  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length !== 32 || decoded.toString('base64url') !== value) {
      throw new Error('invalid webhook encryption key');
    }
  } catch {
    throw new ConfigurationError(`${WEBHOOK_SECRET_ENCRYPTION_KEY_ENV} must be a valid 32-byte base64url-no-padding key`);
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

function optionalPrivateKeyring(source: EnvironmentSource): string | undefined {
  const raw = source[WEBHOOK_SECRET_WRAP_PRIVATE_KEYS_ENV]?.trim();
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid keyring');
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length < 1 || entries.length > 16) throw new Error('invalid keyring');
    for (const [keyId, encoded] of entries) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(keyId)
        || typeof encoded !== 'string'
        || !/^[A-Za-z0-9_-]+$/.test(encoded)
        || encoded.includes('=')) {
        throw new Error('invalid keyring');
      }
      const decoded = Buffer.from(encoded, 'base64url');
      if (decoded.length === 0 || decoded.toString('base64url') !== encoded) throw new Error('invalid keyring');
    }
    return raw;
  } catch {
    throw new ConfigurationError(`${WEBHOOK_SECRET_WRAP_PRIVATE_KEYS_ENV} must be a JSON keyId-to-base64url private-key object`);
  }
}

export function loadApiConfig(source: EnvironmentSource = process.env): ApiConfig {
  return {
    environment: environment(source),
    databaseUrl: postgresUrl(source, 'SWIFTPAY_API_DATABASE_URL'),
    accessTokenSigningKey: accessTokenSigningKey(source),
    supabaseUrl: supabaseUrl(source),
    supabasePublishableKey: supabasePublishableKey(source),
    webhookSecretWrapKeyId: webhookSecretWrapKeyId(source),
    webhookSecretWrapPublicKey: canonicalBase64Url(source, WEBHOOK_SECRET_WRAP_PUBLIC_KEY_ENV),
    host: source.SWIFTPAY_API_HOST?.trim() || '127.0.0.1',
    port: port(source),
  };
}

export function loadWorkerConfig(source: EnvironmentSource = process.env): WorkerConfig {
  const resolvedEnvironment = environment(source);
  const databaseUrl = postgresUrl(source, 'SWIFTPAY_WORKER_DATABASE_URL');
  const encryptionKey = webhookSecretEncryptionKey(source);
  const privateKeys = optionalPrivateKeyring(source);

  return {
    environment: resolvedEnvironment,
    databaseUrl,
    webhookSecretEncryptionKey: encryptionKey,
    ...(privateKeys === undefined ? {} : { webhookSecretWrapPrivateKeys: privateKeys }),
  };
}
