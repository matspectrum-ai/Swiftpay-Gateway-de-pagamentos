import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { TextDecoder } from 'node:util';

import { createProviderOperationAuthorizer } from './activation.js';

type ValidatedProviderActivationRegistry = Parameters<
  typeof createProviderOperationAuthorizer
>[0]['registry'];

type TransportPhase = 'pre_transmission' | 'transmission_unknown';
type ProviderMethod = 'GET' | 'POST';

type ProviderSubject = {
  readonly provider: string;
  readonly operation: string;
  readonly environment: string;
  readonly contractLineage: string;
};

type ProviderRequestInput = {
  readonly method: ProviderMethod;
  readonly relativePath: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyUtf8?: string;
};

export class ProviderHttpTransportError extends Error {
  readonly code: string;
  readonly phase: TransportPhase;

  constructor(code: string, phase: TransportPhase) {
    super('Provider HTTP transport failed.');
    this.name = 'ProviderHttpTransportError';
    this.code = code;
    this.phase = phase;
  }
}

function fail(code: string, phase: TransportPhase): never {
  throw new ProviderHttpTransportError(code, phase);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ABSOLUTE_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const RESERVED_HEADERS = new Set([
  'host',
  'connection',
  'proxy-connection',
  'proxy-authorization',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'forwarded',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-for',
  'content-length',
  'accept-encoding',
  'expect',
]);

const REQUEST_TIMEOUT_MS = 5000 as const;
const REQUEST_BODY_MAX_BYTES = 262144;
const RESPONSE_BODY_MAX_BYTES = 1048576;
const RESPONSE_HEADER_MAX_BYTES = 16384 as const;
const RELATIVE_PATH_MAX_BYTES = 4096;
const REQUEST_HEADER_COUNT_MAX = 64;
const REQUEST_HEADER_TOTAL_BYTES_MAX = 16384;

function containsDotTraversal(relativePath: string): boolean {
  const pathname = relativePath.split('?', 1)[0] ?? '';
  for (const segment of pathname.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    if (decoded === '.' || decoded === '..') return true;
  }
  return false;
}

interface ValidatedRequest {
  readonly method: ProviderMethod;
  readonly relativePath: string;
  readonly callerHeaders: Readonly<Record<string, string>>;
  readonly body: Buffer | undefined;
}

function validateRequest(value: unknown): ValidatedRequest {
  if (!isRecord(value)
      || !hasOnlyKeys(value, ['method', 'relativePath', 'headers', 'bodyUtf8'])
      || (value.method !== 'GET' && value.method !== 'POST')
      || typeof value.relativePath !== 'string'
      || !isRecord(value.headers)) {
    return fail('request_invalid', 'pre_transmission');
  }

  const method = value.method;
  const relativePath = value.relativePath;
  const bodyUtf8 = value.bodyUtf8;

  if (relativePath.length === 0
      || Buffer.byteLength(relativePath, 'utf8') > RELATIVE_PATH_MAX_BYTES
      || relativePath.startsWith('/')
      || relativePath.includes('\\')
      || relativePath.includes('#')
      || ABSOLUTE_SCHEME.test(relativePath)
      || containsDotTraversal(relativePath)) {
    return fail('request_invalid', 'pre_transmission');
  }

  if (bodyUtf8 !== undefined && typeof bodyUtf8 !== 'string') {
    return fail('request_invalid', 'pre_transmission');
  }
  if (method === 'GET' && bodyUtf8 !== undefined) {
    return fail('request_invalid', 'pre_transmission');
  }

  const headerEntries = Object.entries(value.headers);
  if (headerEntries.length > REQUEST_HEADER_COUNT_MAX) {
    return fail('request_invalid', 'pre_transmission');
  }
  let headerBytes = 0;
  const callerHeaders: Record<string, string> = {};
  for (const [name, rawValue] of headerEntries) {
    if (!HEADER_TOKEN.test(name)
        || typeof rawValue !== 'string'
        || rawValue.includes('\r')
        || rawValue.includes('\n')
        || RESERVED_HEADERS.has(name.toLowerCase())) {
      return fail('request_invalid', 'pre_transmission');
    }
    headerBytes += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(rawValue, 'utf8');
    if (headerBytes > REQUEST_HEADER_TOTAL_BYTES_MAX) {
      return fail('request_invalid', 'pre_transmission');
    }
    callerHeaders[name] = rawValue;
  }

  const body = bodyUtf8 === undefined ? undefined : Buffer.from(bodyUtf8, 'utf8');
  if (body !== undefined && body.length > REQUEST_BODY_MAX_BYTES) {
    return fail('request_invalid', 'pre_transmission');
  }

  return {
    method,
    relativePath,
    callerHeaders: Object.freeze(callerHeaders),
    body,
  };
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
  const blocked: ReadonlyArray<readonly [string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  return !blocked.some(([base, bits]) => ipv4In(value, parseIpv4(base) ?? 0, bits));
}

function expandIpv6(address: string): bigint | null {
  let value = address.toLowerCase();
  const zoneIndex = value.indexOf('%');
  if (zoneIndex >= 0) return null;
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
  const blocked: ReadonlyArray<readonly [string, number]> = [
    ['::', 128],
    ['::1', 128],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
    ['2001:db8::', 32],
    ['2001:2::', 48],
    ['2001:10::', 28],
  ];
  return !blocked.some(([base, bits]) => ipv6In(value, ipv6Base(base), bits));
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

export interface ProviderDnsResolver {
  resolve(hostname: string): Promise<readonly string[]>;
}

export function createNodeProviderDnsResolver(): ProviderDnsResolver {
  return Object.freeze({
    async resolve(hostname: string): Promise<readonly string[]> {
      const entries = await lookup(hostname, { all: true, order: 'verbatim' });
      return entries.map((entry) => entry.address);
    },
  });
}

export interface ProviderHttpsExecutorRequest {
  readonly method: ProviderMethod;
  readonly pinnedAddress: string;
  readonly hostname: string;
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly servername: string;
  readonly timeoutMs: 5000;
  readonly maxHeaderSize: 16384;
  readonly maxResponseBodyBytes: 1048576;
  readonly minTlsVersion: 'TLSv1.2';
  readonly rejectUnauthorized: true;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer | undefined;
}

export type ProviderHttpsExecutorResult =
  | {
      readonly kind: 'response';
      readonly statusCode: number;
      readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
      readonly body: Buffer;
    }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network_error' }
  | { readonly kind: 'response_too_large' };

export interface ProviderHttpsExecutor {
  execute(input: ProviderHttpsExecutorRequest): Promise<ProviderHttpsExecutorResult>;
}

export function createNodeProviderHttpsExecutor(): ProviderHttpsExecutor {
  return Object.freeze({
    async execute(input: ProviderHttpsExecutorRequest): Promise<ProviderHttpsExecutorResult> {
      return new Promise<ProviderHttpsExecutorResult>((resolve) => {
        let settled = false;
        const settle = (result: ProviderHttpsExecutorResult): void => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        let request;
        try {
          request = httpsRequest({
            protocol: 'https:',
            hostname: input.pinnedAddress,
            port: input.port,
            path: input.path,
            method: input.method,
            servername: input.servername,
            rejectUnauthorized: true,
            minVersion: 'TLSv1.2',
            agent: false,
            maxHeaderSize: input.maxHeaderSize,
            headers: { ...input.headers },
            timeout: input.timeoutMs,
          }, (response) => {
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            response.on('data', (chunk: Buffer | string) => {
              if (settled) return;
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              totalBytes += bytes.length;
              if (totalBytes > input.maxResponseBodyBytes) {
                response.destroy();
                settle({ kind: 'response_too_large' });
                return;
              }
              chunks.push(bytes);
            });
            response.on('end', () => {
              settle({
                kind: 'response',
                statusCode: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(chunks),
              });
            });
            response.on('aborted', () => settle({ kind: 'network_error' }));
            response.on('error', () => settle({ kind: 'network_error' }));
          });
        } catch {
          settle({ kind: 'network_error' });
          return;
        }

        request.on('timeout', () => {
          settle({ kind: 'timeout' });
          request.destroy();
        });
        request.on('error', () => settle({ kind: 'network_error' }));
        request.end(input.body);
      });
    },
  });
}

function normalizeResponseHeaders(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(value)) return result;
  for (const [rawName, rawValue] of Object.entries(value)) {
    if (rawValue === undefined) continue;
    let normalizedValue: string | null = null;
    if (typeof rawValue === 'string') normalizedValue = rawValue;
    else if (Array.isArray(rawValue) && rawValue.every((entry) => typeof entry === 'string')) {
      normalizedValue = rawValue.join(', ');
    }
    if (normalizedValue === null) continue;
    const name = rawName.toLowerCase();
    result[name] = result[name] === undefined ? normalizedValue : `${result[name]}, ${normalizedValue}`;
  }
  return result;
}

function decodeResponseBody(body: unknown): string {
  if (!Buffer.isBuffer(body)) return fail('response_invalid_utf8', 'transmission_unknown');
  if (body.length > RESPONSE_BODY_MAX_BYTES) return fail('response_too_large', 'transmission_unknown');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return fail('response_invalid_utf8', 'transmission_unknown');
  }
}

function buildTarget(baseUrl: string, relativePath: string): URL {
  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(relativePath, base);
  } catch {
    return fail('request_invalid', 'pre_transmission');
  }
  if (target.origin !== base.origin
      || target.hash.length !== 0
      || !target.pathname.startsWith(base.pathname)) {
    return fail('request_invalid', 'pre_transmission');
  }
  return target;
}

