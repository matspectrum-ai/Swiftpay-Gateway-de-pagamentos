export type SwiftpayEnvironment = 'sandbox' | 'production';

export const ACCESS_TOKEN_SIGNING_KEY_ENV = 'SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY';
export const MIN_ACCESS_TOKEN_SIGNING_KEY_BYTES = 32;
export const WEBHOOK_SECRET_ENCRYPTION_KEY_ENV = 'SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY';

export interface ApiConfig {
  readonly environment: SwiftpayEnvironment;
  readonly databaseUrl: string;
  readonly accessTokenSigningKey: string;
  readonly host: string;
  readonly port: number;
}

export interface WorkerConfig {
  readonly environment: SwiftpayEnvironment;
  readonly databaseUrl: string;
  readonly webhookSecretEncryptionKey: string;
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

export function loadApiConfig(source: EnvironmentSource = process.env): ApiConfig {
  return {
    environment: environment(source),
    databaseUrl: postgresUrl(source, 'SWIFTPAY_API_DATABASE_URL'),
    accessTokenSigningKey: accessTokenSigningKey(source),
    host: source.SWIFTPAY_API_HOST?.trim() || '127.0.0.1',
    port: port(source),
  };
}

export function loadWorkerConfig(source: EnvironmentSource = process.env): WorkerConfig {
  const resolvedEnvironment = environment(source);
  const databaseUrl = postgresUrl(source, 'SWIFTPAY_WORKER_DATABASE_URL');
  const encryptionKey = webhookSecretEncryptionKey(source);

  return {
    environment: resolvedEnvironment,
    databaseUrl,
    webhookSecretEncryptionKey: encryptionKey,
  };
}
