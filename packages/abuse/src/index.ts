import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export type AbusePolicy =
  | 'token_exchange_pre_auth'
  | 'machine_request_pre_auth'
  | 'machine_read'
  | 'machine_mutation'
  | 'dashboard_request_pre_auth'
  | 'readiness_probe';

export type NetworkAbusePolicy =
  | 'token_exchange_pre_auth'
  | 'machine_request_pre_auth'
  | 'dashboard_request_pre_auth'
  | 'readiness_probe';

export type MachineAbusePolicy = 'machine_read' | 'machine_mutation';

export interface AbuseQuotaDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface AbuseQuotaStore {
  consume(input: {
    readonly policy: AbusePolicy;
    readonly subjectHash: string;
  }): Promise<AbuseQuotaDecision>;
}

export type AdmissionResult =
  | { readonly kind: 'allowed'; readonly remaining: number }
  | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'unavailable' };

export interface ApiAbuseControls {
  resolveClientIp(input: {
    readonly remoteAddress: unknown;
    readonly xForwardedFor: unknown;
  }): string | null;

  admitNetwork(input: {
    readonly policy: NetworkAbusePolicy;
    readonly clientIp: string;
  }): Promise<AdmissionResult>;

  admitMachine(input: {
    readonly policy: MachineAbusePolicy;
    readonly merchantId: string;
    readonly environment: 'sandbox' | 'production';
  }): Promise<AdmissionResult>;
}

const POLICY_LIMITS: Readonly<Record<AbusePolicy, number>> = Object.freeze({
  token_exchange_pre_auth: 30,
  machine_request_pre_auth: 12_000,
  machine_read: 6_000,
  machine_mutation: 3_000,
  dashboard_request_pre_auth: 300,
  readiness_probe: 120,
});

const NETWORK_POLICIES = new Set<NetworkAbusePolicy>([
  'token_exchange_pre_auth',
  'machine_request_pre_auth',
  'dashboard_request_pre_auth',
  'readiness_probe',
]);
const MACHINE_POLICIES = new Set<MachineAbusePolicy>(['machine_read', 'machine_mutation']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCanonicalIp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return null;
  const version = isIP(value);
  if (version === 4) return value;
  if (version !== 6) return null;
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null;
    return hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

function isValidAllowedDecision(decision: AbuseQuotaDecision, limit: number): boolean {
  return decision.allowed === true
    && Number.isSafeInteger(decision.remaining)
    && decision.remaining >= 0
    && decision.remaining < limit
    && decision.retryAfterSeconds === 0;
}

function isValidDeniedDecision(decision: AbuseQuotaDecision): boolean {
  return decision.allowed === false
    && decision.remaining === 0
    && Number.isSafeInteger(decision.retryAfterSeconds)
    && decision.retryAfterSeconds >= 1
    && decision.retryAfterSeconds <= 60;
}

function deriveSubjectHash(hmacKey: string, subjectClass: string, canonicalSubject: string): string {
  return createHmac('sha256', hmacKey)
    .update(`a14v0\n${subjectClass}\n${canonicalSubject}`, 'utf8')
    .digest('hex');
}

export function createApiAbuseControls(
  store: AbuseQuotaStore,
  options: {
    readonly trustedProxyIps: readonly string[];
    readonly hmacKey: string;
  },
): ApiAbuseControls {
  if (Buffer.byteLength(options.hmacKey, 'utf8') < 32) {
    throw new Error('Invalid abuse-control configuration.');
  }

  const trustedProxyIps = new Set<string>();
  for (const candidate of options.trustedProxyIps) {
    const canonical = normalizeCanonicalIp(candidate);
    if (canonical === null || trustedProxyIps.has(canonical)) {
      throw new Error('Invalid abuse-control configuration.');
    }
    trustedProxyIps.add(canonical);
  }
  if (trustedProxyIps.size > 16) throw new Error('Invalid abuse-control configuration.');

  async function consume(policy: AbusePolicy, subjectHash: string): Promise<AdmissionResult> {
    try {
      const decision = await store.consume({ policy, subjectHash });
      const limit = POLICY_LIMITS[policy];
      if (isValidAllowedDecision(decision, limit)) {
        return { kind: 'allowed', remaining: decision.remaining };
      }
      if (isValidDeniedDecision(decision)) {
        return { kind: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
      }
      return { kind: 'unavailable' };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  return Object.freeze({
    resolveClientIp(input: { readonly remoteAddress: unknown; readonly xForwardedFor: unknown }): string | null {
      const directPeer = normalizeCanonicalIp(input.remoteAddress);
      if (directPeer === null) return null;
      if (!trustedProxyIps.has(directPeer)) return directPeer;
      if (typeof input.xForwardedFor !== 'string' || input.xForwardedFor.includes(',')) return null;
      return normalizeCanonicalIp(input.xForwardedFor);
    },

    async admitNetwork(input: { readonly policy: NetworkAbusePolicy; readonly clientIp: string }): Promise<AdmissionResult> {
      if (!NETWORK_POLICIES.has(input.policy)) return { kind: 'unavailable' };
      const clientIp = normalizeCanonicalIp(input.clientIp);
      if (clientIp === null) return { kind: 'unavailable' };
      return consume(input.policy, deriveSubjectHash(options.hmacKey, 'network', clientIp));
    },

    async admitMachine(input: {
      readonly policy: MachineAbusePolicy;
      readonly merchantId: string;
      readonly environment: 'sandbox' | 'production';
    }): Promise<AdmissionResult> {
      if (!MACHINE_POLICIES.has(input.policy)) return { kind: 'unavailable' };
      if (!UUID_RE.test(input.merchantId)) return { kind: 'unavailable' };
      if (input.environment !== 'sandbox' && input.environment !== 'production') return { kind: 'unavailable' };
      const canonicalSubject = `${input.merchantId.toLowerCase()}\n${input.environment}`;
      return consume(
        input.policy,
        deriveSubjectHash(options.hmacKey, 'machine_merchant_environment', canonicalSubject),
      );
    },
  });
}
