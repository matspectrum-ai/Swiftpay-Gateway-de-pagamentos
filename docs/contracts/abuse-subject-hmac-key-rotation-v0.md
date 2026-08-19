# A18 — Abuse Subject HMAC Key Rotation — Contract V0

Status: **FROZEN FOR TDD**  
Date: 2026-08-18

This contract refines `docs/specs/abuse-subject-hmac-key-rotation-v0.yaml`. The YAML specification is authoritative if wording differs.

## 1. Scope and invariants

A18 extends A14 only far enough to rotate the abuse-subject HMAC authority without resetting effective quota state.

A18 MUST preserve:

- the A14 fixed 60-second windows and all policy limits;
- the A14 trusted-ingress and route-ordering behavior;
- A14 `429 rate_limit_exceeded` and fail-closed `503 request_admission_unavailable` behavior;
- opaque HMAC-only subject persistence;
- zero raw IP, merchant, environment or key material in PostgreSQL/logs/metrics;
- zero provider, payment, ledger or other monetary authority;
- worker database authority unchanged.

## 2. Configuration contract

Canonical API environment variables:

```ts
export const ABUSE_HMAC_KEY_ENV = 'SWIFTPAY_ABUSE_HMAC_KEY';
export const ABUSE_HMAC_PREVIOUS_KEY_ENV = 'SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY';
export const MIN_ABUSE_HMAC_KEY_BYTES = 32;
```

`SWIFTPAY_ABUSE_HMAC_KEY` remains required.

`SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY` is optional and continuity-only. When present it:

- MUST contain at least 32 UTF-8 bytes;
- MUST be byte-for-byte distinct from the active key;
- MUST NOT be caller selectable;
- MUST NOT be exposed to the worker.

Required API config shape:

```ts
export interface ApiConfig {
  // existing fields unchanged
  readonly abuseHmacKey: string;
  readonly abuseHmacPreviousKey?: string;
}
```

Malformed authority is a startup `ConfigurationError` and MUST NOT echo either secret.

A18 does not introduce abuse-key IDs. The pseudonyms are internal server values and no serialized artifact contains a `kid`.

## 3. `@swiftpay/abuse` contract

Existing A14 policy/result types remain unchanged.

The store boundary changes to:

```ts
export interface AbuseQuotaStore {
  consume(input: {
    readonly policy: AbusePolicy;
    readonly activeSubjectHash: string;
    readonly previousSubjectHash?: string;
  }): Promise<AbuseQuotaDecision>;
}
```

The constructor changes to:

```ts
export function createApiAbuseControls(
  store: AbuseQuotaStore,
  options: {
    readonly trustedProxyIps: readonly string[];
    readonly hmacKey: string;
    readonly previousHmacKey?: string;
  },
): ApiAbuseControls;
```

Construction MUST reject:

- active key shorter than 32 UTF-8 bytes;
- previous key shorter than 32 UTF-8 bytes;
- previous key equal to active key;
- any existing invalid trusted-proxy configuration.

The error remains the sanitized A14 configuration error.

For every admitted canonical subject:

1. derive `activeSubjectHash` with the active key;
2. when configured, derive exactly one `previousSubjectHash` with the previous key;
3. call `store.consume(...)` exactly once;
4. validate the returned decision using the existing A14 validation rules.

Exact HMAC input namespace and canonical subject encodings remain A14 `a14v0` unchanged.

No unbounded keyring and no trial-all behavior are permitted.

## 4. Database adapter contract

`packages/db/src/api-abuse-rate-limit.ts` MUST call one RPC per logical admission:

```sql
select *
from app.consume_api_abuse_quota(
  $1::text,
  $2::text,
  $3::text
)
```

Argument order:

1. policy;
2. active subject hash;
3. previous subject hash or SQL `NULL`.

The adapter MUST reject before SQL execution:

- unknown policy;
- malformed active hash;
- malformed previous hash;
- active and previous hashes that are identical.

The exact result row remains:

```ts
export interface ApiAbuseQuotaDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}
```

Database/validation/result-shape failures remain sanitized `ApiAbuseRateLimitStoreError` failures.

## 5. PostgreSQL RPC contract

Canonical function:

```sql
app.consume_api_abuse_quota(
  p_policy text,
  p_active_subject_hash text,
  p_previous_subject_hash text default null
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
```

The defaulted third argument is mandatory. Existing A14 two-argument invocations MUST remain valid during rolling deployment.

Function properties remain:

- `LANGUAGE plpgsql`;
- `VOLATILE`;
- `SECURITY DEFINER`;
- fixed empty `search_path`;
- executable by `swiftpay_api` only;
- not executable by `PUBLIC`, `anon`, `authenticated`, `service_role`, or `swiftpay_worker`.

