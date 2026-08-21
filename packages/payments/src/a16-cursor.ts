import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  DashboardTransactionCursorCodec,
  DashboardTransactionEnvironment,
  DashboardTransactionFilters,
  DashboardTransactionViolation,
} from './a9.js';

export interface DashboardTransactionCursorHmacKey {
  readonly id: string;
  readonly secret: string;
}

export interface DashboardTransactionCursorCodecOptions {
  readonly activeKeyId: string;
  readonly keys: readonly DashboardTransactionCursorHmacKey[];
  readonly legacyV0Key?: string;
}

type CursorEncodeInput = Parameters<DashboardTransactionCursorCodec['encode']>[0];
type CursorDecodeInput = Parameters<DashboardTransactionCursorCodec['decode']>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const MIN_KEY_BYTES = 32;
const MAX_KEYS = 4;

function cursorViolation(): { readonly ok: false; readonly violation: DashboardTransactionViolation } {
  return {
    ok: false,
    violation: {
      field: 'cursor',
      code: 'invalid_cursor',
      message: 'Invalid transaction cursor.',
    },
  };
}

function validateRouteScope(merchantId: string, environment: string): environment is DashboardTransactionEnvironment {
  return UUID_RE.test(merchantId) && (environment === 'sandbox' || environment === 'production');
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function filterDigest(filters: DashboardTransactionFilters): string {
  return createHash('sha256')
    .update(`a9-filter-v0\n${JSON.stringify([
      filters.status,
      filters.externalId,
      filters.createdFrom,
      filters.createdTo,
    ])}`, 'utf8')
    .digest('hex');
}

function canonicalBase64Url(value: string): Buffer | null {
  if (!BASE64URL_RE.test(value) || value.includes('=')) return null;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length > 0 && decoded.toString('base64url') === value ? decoded : null;
  } catch {
    return null;
  }
}

function parseCursorPayload(
  payloadBytes: Buffer,
  input: {
    readonly merchantId: string;
    readonly environment: DashboardTransactionEnvironment;
    readonly filters: DashboardTransactionFilters;
  },
):
  | { readonly ok: true; readonly cursor: { readonly createdAt: string; readonly paymentId: string } }
  | { readonly ok: false; readonly violation: DashboardTransactionViolation } {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return cursorViolation();
  }
  if (!Array.isArray(payload) || payload.length !== 5) return cursorViolation();
  const [merchantId, environment, digest, createdAt, paymentId] = payload;
  if (
    typeof merchantId !== 'string'
    || !UUID_RE.test(merchantId)
    || (environment !== 'sandbox' && environment !== 'production')
    || typeof digest !== 'string'
    || !HEX64_RE.test(digest)
    || !isCanonicalTimestamp(createdAt)
    || typeof paymentId !== 'string'
    || !UUID_RE.test(paymentId)
    || merchantId !== input.merchantId
    || environment !== input.environment
    || digest !== filterDigest(input.filters)
  ) {
    return cursorViolation();
  }
  return { ok: true, cursor: { createdAt, paymentId } };
}

