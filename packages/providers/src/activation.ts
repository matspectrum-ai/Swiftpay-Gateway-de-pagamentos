export const PROVIDER_ACTIVATION_SCHEMA_VERSION = 'a10-provider-activation-v0' as const;

type Provider = 'akkadpag' | 'flevopay';
type Environment = 'sandbox' | 'production';
type Operation =
  | 'pix_in_create'
  | 'pix_in_query'
  | 'pix_in_recover'
  | 'pix_out_create'
  | 'pix_out_query'
  | 'pix_out_recover'
  | 'webhook_verify';
type ActivationState =
  | 'unsupported'
  | 'fixture_only'
  | 'current_contract_proven'
  | 'sandbox_proven'
  | 'production_enabled';

export interface ProviderActivationRecord {
  readonly provider: Provider;
  readonly operation: Operation;
  readonly environment: Environment;
  readonly contractLineage: string;
  readonly state: ActivationState;
  readonly approvedBaseUrl: string | null;
  readonly evidenceBundleSha256: string | null;
  readonly reviewedAt: string | null;
}

export interface ProviderActivationRegistryInput {
  readonly schemaVersion: typeof PROVIDER_ACTIVATION_SCHEMA_VERSION;
  readonly registryVersion: string;
  readonly records: readonly ProviderActivationRecord[];
}

interface ValidatedProviderActivationRegistry extends ProviderActivationRegistryInput {
  readonly records: readonly Readonly<ProviderActivationRecord>[];
}

export interface ProviderOperationGrant {
  readonly provider: Provider;
  readonly operation: Operation;
  readonly environment: Environment;
  readonly contractLineage: string;
  readonly activationState: ActivationState;
  readonly approvedBaseUrl: string;
  readonly evidenceBundleSha256: string;
  readonly reviewedAt: string;
  readonly registryVersion: string;
}

export type ProviderAuthorizationDecision =
  | { readonly kind: 'authorized'; readonly grant: Readonly<ProviderOperationGrant> }
  | {
      readonly kind: 'denied';
      readonly reason: 'subject_not_registered' | 'lineage_mismatch' | 'activation_state_denied';
    };

const PROVIDERS = new Set<Provider>(['akkadpag', 'flevopay']);
const ENVIRONMENTS = new Set<Environment>(['sandbox', 'production']);
const OPERATIONS = new Set<Operation>([
  'pix_in_create',
  'pix_in_query',
  'pix_in_recover',
  'pix_out_create',
  'pix_out_query',
  'pix_out_recover',
  'webhook_verify',
]);
const STATES = new Set<ActivationState>([
  'unsupported',
  'fixture_only',
  'current_contract_proven',
  'sandbox_proven',
  'production_enabled',
]);
const INACTIVE_STATES = new Set<ActivationState>(['unsupported', 'fixture_only']);
const REGISTRY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EVIDENCE_SHA256 = /^[0-9a-f]{64}$/;
const REVIEWED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const EXACT_REGISTRY_KEYS = ['schemaVersion', 'registryVersion', 'records'] as const;
const EXACT_RECORD_KEYS = [
  'provider',
  'operation',
  'environment',
  'contractLineage',
  'state',
  'approvedBaseUrl',
  'evidenceBundleSha256',
  'reviewedAt',
] as const;
const VALIDATED_REGISTRY = Symbol('swiftpay.a10.validated-provider-activation-registry');

type UnknownRecord = Record<string, unknown>;
type BrandedRegistry = ValidatedProviderActivationRegistry & {
  readonly [VALIDATED_REGISTRY]: true;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== expected.length) return false;
  const expectedSet = new Set(expected);
  return actual.every((key) => expectedSet.has(key));
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && PROVIDERS.has(value as Provider);
}

function isEnvironment(value: unknown): value is Environment {
  return typeof value === 'string' && ENVIRONMENTS.has(value as Environment);
}

function isOperation(value: unknown): value is Operation {
  return typeof value === 'string' && OPERATIONS.has(value as Operation);
}

function isActivationState(value: unknown): value is ActivationState {
  return typeof value === 'string' && STATES.has(value as ActivationState);
}

function isContractLineage(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && value.trim().length > 0;
}

