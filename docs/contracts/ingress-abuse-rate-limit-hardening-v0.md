# A14 — Trusted Ingress, Abuse & Rate-Limit Hardening — Application Contract V0

Status: **FROZEN FOR TDD**  
Date: 2026-08-18

This contract refines `docs/specs/ingress-abuse-rate-limit-hardening-v0.yaml`. The YAML specification is authoritative if wording differs.

## 1. Package boundary

A14 introduces `@swiftpay/abuse` as a pure application/security package. It owns ingress IP normalization/resolution, opaque subject derivation, fixed V0 policy constants and admission orchestration over an injected store.

It MUST NOT own HTTP listeners, PostgreSQL pools, provider transport, Payment/ledger state or arbitrary logging.

Required exports:

```ts
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

export function normalizeCanonicalIp(value: unknown): string | null;

export function createApiAbuseControls(
  store: AbuseQuotaStore,
  options: {
    readonly trustedProxyIps: readonly string[];
    readonly hmacKey: string;
  },
): ApiAbuseControls;
```

Additional exports are forbidden unless separately frozen.

## 2. Canonical IP behavior

`normalizeCanonicalIp`:

- accepts only strings that `node:net.isIP` classifies as IPv4 or IPv6;
- IPv4 output is normalized dotted decimal;
- IPv6 output is the lowercase WHATWG-URL-normalized address without brackets;
- invalid/empty/whitespace-padded/wildcard/CIDR values return `null`;
- IPv4-mapped IPv6 is treated as IPv6 canonical form, not silently rewritten to IPv4.

The same normalization MUST be reused by A1 exact-IP allowlist evaluation for both request and stored entries. This preserves exact address equality while removing textual IPv6 aliasing.

## 3. Trusted ingress resolution

`trustedProxyIps` is already startup-validated by `@swiftpay/config` and contains zero to sixteen unique canonical exact IPs.

`resolveClientIp` behavior:

1. normalize `remoteAddress`; invalid direct peer => `null`;
2. if direct peer is **not** in `trustedProxyIps`, return the direct peer and ignore `xForwardedFor` completely;
3. if direct peer **is** trusted, `xForwardedFor` MUST be one string containing exactly one address:
   - no comma;
   - no array;
   - no empty value;
   - canonicalizable IP required;
4. trusted-peer malformed/missing forwarded identity => `null`.

A14 MUST NOT set Fastify `trustProxy`; raw forwarded host/proto metadata never becomes A14 authority.

## 4. Subject derivation

The HMAC key must contain at least 32 UTF-8 bytes. Invalid construction throws a sanitized configuration error without echoing the key.

Persisted subject hash is lowercase 64-character SHA-256 hex.

Exact HMAC bytes:

### Network

```text
a14v0\nnetwork\n<canonicalClientIp>
```

### Machine merchant/environment

```text
a14v0\nmachine_merchant_environment\n<merchantId>\n<environment>
```

The machine merchant ID must be canonical UUID shape and environment exactly `sandbox|production`. Invalid input produces `unavailable`/fails closed before store mutation; it never creates an arbitrary key.

## 5. Frozen policy constants

All windows are fixed 60-second windows.

| Policy | Subject | Limit |
|---|---|---:|
| `token_exchange_pre_auth` | network | 30 |
| `machine_request_pre_auth` | network | 12000 |
| `machine_read` | merchant + environment | 6000 |
| `machine_mutation` | merchant + environment | 3000 |
| `dashboard_request_pre_auth` | network | 300 |
| `readiness_probe` | network | 120 |

These are hard safety ceilings, not product entitlements.

`@swiftpay/abuse` has no caller-supplied limit/window API.

## 6. Store result validation

The package must fail closed when the store throws or returns malformed data.

Allowed decision:

- `allowed=true`;
- `remaining` safe integer `>=0` and `< policy limit`;
- `retryAfterSeconds=0`.

Denied decision:

- `allowed=false`;
- `remaining=0`;
- `retryAfterSeconds` safe integer `1..60`.