function snapshotAuthority(options: DashboardTransactionCursorCodecOptions): {
  readonly activeKeyId: string;
  readonly activeKey: Buffer;
  readonly keys: ReadonlyMap<string, Buffer>;
  readonly legacyV0Key?: Buffer;
} {
  if (
    typeof options !== 'object'
    || options === null
    || !KEY_ID_RE.test(options.activeKeyId)
    || !Array.isArray(options.keys)
    || options.keys.length < 1
    || options.keys.length > MAX_KEYS
  ) {
    throw new Error('Invalid dashboard transaction cursor HMAC authority.');
  }

  const ids = new Set<string>();
  const secrets = new Set<string>();
  const entries: Array<readonly [string, Buffer]> = [];
  for (const entry of options.keys) {
    if (
      typeof entry !== 'object'
      || entry === null
      || Array.isArray(entry)
      || Object.keys(entry).length !== 2
      || !Object.prototype.hasOwnProperty.call(entry, 'id')
      || !Object.prototype.hasOwnProperty.call(entry, 'secret')
      || typeof entry.id !== 'string'
      || !KEY_ID_RE.test(entry.id)
      || ids.has(entry.id)
      || typeof entry.secret !== 'string'
      || Buffer.byteLength(entry.secret, 'utf8') < MIN_KEY_BYTES
      || secrets.has(entry.secret)
    ) {
      throw new Error('Invalid dashboard transaction cursor HMAC authority.');
    }
    ids.add(entry.id);
    secrets.add(entry.secret);
    entries.push([entry.id, Buffer.from(entry.secret, 'utf8')] as const);
  }

  const keyMap = new Map(entries);
  const activeKey = keyMap.get(options.activeKeyId);
  if (activeKey === undefined) {
    throw new Error('Invalid dashboard transaction cursor HMAC authority.');
  }

  let legacyV0Key: Buffer | undefined;
  if (options.legacyV0Key !== undefined) {
    if (
      typeof options.legacyV0Key !== 'string'
      || Buffer.byteLength(options.legacyV0Key, 'utf8') < MIN_KEY_BYTES
    ) {
      throw new Error('Invalid dashboard transaction cursor HMAC authority.');
    }
    legacyV0Key = Buffer.from(options.legacyV0Key, 'utf8');
  }

  return {
    activeKeyId: options.activeKeyId,
    activeKey: Buffer.from(activeKey),
    keys: keyMap,
    ...(legacyV0Key === undefined ? {} : { legacyV0Key }),
  };
}

export function createDashboardTransactionCursorCodec(
  options: DashboardTransactionCursorCodecOptions,
): DashboardTransactionCursorCodec {
  const authority = snapshotAuthority(options);

  return Object.freeze({
    encode(input: CursorEncodeInput) {
      if (
        !validateRouteScope(input.merchantId, input.environment)
        || !isCanonicalTimestamp(input.createdAt)
        || !UUID_RE.test(input.paymentId)
      ) {
        throw new Error('Invalid dashboard transaction cursor input.');
      }
      const digest = filterDigest(input.filters);
      const payload = Buffer.from(JSON.stringify([
        input.merchantId,
        input.environment,
        digest,
        input.createdAt,
        input.paymentId,
      ]), 'utf8').toString('base64url');
      const signed = `a9v1.${authority.activeKeyId}.${payload}`;
      const signature = createHmac('sha256', authority.activeKey).update(signed, 'ascii').digest('base64url');
      return `${signed}.${signature}`;
    },

    decode(input: CursorDecodeInput) {
      if (typeof input.token !== 'string' || !validateRouteScope(input.merchantId, input.environment)) {
        return cursorViolation();
      }

      const parts = input.token.split('.');
      if (parts[0] === 'a9v1') {
        if (parts.length !== 4) return cursorViolation();
        const kid = parts[1] ?? '';
        if (!KEY_ID_RE.test(kid)) return cursorViolation();
        const key = authority.keys.get(kid);
        if (key === undefined) return cursorViolation();
        const payloadBytes = canonicalBase64Url(parts[2] ?? '');
        const signatureBytes = canonicalBase64Url(parts[3] ?? '');
        if (payloadBytes === null || signatureBytes === null || signatureBytes.length !== 32) return cursorViolation();
        const expected = createHmac('sha256', key)
          .update(`a9v1.${kid}.${parts[2]}`, 'ascii')
          .digest();
        if (!timingSafeEqual(expected, signatureBytes)) return cursorViolation();
        return parseCursorPayload(payloadBytes, input);
      }

      if (parts[0] === 'a9v0') {
        if (parts.length !== 3 || authority.legacyV0Key === undefined) return cursorViolation();
        const payloadBytes = canonicalBase64Url(parts[1] ?? '');
        const signatureBytes = canonicalBase64Url(parts[2] ?? '');
        if (payloadBytes === null || signatureBytes === null || signatureBytes.length !== 32) return cursorViolation();
        const expected = createHmac('sha256', authority.legacyV0Key)
          .update(`a9v0.${parts[1]}`, 'ascii')
          .digest();
        if (!timingSafeEqual(expected, signatureBytes)) return cursorViolation();
        return parseCursorPayload(payloadBytes, input);
      }

      return cursorViolation();
    },
  });
}
