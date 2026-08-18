import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export type SwiftpayEnvironment = 'sandbox' | 'production';
export type WebhookErrorClass =
  | 'transient'
  | 'rate_limited'
  | 'configuration'
  | 'validation'
  | 'permanent'
  | 'internal';

export class WebhookRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message = 'Webhook runtime operation failed') {
    super(message);
    this.name = 'WebhookRuntimeError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new WebhookRuntimeError(code);
}

function validateSigningSecret(secret: string): void {
  const bytes = Buffer.byteLength(secret, 'utf8');
  if (bytes < 32 || bytes > 128) fail('signing_secret_invalid');
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function normalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_webhook_payload');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item));
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint') {
        fail('invalid_webhook_payload');
      }
      result[key] = normalizeJson(child);
    }
    return result;
  }
  return fail('invalid_webhook_payload');
}

export function serializeWebhookEvent(input: {
  id: string;
  type: string;
  occurredAt: string;
  payloadVersion: string;
  payload: unknown;
}): Buffer {
  if (input.payloadVersion !== 'payment-v1') fail('unsupported_payload_version');
  const envelope = normalizeJson({
    id: input.id,
    object: 'event',
    type: input.type,
    createdAt: input.occurredAt,
    data: input.payload,
  });
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}

function signatureBytes(input: {
  secret: string;
  timestamp: number;
  eventId: string;
  deliveryId: string;
  body: Buffer;
}): Buffer {
  validateSigningSecret(input.secret);
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp < 0 || !Buffer.isBuffer(input.body)) {
    fail('signature_input_invalid');
  }
  const prefix = Buffer.from(
    `v1\n${input.timestamp}\n${input.eventId}\n${input.deliveryId}\n`,
    'utf8',
  );
  return Buffer.concat([prefix, input.body]);
}

export function signWebhookRequest(input: {
  secret: string;
  timestamp: number;
  eventId: string;
  deliveryId: string;
  body: Buffer;
}): string {
  const digest = createHmac('sha256', Buffer.from(input.secret, 'utf8'))
    .update(signatureBytes(input))
    .digest('hex');
  return `v1=${digest}`;
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: number;
  eventId: string;
  deliveryId: string;
  body: Buffer;
  signature: string;
  nowUnixSeconds: number;
  replayWindowSeconds: number;
}): boolean {
  try {
    if (!Number.isSafeInteger(input.nowUnixSeconds)
      || !Number.isSafeInteger(input.replayWindowSeconds)
      || input.replayWindowSeconds < 0
      || Math.abs(input.nowUnixSeconds - input.timestamp) > input.replayWindowSeconds) {
      return false;
    }
    const expected = signWebhookRequest(input);
    const actualBytes = Buffer.from(input.signature, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
  } catch {
    return false;
  }
}

export type WebhookOutcome =
  | { kind: 'success' }
  | { kind: 'retry'; errorClass: 'transient' | 'rate_limited'; errorCode: string }
  | { kind: 'terminal'; errorClass: 'permanent'; errorCode: string };

export function classifyWebhookOutcome(input: {
  status?: number;
  networkError?: boolean;
  timeout?: boolean;
}): WebhookOutcome {
  if (input.timeout) return { kind: 'retry', errorClass: 'transient', errorCode: 'timeout' };
  if (input.networkError) return { kind: 'retry', errorClass: 'transient', errorCode: 'network_error' };
  const status = input.status;
  if (!Number.isInteger(status) || status === undefined || status < 100 || status > 599) {
    return { kind: 'terminal', errorClass: 'permanent', errorCode: 'invalid_http_status' };
  }
  if (status >= 200 && status <= 299) return { kind: 'success' };
  if (status >= 300 && status <= 399) {
    return { kind: 'terminal', errorClass: 'permanent', errorCode: 'redirect_disallowed' };
  }
  if (status === 408 || status === 425) {
    return { kind: 'retry', errorClass: 'transient', errorCode: `http_${status}` };
  }
  if (status === 429) return { kind: 'retry', errorClass: 'rate_limited', errorCode: 'http_429' };
  if (status >= 500) return { kind: 'retry', errorClass: 'transient', errorCode: `http_${status}` };
  return { kind: 'terminal', errorClass: 'permanent', errorCode: `http_${status}` };
}

const RETRY_BASE_SECONDS: Readonly<Record<number, number>> = {
  1: 5,
  2: 30,
  3: 120,
  4: 600,
  5: 1800,
  6: 3600,
  7: 7200,
};

export function computeWebhookRetryDelay(input: {
  deliveryId: string;
  attemptNumber: number;
  status?: number;
  retryAfter?: string;
}): number | null {
  if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1 || input.attemptNumber >= 8) return null;
  const base = RETRY_BASE_SECONDS[input.attemptNumber];
  if (base === undefined) return null;
  const digest = createHash('sha256')
    .update(`merchant-webhook-retry-v0\n${input.deliveryId}\n${input.attemptNumber}`, 'utf8')
    .digest();
  const integerSource = digest.readUInt16BE(0);
  const maxJitter = Math.min(30, Math.floor(base * 0.20));
  const policyDelay = Math.min(7200, base + (integerSource % (maxJitter + 1)));

  let retryAfterSeconds: number | null = null;
  if (input.status === 429 && input.retryAfter !== undefined && /^[1-9][0-9]*$/.test(input.retryAfter)) {
    const parsed = Number(input.retryAfter);
    if (Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 7200) retryAfterSeconds = parsed;
  }
  return Math.min(7200, Math.max(policyDelay, retryAfterSeconds ?? 0));
}

