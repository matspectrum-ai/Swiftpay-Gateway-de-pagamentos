# Legacy Public API Error Envelope and OpenAPI Contract Audit

Status: source-level public contract audit complete; deployed-spec capture remains evidence-required only for cutover parity

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Purpose

This document records the externally visible response/error conventions and the source-level OpenAPI behavior of the legacy payment API so SwiftPay V2 can preserve compatibility intentionally instead of inheriting ambiguity.

This is a source-contract audit. The deployed OpenAPI document was not captured in this work unit, so exact deployed-spec parity must be verified separately before cutover if backward compatibility depends on it.

## Legacy envelope

The public API defines two generic response shapes:

```text
BaseResponse
- message?: string
- error?: ApiErrorResponse

BaseResponse<T>
- data?: T
- message?: string
- error?: ApiErrorResponse
```

`ApiErrorResponse` itself is:

```text
error
- message?: string
- code?: string
```

Every member is nullable/optional. The type system therefore permits states such as:

- success response with no `data`;
- error response with no `code`;
- response containing neither `data` nor `error`;
- informational message independent of success/failure.

HTTP status is consequently part of the effective discriminant even though the JSON body itself is not discriminated.

## Existing error-code taxonomy

The legacy core does define useful machine-oriented error constants, including categories for:

- authentication/credential state;
- rate limiting;
- merchant status;
- IP restrictions;
- missing resources;
- duplicate external/document identifiers;
- provider/routing readiness;
- Pix generation;
- unsupported/invalid methods;
- internal API authentication;
- payout account/balance/amount constraints;
- sandbox-only behavior;
- internal/ledger failure.

This taxonomy is conceptually valuable. The problem is not the existence of codes; it is that code fidelity is inconsistent across endpoints.

## Concrete error-code fidelity mismatch

`CreateTransactionEndpoint` returns a coded `invalid_token` error for authentication failure, but when `ITransactionService.CreateAsync` returns a business failure the endpoint constructs:

```text
ApiErrorResponse(result.ErrorMessage)
```

without forwarding a programmatic code.

Therefore a merchant integration cannot safely assume that `error.code` exists for transaction business errors even when the service/domain has a meaningful error category.

`CreateCashoutEndpoint`, by contrast, forwards both:

```text
result.ErrorMessage
result.ErrorCode
```

into `ApiErrorResponse`.

Thus error-code fidelity is endpoint-specific rather than a reliable platform contract.

### V2 rule

Every non-success canonical API response must contain a stable machine-readable top-level error code.

Human-readable messages are explanatory text and must never be required for client branching.

## Validation error information loss

FastEndpoints validation is customized globally to:

1. take `failures.FirstOrDefault()`;
2. discard the remaining failures;
3. return the first message;
4. assign the broad code `validation_error`.

A request with several invalid fields therefore exposes only one problem per round trip.

This is unnecessarily costly for SDKs, coding agents and merchants integrating against the API.

### V2 validation contract

Return all deterministic validation violations that can be known from the request in one response.