Any other shape => `unavailable`.

One admission invokes `store.consume` at most once.

## 7. Fastify integration

`BuildAppOptions` gains optional `abuseControls?: ApiAbuseControls` so focused/legacy unit harnesses can construct the app without production infrastructure. The production bootstrap/runtime MUST wire it.

When `abuseControls` is absent, existing non-A14 unit harness behavior remains unchanged. Production bootstrap contract tests MUST prove that real startup always composes it.

A14-controlled ordering when controls are present:

### `POST /v1/auth/token`

1. resolve client IP from `request.raw.socket.remoteAddress` + raw `x-forwarded-for`;
2. `token_exchange_pre_auth` admission;
3. existing A1 handler using the same canonical client IP;
4. existing A1 successful issuance quota unchanged.

### Machine routes

1. resolve client IP;
2. `machine_request_pre_auth` admission;
3. existing bearer parsing/signature/DB revalidation;
4. post-auth `machine_read` or `machine_mutation` admission using principal merchant/environment;
5. business service.

Route mapping:

- `GET /v1/transactions/:id` => read;
- `GET /v1/balance` => read;
- `POST /v1/transactions` => mutation.

### Dashboard routes

All routes under `/dashboard/v1/` perform client-IP resolution + `dashboard_request_pre_auth` before invoking any dashboard service. Therefore a denied request performs zero Supabase Auth, K4 or dashboard database work.

No post-auth dashboard user quota is part of V0.

### Health

- `/health/ready`: client-IP resolution + `readiness_probe` before DB readiness;
- `/health/live`: no A14 admission and no DB work.

## 8. Public failure contract

### Invalid ingress identity

```http
400
Cache-Control: no-store
```

```json
{
  "error": {
    "code": "invalid_request_origin",
    "message": "Request origin is invalid.",
    "requestId": "<A12 server UUID>"
  }
}
```

### General throttle

```http
429
Retry-After: <integer 1..60>
Cache-Control: no-store
```

```json
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Request rate limit exceeded.",
    "requestId": "<A12 server UUID>"
  }
}
```

### Admission store unavailable/malformed

```http
503
Cache-Control: no-store
```

```json
{
  "error": {
    "code": "request_admission_unavailable",
    "message": "Request admission is unavailable.",
    "requestId": "<A12 server UUID>"
  }
}
```

Existing A1 successful issuance throttle remains `429 auth_rate_limit_exceeded` and keeps its existing `Retry-After` semantics.

## 9. Side-effect invariants

- Pre-auth denial happens before token credential lookup/scrypt, machine bearer DB revalidation, dashboard Supabase Auth, and readiness DB probe respectively.
- Post-auth machine denial happens before Pix/idempotency/balance business service invocation.
- Rate-limit denial creates no Payment, ProviderAttempt, ledger entry, job, webhook event/delivery, dashboard mutation or API credential mutation.
- No limiter path changes `execution_unknown` semantics.
- No limiter path changes A10 activation registry or A11 provider transport authority.

## 10. Privacy/observability

A14 does not add a new metric family in V0. Existing A13 route/status metrics expose 429/503 status classes with bounded route templates.

A14 does not add raw IP, forwarded IP, HMAC subject hash, public key, merchant ID, credential ID or token fingerprint to A12 logs or A13 labels/output.

The abuse state table contains only closed policy, opaque subject hash, window count and timestamps.

## 11. Production wiring

`@swiftpay/config` adds:

- `SWIFTPAY_TRUSTED_PROXY_IPS` — optional JSON array, default `[]`, max 16 unique canonical exact IP strings;
- `SWIFTPAY_ABUSE_HMAC_KEY` — required API secret, minimum 32 UTF-8 bytes.

The API runtime composes `createApiAbuseRateLimitStore` + `createApiAbuseControls` and passes the controls to `buildApp`.

The worker receives no A14 config/capability.

## 12. No authority expansion

A14 introduces no provider credential, PSP network call, provider registry transition, financial mutation capability or browser-side authority.
