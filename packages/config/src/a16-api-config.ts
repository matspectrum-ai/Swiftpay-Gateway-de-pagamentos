import {
  ConfigurationError,
  DASHBOARD_CURSOR_HMAC_KEY_ENV as INTERNAL_PRE_A16_CURSOR_KEY_ENV,
  loadApiConfig as loadPreA16ApiConfig,
  type ApiConfig as PreA16ApiConfig,
} from './core.js';

export const DASHBOARD_CURSOR_ACTIVE_KEY_ID_ENV = 'SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID';
export const DASHBOARD_CURSOR_HMAC_KEYS_ENV = 'SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS';
export const DASHBOARD_CURSOR_LEGACY_V0_KEY_ENV = 'SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY';
export const MIN_DASHBOARD_CURSOR_HMAC_KEY_BYTES = 32;
export const MAX_DASHBOARD_CURSOR_HMAC_KEYS = 4;

export interface DashboardCursorHmacKeyConfig {
  readonly id: string;
  readonly secret: string;
}

export type ApiConfig = Omit<PreA16ApiConfig, 'dashboardCursorHmacKey'> & {
  readonly dashboardCursorActiveKeyId: string;
  readonly dashboardCursorHmacKeys: readonly DashboardCursorHmacKeyConfig[];
  readonly dashboardCursorLegacyV0Key?: string;
};

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const KEY_ID_SHAPE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const INTERNAL_PRE_A16_PLACEHOLDER = 'a16-internal-pre-a16-parser-placeholder-0123456789abcdef';

function required(source: EnvironmentSource, name: string): string {
  const value = source[name]?.trim();
  if (!value) throw new ConfigurationError(`Missing required environment variable: ${name}`);
  return value;
}

function hasExactFields(value: object, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function activeKeyId(source: EnvironmentSource): string {
  const value = required(source, DASHBOARD_CURSOR_ACTIVE_KEY_ID_ENV);
  if (!KEY_ID_SHAPE.test(value)) {
    throw new ConfigurationError(`${DASHBOARD_CURSOR_ACTIVE_KEY_ID_ENV} must be a valid dashboard cursor key identifier`);
  }
  return value;
}

function hmacKeys(source: EnvironmentSource): readonly DashboardCursorHmacKeyConfig[] {
  const raw = source[DASHBOARD_CURSOR_HMAC_KEYS_ENV];
  if (raw === undefined) {
    throw new ConfigurationError(`Missing required environment variable: ${DASHBOARD_CURSOR_HMAC_KEYS_ENV}`);
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_DASHBOARD_CURSOR_HMAC_KEYS) {
      throw new Error('invalid keyring');
    }

    const ids = new Set<string>();
    const secrets = new Set<string>();
    const keys: DashboardCursorHmacKeyConfig[] = [];
    for (const entry of parsed) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry) || !hasExactFields(entry, ['id', 'secret'])) {
        throw new Error('invalid keyring');
      }
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.id !== 'string'
        || !KEY_ID_SHAPE.test(candidate.id)
        || ids.has(candidate.id)
        || typeof candidate.secret !== 'string'
        || Buffer.byteLength(candidate.secret, 'utf8') < MIN_DASHBOARD_CURSOR_HMAC_KEY_BYTES
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
      `${DASHBOARD_CURSOR_HMAC_KEYS_ENV} must be a JSON array of 1..${MAX_DASHBOARD_CURSOR_HMAC_KEYS} unique valid dashboard cursor HMAC keys`,
    );
  }
}

function legacyV0Key(source: EnvironmentSource): string | undefined {
  const value = source[DASHBOARD_CURSOR_LEGACY_V0_KEY_ENV];
  if (value === undefined) return undefined;
  if (Buffer.byteLength(value, 'utf8') < MIN_DASHBOARD_CURSOR_HMAC_KEY_BYTES) {
    throw new ConfigurationError(
      `${DASHBOARD_CURSOR_LEGACY_V0_KEY_ENV} must contain at least ${MIN_DASHBOARD_CURSOR_HMAC_KEY_BYTES} UTF-8 bytes`,
    );
  }
  return value;
}

export function loadApiConfig(source: EnvironmentSource = process.env): ApiConfig {
  const resolvedActiveKeyId = activeKeyId(source);
  const resolvedKeys = hmacKeys(source);
  if (!resolvedKeys.some((entry) => entry.id === resolvedActiveKeyId)) {
    throw new ConfigurationError(
      `${DASHBOARD_CURSOR_ACTIVE_KEY_ID_ENV} must identify exactly one configured dashboard cursor HMAC key`,
    );
  }
  const resolvedLegacyV0Key = legacyV0Key(source);

  // The pre-A16 parser is retained internally only to avoid duplicating unrelated
  // configuration validation. Its removed cursor field receives a fixed internal
  // placeholder; caller-provided legacy single-key input is never consulted.
  const preA16 = loadPreA16ApiConfig({
    ...source,
    [INTERNAL_PRE_A16_CURSOR_KEY_ENV]: INTERNAL_PRE_A16_PLACEHOLDER,
  });
  const { dashboardCursorHmacKey: _discardedPreA16CursorKey, ...base } = preA16;

  return {
    ...base,
    dashboardCursorActiveKeyId: resolvedActiveKeyId,
    dashboardCursorHmacKeys: resolvedKeys,
    ...(resolvedLegacyV0Key === undefined ? {} : { dashboardCursorLegacyV0Key: resolvedLegacyV0Key }),
  };
}
