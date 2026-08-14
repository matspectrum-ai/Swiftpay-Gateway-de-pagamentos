# SwiftPay V2 — Public API Contract

Status: Phase 1 foundational contract

## Boundary

The merchant API is Pix-first and intentionally small. Initial canonical resources are authentication, payments, balance, payouts and refunds when those capabilities are enabled. Checkout, Payment Link and Quick Pix are channels over the same Payment domain, not separate financial systems.

Admin/operator routes, provider webhook ingress and worker commands are excluded from the merchant OpenAPI.

## Authentication and authorization

Machine clients use the SwiftPay client-credentials flow. Tokens are merchant-, credential- and environment-scoped.

Authentication does not grant Production financial capability by itself. Every monetary action rechecks merchant lifecycle, KYC and operation policy.

## Request identity

Every request receives a server request ID returned in `X-Request-Id`. The same identity is used in error payloads and structured logs.

Correlation IDs are tracing metadata and never substitute for financial idempotency.

## Monetary idempotency

Every public operation that creates or moves money requires `Idempotency-Key`.

Database scope:

`merchant_id + environment + operation + idempotency_key`

Rules:

- same key + same canonical request returns the same logical operation/resource;
- same key + different canonical request returns HTTP 409 with `idempotency_key_reused`;
- an existing operation in progress or recovery is returned as that same operation;
- HTTP retry never creates a second monetary action merely because the prior response was lost;
- `external_id` remains a separate merchant business reference.

## Success responses

Canonical application success is distinct from failure. Resource responses should be direct, strongly typed resource representations rather than a nullable generic success/error envelope.

Payment projections may expose normalized Pix fields, fee/net snapshots, timestamps and merchant references. Provider identity, provider cost, credentials, raw provider status and execution internals remain private.

A legacy `/v1` compatibility projection may be retained only when cutover evidence proves it is necessary.

## Error contract

Every canonical non-2xx response contains an `error` object with required:

- `code`: stable machine-readable category;
- `message`: human-readable explanation;
- `requestId`: support/correlation identity.

Optional `details` carries deterministic field/domain violations.

Clients branch on `code`, never on message text. Raw exceptions, stack traces, SQL details, provider secrets and raw provider error bodies never cross the merchant boundary.

Initial stable categories include validation, invalid/revoked credentials, IP restriction, inactive merchant, KYC required, operation forbidden, rate limit, resource not found, idempotency conflict, insufficient balance, invalid state, provider unavailable, provider execution unknown and internal error.

## Validation

Return all deterministic request violations known at validation time in one response. Field identifiers use public API names; detail ordering is deterministic; detail codes are stable enough for tooling.

## HTTP semantics

Platform-wide mapping:

- 200 successful read/action;
- 201 resource created;
- 202 operation accepted but still executing/recovering, including ambiguous external execution;
- 400 malformed or syntactically invalid request;
- 401 missing/invalid authentication;
- 403 authenticated but forbidden by KYC/IP/merchant policy;
- 404 merchant-scoped resource absent;
- 409 idempotency/state/resource conflict;
- 422 only if standardized for semantic request failures;
- 429 rate limited;
- 500 unexpected SwiftPay failure;
- 502/503 only when upstream failure can be classified safely.

An ambiguous monetary provider result is never converted to definitive failure just to choose an HTTP code.

## Amounts, time and environment

Money is integer BRL centavos; floating-point money is forbidden. Timestamps are UTC RFC3339/ISO-8601. Sandbox and Production identities never cross environments.

## Payment/refund projection

Canonical collection state is owned by Payment. Refunds are first-class resources. Merchant-facing `partially_refunded`/`refunded` may be derived projections without rewinding the internal paid collection truth.

Raw provider statuses never become SwiftPay public statuses.

## OpenAPI

The merchant OpenAPI is generated from the application contract and checked in CI.

Invariant: runtime-emitted public status codes equal documented OpenAPI statuses.

CI must verify response schemas, required idempotency headers on monetary operations, absence of internal/provider/admin routes, breaking changes against an approved snapshot, and SDK/example generation from the canonical specification.

## Compatibility

Keep `/v1` where correctness is not weakened. Before cutover, capture the deployed legacy OpenAPI and representative merchant fixtures. Compatibility shims remain in the HTTP projection layer rather than contaminating domain behavior.

## Fail-first tests

1. every non-2xx response has code, message and requestId;
2. multiple invalid fields return all deterministic violations;
3. endpoint mapping cannot drop a domain error code;
4. runtime and OpenAPI status sets match;
5. IP restriction is documented and returns 403;
6. internal/provider/admin routes never enter merchant OpenAPI;
7. same idempotency key + same request creates one logical operation;
8. same key + different request returns deterministic 409 conflict;
9. external_id remains independent from idempotency;
10. in-progress/unknown execution is replayed, not re-executed;
11. money serializes as integer centavos;
12. public serialization leaks no provider routing/cost/secrets;
13. request ID is consistent in response/log context;
14. Sandbox credentials cannot invoke Production operations.