function parseIpv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value >>> 0;
}

function ipv4In(value: number, base: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function isPublicIpv4(address: string): boolean {
  const value = parseIpv4(address);
  if (value === null) return false;
  const blocked: ReadonlyArray<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, bits]) => ipv4In(value, parseIpv4(base) ?? 0, bits));
}

function expandIpv6(address: string): bigint | null {
  let value = address.toLowerCase();
  const zone = value.indexOf('%');
  if (zone >= 0) return null;
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const ipv4 = parseIpv4(value.slice(lastColon + 1));
    if (lastColon < 0 || ipv4 === null) return null;
    value = `${value.slice(0, lastColon)}:${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  let result = 0n;
  for (const group of groups) result = (result << 16n) | BigInt(Number.parseInt(group, 16));
  return result;
}

function ipv6In(value: bigint, base: bigint, bits: number): boolean {
  if (bits === 0) return true;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (base >> shift);
}

function ipv6Base(address: string): bigint {
  return expandIpv6(address) ?? 0n;
}

function isPublicIpv6(address: string): boolean {
  const value = expandIpv6(address);
  if (value === null) return false;
  const mappedBase = ipv6Base('::ffff:0:0');
  if (ipv6In(value, mappedBase, 96)) {
    const mapped = Number(value & 0xffffffffn) >>> 0;
    return isPublicIpv4(`${(mapped >>> 24) & 255}.${(mapped >>> 16) & 255}.${(mapped >>> 8) & 255}.${mapped & 255}`);
  }
  const blocked: ReadonlyArray<[string, number]> = [
    ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
    ['2001:db8::', 32], ['2001:2::', 48], ['2001:10::', 28],
  ];
  return !blocked.some(([base, bits]) => ipv6In(value, ipv6Base(base), bits));
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

export interface ValidatedWebhookEndpoint {
  readonly url: string;
  readonly hostname: string;
  readonly port: 443;
  readonly pinnedAddress: string;
}

export function validateWebhookEndpoint(input: {
  url: string;
  environment: SwiftpayEnvironment;
  resolvedAddresses: readonly string[];
}): ValidatedWebhookEndpoint {
  try {
    if (input.environment !== 'sandbox' && input.environment !== 'production') fail('endpoint_policy');
    const parsed = new URL(input.url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || !parsed.hostname) {
      fail('endpoint_policy');
    }
    if (parsed.port && parsed.port !== '443') fail('endpoint_policy');
    if (input.resolvedAddresses.length === 0 || input.resolvedAddresses.some((address) => !isPublicAddress(address))) {
      fail('endpoint_policy');
    }
    return {
      url: parsed.toString(),
      hostname: parsed.hostname,
      port: 443,
      pinnedAddress: input.resolvedAddresses[0] as string,
    };
  } catch (error) {
    if (error instanceof WebhookRuntimeError) throw error;
    return fail('endpoint_policy');
  }
}

export interface WebhookEndpointPolicy {
  resolveAndValidate(url: string, environment: SwiftpayEnvironment): Promise<ValidatedWebhookEndpoint>;
}

export function createNodeWebhookEndpointPolicy(): WebhookEndpointPolicy {
  return {
    async resolveAndValidate(url, environment) {
      let hostname: string;
      try {
        const parsed = new URL(url);
        hostname = parsed.hostname;
      } catch {
        return fail('endpoint_policy');
      }
      let addresses: string[];
      try {
        addresses = (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
      } catch {
        return fail('endpoint_policy');
      }
      return validateWebhookEndpoint({ url, environment, resolvedAddresses: addresses });
    },
  };
}

export interface WebhookTransportRequest {
  readonly method: 'POST';
  readonly url: string;
  readonly hostname: string;
  readonly pinnedAddress: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  readonly timeoutMs: 5000;
  readonly redirects: 'manual';
}

export interface WebhookTransportResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

export interface WebhookTransport {
  send(request: WebhookTransportRequest): Promise<WebhookTransportResponse>;
}

export function createNodeWebhookTransport(): WebhookTransport {
  return {
    async send(input) {
      return new Promise<WebhookTransportResponse>((resolve, reject) => {
        const parsed = new URL(input.url);
        const request = httpsRequest({
          protocol: 'https:',
          hostname: input.pinnedAddress,
          port: 443,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          servername: input.hostname,
          headers: { ...input.headers, host: input.hostname },
          timeout: input.timeoutMs,
        }, (response) => {
          response.resume();
          resolve({
            status: response.statusCode ?? 500,
            headers: response.headers,
          });
        });
        request.on('timeout', () => {
          const error = new Error('webhook transport timeout');
          error.name = 'WebhookTransportTimeout';
          request.destroy(error);
        });
        request.on('error', reject);
        request.end(input.body);
      });
    },
  };
}

export interface MerchantWebhookDeliveryClaim {
  readonly jobId: string;
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: string;
  readonly endpoint: {
    readonly id: string;
    readonly url: string;
    readonly environment: SwiftpayEnvironment;
    readonly signingSecretVersion: number;
    readonly signingSecretCiphertext: string | null;
  };
  readonly event: {
    readonly id: string;
    readonly type: string;
    readonly occurredAt: string;
    readonly payloadVersion: string;
    readonly payload: unknown;
  };
}

export interface MerchantWebhookResolution {
  readonly jobId: string;
  readonly deliveryId: string;
  readonly leaseToken: string;
  readonly outcome: 'success' | 'retry' | 'terminal';
  readonly httpStatus: number | null;
  readonly errorClass: WebhookErrorClass | null;
  readonly errorCode: string | null;
  readonly retryAfterSeconds: number | null;
}

export interface MerchantWebhookDeliveryStore {
  claim(input: { workerId: string; limit: number; leaseSeconds: number }): Promise<readonly MerchantWebhookDeliveryClaim[]>;
  resolve(input: MerchantWebhookResolution): Promise<boolean>;
}

export interface WebhookDeliveryService {
  runBatch(input: { workerId: string; limit: number; leaseSeconds: number }): Promise<{
    claimed: number;
    succeeded: number;
    retried: number;
    terminal: number;
  }>;
}