The final database capability surface MUST have no net EXECUTE widening from A14.

## 6. Atomic alias algorithm

The RPC accepts exactly one active hash and optionally one previous hash.

Validation:

- active hash: lowercase 64-character hexadecimal SHA-256 form;
- previous hash: `NULL` or the same exact shape;
- active and previous hashes MUST differ.

### 6.1 Row materialization and locking

For each supplied alias, a row in `app.api_abuse_windows` MUST exist before reconciliation.

A missing alias is materialized with:

- `request_count = 0`;
- `window_started_at = v_now - interval '60 seconds'`;
- `updated_at = v_now`.

The expired placeholder prevents creation of a fresh alias from extending or resetting another live alias window.

All supplied alias rows MUST then be locked before the decision. Lock acquisition MUST use deterministic ascending lexical `subject_hash` order so reversed active/previous inputs cannot deadlock each other.

### 6.2 Live aliases

An alias is live iff:

```text
v_now < window_started_at + 60 seconds
```

If no supplied alias is live:

```text
canonical_window_started_at = v_now
canonical_request_count_before = 0
```

If one or more supplied aliases are live:

```text
canonical_window_started_at = latest live window_started_at
canonical_request_count_before = maximum live request_count
```

This synthetic state is deliberately conservative: rotation MUST NOT create more headroom than any relevant live alias already permits.

### 6.3 Decision

If `canonical_request_count_before < policy_limit`:

```text
allowed = true
canonical_request_count_after = canonical_request_count_before + 1
remaining = policy_limit - canonical_request_count_after
retry_after_seconds = 0
```

Otherwise:

```text
allowed = false
canonical_request_count_after = canonical_request_count_before
remaining = 0
retry_after_seconds = ceil(canonical_window_started_at + 60s - v_now), bounded to 1..60
```

The same canonical `window_started_at` and post-decision `request_count` MUST be written to every supplied alias row in the same transaction.

The existing A14 stale-row pruning contract remains capped at 32 rows older than 24 hours per consume.

## 7. Concurrency contract

The transaction is authoritative across API replicas.

For the same logical subject represented by the active/previous pair:

- concurrent dual-key calls MUST serialize through the locked alias rows;
- reversed alias ordering MUST not cause deadlock;
- the logical policy ceiling MUST not be exceeded;
- no application-level check-then-consume or two-RPC sequence may become authoritative.

## 8. Rolling-deployment contract

A18 has an explicit operational invariant.

### Stage 1 — database first

Deploy the backward-compatible RPC with the defaulted third argument before any A18 API replica is allowed to serve.

### Stage 2 — overlap

During mixed software deployment:

- old A14 replicas: old key as their single active key;
- new A18 replicas: new key active + old key previous.

Forbidden states:

- A14 code using the new active key while old-key windows may still be live;
- any serving A18 active-only replica while an old A14 replica can still serve.

### Stage 3 — drain and retire

The previous key may be removed only after all conditions hold:

1. every old A14 old-key-only replica is drained and incapable of serving;
2. every serving replica runs A18 active+previous;
3. at least 60 seconds have elapsed since the last old-key-only replica became incapable of serving.

Then A18 may be redeployed active-only with `SWIFTPAY_ABUSE_HMAC_PREVIOUS_KEY` absent.

No raw-subject migration or table rewrite is required.

## 9. Public and side-effect contracts

A18 changes no public route/schema/status contract.

On malformed key authority, malformed store input/result or database failure, A18 remains fail closed.

Before successful admission, A18 MUST create no:

- Payment or ProviderAttempt;
- ledger mutation;
- job;
- webhook event/delivery;
- dashboard mutation;
- API credential mutation;
- provider registry transition;
- retained-provider network call.

## 10. Privacy and observability

Forbidden in A12 logs, A13 metric labels/output and business persistence:

- raw client IP;
- merchant/environment plaintext used as an A18 subject;
- active/previous subject hash;
- active/previous HMAC secret.

A18 adds no dynamic high-cardinality metric family.

## 11. TDD gate

Implementation authority remains **NONE** until fail-first tests prove the current A14 implementation violates this frozen A18 contract.

RED coverage MUST include:

- active-only compatibility;
- optional previous key validation and secret-distinctness;
- one-store-call dual pseudonym derivation;
- adapter three-argument RPC invocation and validation;
- old exhausted/new missing cannot regain quota;
- old partially consumed/new missing cannot regain headroom;
- asymmetric live windows reconcile conservatively;
- active/previous reversed ordering concurrency;
- old two-argument and new three-argument database caller coexistence;
- previous-key retirement after the drain-plus-60-second invariant;
- no privacy/capability/provider/financial regression.