Conceptual shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request is invalid.",
    "request_id": "019...",
    "details": [
      {
        "field": "amount",
        "code": "greater_than",
        "message": "Amount must be greater than zero."
      }
    ]
  }
}
```

Requirements:

- `error.code` is mandatory;
- `details` ordering is deterministic;
- field identifiers are API field names, not implementation/member names;
- detail codes are stable enough for tooling where useful;
- localized/human message changes do not alter machine semantics.

Backward-compatible V1 projection can remain smaller if required, but the canonical V2 internal/application error model should not be lossy.

## Correlation/request identity

The legacy pipeline has a useful `X-Correlation-Id` middleware. It accepts or creates a correlation UUID and returns the value in the response header.

The JSON error envelope, however, does not include that identifier.

V2 should standardize one request/correlation identity across:

- response header;
- error body `request_id`;
- structured logs;
- provider attempts;
- outbox/jobs where causally relevant;
- webhook deliveries where causally relevant.

The server may accept a client correlation ID for tracing, but must bound/validate its format and must not treat it as financial idempotency.

## OpenAPI generation

The legacy payment application registers FastEndpoints plus ASP.NET OpenAPI and exposes:

```text
/openapi/...
/docs
/docs/classic
```

through `MapOpenApi()` and Scalar.

The source config sets document metadata such as title `SwiftPay - Pix Gateway`, version `v1`, description and support contact.

The practical contract is largely generated from endpoint request/response types and each endpoint's `Description(...Produces...)` declarations.

This is preferable to handwritten documentation, but generation alone does not guarantee that documented status codes match runtime behavior.

## Concrete documented-status mismatch

`POST /v1/auth/token` declares OpenAPI responses for:

```text
200
400
401
429
```

The runtime endpoint also returns HTTP `403` when the calling IP is outside the credential allowlist.

That 403 is not present in the endpoint's inspected `Produces` declarations.

Therefore the source-level OpenAPI contract is not a complete enumeration of runtime responses.

### V2 rule

For every public endpoint:

```text
runtime emitted statuses == documented OpenAPI statuses
```

Contract tests must fail when either side diverges.

## Shared success/error response schema

Several endpoints document the same generic response class for both success and failure statuses. This mirrors the nullable envelope but weakens generated client ergonomics because the type does not make success/error exclusivity explicit.

V2 does not need to break V1 immediately to fix this internally.

Preferred canonical application result:

```text
Success<T>
OR
ApiProblem
```

The compatibility HTTP layer may project that result into the legacy `data/message/error` envelope for `/v1` where required.

## Idempotency is absent from the public envelope/contract

The reviewed create-transaction model treats `externalId` as a merchant business reference.

It is not an HTTP operation idempotency contract.

No first-class `Idempotency-Key` reference was found in the current source search for the public payment API.

For money-creating/money-moving V2 operations, define an explicit header contract, for example:

```text
Idempotency-Key: <merchant-generated opaque key>
```

with server-side database uniqueness over at least:

```text
merchant_id + environment + operation + idempotency_key
```

Behavior:

- same key + same canonical request -> return/recover the original operation;
- same key + different canonical request -> deterministic conflict;
- in-progress/unknown external execution -> return the existing operation state, never issue a second monetary action merely because the HTTP request was retried.

`external_id` remains a separate business reference.

## Public vs internal/provider contracts

The canonical merchant OpenAPI must not accidentally expose implementation-only routes or schemas.

Separate at least conceptually:

```text
merchant public API
internal trusted application commands
provider webhook ingress
operator/admin API
```

Provider identities, provider credentials, provider costs and internal execution/recovery state remain private unless a deliberately designed merchant-facing field requires them.

## Versioning and compatibility

Initial V2 compatibility strategy should preserve `/v1` where doing so does not compromise correctness.

Rules:

- additive optional response fields may be introduced only after compatibility testing;
- existing field meaning must not silently change;
- fixes to ambiguous financial semantics may require an explicit compatibility projection or a new canonical field;
- breaking request/response semantics require a deliberate API version decision;
- internal implementation is not constrained to resemble the legacy architecture.

The existing balance contract is a key example: legacy field names conflate available/withdrawable/reserved/blocked semantics. Compatibility may require a projection while V2 domain fields remain explicit.

## Canonical V2 error model direction

Recommended minimum canonical problem object:

```text
code        required stable machine code
message     required human-readable summary
request_id  required correlation/support identity
details     optional structured validation/domain details
```

Optional fields may later include:

```text
retryable
retry_after_seconds
resource_id
operation_id
```

Do not expose raw exception messages, SQL/provider secrets, stack traces or provider credentials.

Provider-originated errors should be normalized into SwiftPay categories. Raw provider diagnostics belong in protected operational evidence, not the merchant contract.

## HTTP semantics direction

Define status mapping once, not ad hoc per endpoint.

Illustrative categories:

```text
400 malformed/validation/domain request
401 missing/invalid authentication
403 authenticated but forbidden/restricted
404 merchant-scoped resource absent
409 idempotency/resource/state conflict
422 optionally reserved for semantically invalid domain input if chosen consistently
429 rate limited
500 unexpected internal failure
502/503 provider/platform dependency unavailable where exposing retryability is useful
```

Exact choices must be frozen in the public API contract; consistency matters more than mechanically preserving every legacy status.

Unknown provider execution for a monetary operation is a resource state, not justification for an automatic second POST.

## OpenAPI as executable contract

V2 OpenAPI should be a generated, version-controlled/tested artifact.

CI requirements:

1. generate canonical spec from the application contract;
2. validate the spec;
3. run contract tests for representative success/error responses;
4. compare the public spec against an approved snapshot or breaking-change checker;
5. prevent undocumented emitted public statuses;
6. prevent provider/internal-only routes from entering the merchant spec;
7. generate SDKs/examples only from the canonical spec.

## Required fail-first tests

1. Every public non-2xx response has `error.code`, `error.message` and a request/correlation ID.
2. Multiple invalid fields return all deterministic validation violations in stable order.
3. A coded domain failure cannot lose its code in an endpoint mapper.
4. Every runtime HTTP status for an endpoint exists in its OpenAPI operation.
5. Every documented success/error schema matches serialized runtime shape.
6. Credential IP rejection is represented as a documented 403.
7. Same idempotency key + same create-Pix request returns one logical operation.
8. Same idempotency key + different request returns a deterministic conflict.
9. Merchant business `external_id` and HTTP idempotency key remain separate concepts.
10. Correlation/request ID appears consistently in response/log context without becoming a financial idempotency key.
11. Internal/provider/admin-only endpoints are absent from the merchant public spec.
12. A compatibility fixture can validate legacy `/v1` responses independently from the new internal result model.

## Migration/cutover implication

Before production cutover, capture the actually deployed legacy OpenAPI document and compare it with:

- the audited source-level contract;
- real integration fixtures from current merchant clients where available;
- the V2 compatibility projection.

Do not block V2 schema/domain design on that deployed capture. It is required for final compatibility acceptance, not for understanding the architectural safety model.

## Phase implication

The source-level BaseResponse/error/OpenAPI gate is complete enough to define the V2 public API contract.

Remaining compatibility evidence is operational rather than architectural: the exact deployed legacy spec and, ideally, representative real merchant requests/responses before cutover.