function isCanonicalReviewedAt(value: unknown): value is string {
  if (typeof value !== 'string' || !REVIEWED_AT.test(value)) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function isIpLiteralHostname(hostname: string): boolean {
  if (hostname.startsWith('[') || hostname.endsWith(']') || hostname.includes(':')) return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const octets = hostname.split('.');
  return octets.length === 4 && octets.every((octet) => {
    const numeric = Number(octet);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
  });
}

function isApprovedBaseUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  return url.protocol === 'https:'
    && url.hostname.length > 0
    && url.username.length === 0
    && url.password.length === 0
    && url.search.length === 0
    && url.hash.length === 0
    && url.pathname.endsWith('/')
    && hostname !== 'localhost'
    && !hostname.endsWith('.localhost')
    && !isIpLiteralHostname(hostname);
}

function cloneAndValidateRecord(value: unknown): Readonly<ProviderActivationRecord> | null {
  if (!isRecord(value) || !hasExactKeys(value, EXACT_RECORD_KEYS)) return null;
  const provider = value.provider;
  const operation = value.operation;
  const environment = value.environment;
  const contractLineage = value.contractLineage;
  const state = value.state;
  const approvedBaseUrl = value.approvedBaseUrl;
  const evidenceBundleSha256 = value.evidenceBundleSha256;
  const reviewedAt = value.reviewedAt;

  if (!isProvider(provider)
      || !isOperation(operation)
      || !isEnvironment(environment)
      || !isContractLineage(contractLineage)
      || !isActivationState(state)) {
    return null;
  }

  if (INACTIVE_STATES.has(state)) {
    if (approvedBaseUrl !== null || evidenceBundleSha256 !== null || reviewedAt !== null) return null;
  } else {
    if (!isApprovedBaseUrl(approvedBaseUrl)
        || typeof evidenceBundleSha256 !== 'string'
        || !EVIDENCE_SHA256.test(evidenceBundleSha256)
        || !isCanonicalReviewedAt(reviewedAt)) {
      return null;
    }
  }

  return Object.freeze({
    provider,
    operation,
    environment,
    contractLineage,
    state,
    approvedBaseUrl: approvedBaseUrl as string | null,
    evidenceBundleSha256: evidenceBundleSha256 as string | null,
    reviewedAt: reviewedAt as string | null,
  });
}

function recordIdentity(record: Pick<ProviderActivationRecord, 'provider' | 'operation' | 'environment'>): string {
  return `${record.provider}\u0000${record.operation}\u0000${record.environment}`;
}

