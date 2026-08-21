export * from './core.js';
export {
  DASHBOARD_CURSOR_ACTIVE_KEY_ID_ENV,
  DASHBOARD_CURSOR_HMAC_KEYS_ENV,
  DASHBOARD_CURSOR_LEGACY_V0_KEY_ENV,
  MIN_DASHBOARD_CURSOR_HMAC_KEY_BYTES,
  MAX_DASHBOARD_CURSOR_HMAC_KEYS,
  loadApiConfig,
} from './a16-api-config.js';
export type { ApiConfig, DashboardCursorHmacKeyConfig } from './a16-api-config.js';

/** Canonical environment-variable names for independently rotated runtime authorities. */
export type CanonicalAuthorityEnvironmentVariable =
  | 'SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID'
  | 'SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS'
  | 'SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY'
  | 'SWIFTPAY_ABUSE_HMAC_KEY'
  | 'SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY'
  | 'SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID'
  | 'SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS'
  | 'SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY';