export function createStrictProviderHttpTransport(options: {
  readonly registry: ValidatedProviderActivationRegistry;
  readonly resolver?: ProviderDnsResolver;
  readonly executor?: ProviderHttpsExecutor;
}) {
  let authorizer: ReturnType<typeof createProviderOperationAuthorizer>;
  try {
    authorizer = createProviderOperationAuthorizer({ registry: options?.registry });
  } catch {
    return fail('activation_registry_invalid', 'pre_transmission');
  }

  const resolver = options.resolver ?? createNodeProviderDnsResolver();
  const executor = options.executor ?? createNodeProviderHttpsExecutor();

  return Object.freeze({
    async send(input: unknown): Promise<{
      readonly statusCode: number;
      readonly headers: Record<string, string>;
      readonly bodyUtf8: string;
    }> {
      if (!isRecord(input) || !hasOnlyKeys(input, ['subject', 'request'])) {
        return fail('request_invalid', 'pre_transmission');
      }
      const request = validateRequest(input.request);

      const decision = authorizer.authorize(input.subject);
      if (decision.kind !== 'authorized') {
        return fail('activation_denied', 'pre_transmission');
      }

      const target = buildTarget(decision.grant.approvedBaseUrl, request.relativePath);
      const hostname = target.hostname;
      const host = target.host;
      const port = target.port.length > 0 ? Number(target.port) : 443;
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        return fail('request_invalid', 'pre_transmission');
      }

      let addresses: readonly string[];
      try {
        addresses = await resolver.resolve(hostname);
      } catch {
        return fail('dns_unavailable', 'pre_transmission');
      }
      if (!Array.isArray(addresses)
          || addresses.length === 0
          || addresses.some((address) => typeof address !== 'string' || !isPublicAddress(address))) {
        return fail('destination_policy', 'pre_transmission');
      }
      const pinnedAddress = addresses[0];
      if (pinnedAddress === undefined) return fail('destination_policy', 'pre_transmission');

      const headers: Record<string, string> = {
        ...request.callerHeaders,
        host,
        'accept-encoding': 'identity',
      };
      if (request.body !== undefined) headers['content-length'] = String(request.body.length);
      else if (request.method === 'POST') headers['content-length'] = '0';

      let raw: ProviderHttpsExecutorResult;
      try {
        raw = await executor.execute({
          method: request.method,
          pinnedAddress,
          hostname,
          host,
          port,
          path: `${target.pathname}${target.search}`,
          servername: hostname,
          timeoutMs: REQUEST_TIMEOUT_MS,
          maxHeaderSize: RESPONSE_HEADER_MAX_BYTES,
          maxResponseBodyBytes: RESPONSE_BODY_MAX_BYTES,
          minTlsVersion: 'TLSv1.2',
          rejectUnauthorized: true,
          headers,
          body: request.body,
        });
      } catch {
        return fail('network_error', 'transmission_unknown');
      }

      if (raw.kind === 'timeout') return fail('timeout', 'transmission_unknown');
      if (raw.kind === 'network_error') return fail('network_error', 'transmission_unknown');
      if (raw.kind === 'response_too_large') return fail('response_too_large', 'transmission_unknown');
      if (!Number.isInteger(raw.statusCode) || raw.statusCode < 100 || raw.statusCode > 599) {
        return fail('response_invalid_status', 'transmission_unknown');
      }

      return {
        statusCode: raw.statusCode,
        headers: normalizeResponseHeaders(raw.headers),
        bodyUtf8: decodeResponseBody(raw.body),
      };
    },
  });
}