function brandRegistry(
  registryVersion: string,
  records: readonly Readonly<ProviderActivationRecord>[],
): BrandedRegistry {
  const registry = {
    schemaVersion: PROVIDER_ACTIVATION_SCHEMA_VERSION,
    registryVersion,
    records: Object.freeze([...records]),
  } as BrandedRegistry;
  Object.defineProperty(registry, VALIDATED_REGISTRY, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return Object.freeze(registry);
}

export function parseProviderActivationRegistry(input: unknown):
  | { readonly ok: true; readonly registry: ValidatedProviderActivationRegistry }
  | { readonly ok: false; readonly reason: 'registry_invalid' } {
  if (!isRecord(input) || !hasExactKeys(input, EXACT_REGISTRY_KEYS)) {
    return { ok: false, reason: 'registry_invalid' };
  }
  if (input.schemaVersion !== PROVIDER_ACTIVATION_SCHEMA_VERSION
      || typeof input.registryVersion !== 'string'
      || !REGISTRY_VERSION.test(input.registryVersion)
      || !Array.isArray(input.records)) {
    return { ok: false, reason: 'registry_invalid' };
  }

  const records: Readonly<ProviderActivationRecord>[] = [];
  const identities = new Set<string>();
  for (const value of input.records) {
    const record = cloneAndValidateRecord(value);
    if (record === null) return { ok: false, reason: 'registry_invalid' };
    const identity = recordIdentity(record);
    if (identities.has(identity)) return { ok: false, reason: 'registry_invalid' };
    identities.add(identity);
    records.push(record);
  }

  return {
    ok: true,
    registry: brandRegistry(input.registryVersion, records),
  };
}

function inactiveRecord(
  provider: Provider,
  operation: Operation,
  environment: Environment,
  contractLineage: string,
  state: 'unsupported' | 'fixture_only',
): ProviderActivationRecord {
  return {
    provider,
    operation,
    environment,
    contractLineage,
    state,
    approvedBaseUrl: null,
    evidenceBundleSha256: null,
    reviewedAt: null,
  };
}

const ALL_OPERATIONS: readonly Operation[] = Object.freeze([
  'pix_in_create',
  'pix_in_query',
  'pix_in_recover',
  'pix_out_create',
  'pix_out_query',
  'pix_out_recover',
  'webhook_verify',
]);
const ALL_ENVIRONMENTS: readonly Environment[] = Object.freeze(['sandbox', 'production']);

function buildDefaultRecords(): readonly ProviderActivationRecord[] {
  const records: ProviderActivationRecord[] = [];
  for (const environment of ALL_ENVIRONMENTS) {
    for (const operation of ALL_OPERATIONS) {
      records.push(inactiveRecord(
        'akkadpag',
        operation,
        environment,
        'akkadpag-legacy-api-v1',
        'fixture_only',
      ));
      const flevoState = operation.startsWith('pix_out_') ? 'unsupported' : 'fixture_only';
      records.push(inactiveRecord(
        'flevopay',
        operation,
        environment,
        'flevopay-legacy-app-api-v1',
        flevoState,
      ));
    }
  }
  return records.map((record) => Object.freeze(record));
}

export const DEFAULT_PROVIDER_ACTIVATION_REGISTRY = Object.freeze({
  schemaVersion: PROVIDER_ACTIVATION_SCHEMA_VERSION,
  registryVersion: '2026-08-17.0',
  records: Object.freeze(buildDefaultRecords()),
});

function isBrandedRegistry(value: unknown): value is BrandedRegistry {
  return typeof value === 'object'
    && value !== null
    && (value as Partial<BrandedRegistry>)[VALIDATED_REGISTRY] === true;
}

function stateAuthorizes(environment: Environment, state: ActivationState): boolean {
  if (environment === 'sandbox') return state === 'sandbox_proven' || state === 'production_enabled';
  return state === 'production_enabled';
}

export function createProviderOperationAuthorizer(options: { readonly registry: ValidatedProviderActivationRegistry }) {
  if (!isBrandedRegistry(options?.registry)) {
    throw new Error('Provider activation registry must be validated.');
  }
  const registry = options.registry as BrandedRegistry;
  const byIdentity = new Map<string, Readonly<ProviderActivationRecord>>();
  for (const record of registry.records) byIdentity.set(recordIdentity(record), record);

  return Object.freeze({
    authorize(input: unknown): ProviderAuthorizationDecision {
      if (!isRecord(input)
          || !isProvider(input.provider)
          || !isOperation(input.operation)
          || !isEnvironment(input.environment)) {
        return { kind: 'denied', reason: 'subject_not_registered' };
      }
      const identity = `${input.provider}\u0000${input.operation}\u0000${input.environment}`;
      const record = byIdentity.get(identity);
      if (record === undefined) return { kind: 'denied', reason: 'subject_not_registered' };
      if (typeof input.contractLineage !== 'string' || input.contractLineage !== record.contractLineage) {
        return { kind: 'denied', reason: 'lineage_mismatch' };
      }
      if (!stateAuthorizes(record.environment, record.state)) {
        return { kind: 'denied', reason: 'activation_state_denied' };
      }
      if (record.approvedBaseUrl === null
          || record.evidenceBundleSha256 === null
          || record.reviewedAt === null) {
        return { kind: 'denied', reason: 'activation_state_denied' };
      }
      const grant: ProviderOperationGrant = Object.freeze({
        provider: record.provider,
        operation: record.operation,
        environment: record.environment,
        contractLineage: record.contractLineage,
        activationState: record.state,
        approvedBaseUrl: record.approvedBaseUrl,
        evidenceBundleSha256: record.evidenceBundleSha256,
        reviewedAt: record.reviewedAt,
        registryVersion: registry.registryVersion,
      });
      return Object.freeze({ kind: 'authorized' as const, grant });
    },
  });
}
