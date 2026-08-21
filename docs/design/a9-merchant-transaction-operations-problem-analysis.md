# SwiftPay V2 — A9 Merchant Transaction Operations Problem Analysis

Date: 2026-08-17
Status: **FROZEN PROBLEM ANALYSIS**

## Problem

A2/A3 prove that `Payment` is the canonical merchant-facing money-collection resource and already expose machine-authenticated create/get behavior, but the dashboard still has no transaction feed or transaction detail surface. A6/K4 prove a reusable dashboard-user -> current merchant/environment/role authorization boundary, and A7/A8 prove that dashboard business resources can be exposed without granting the browser/Data API direct access to private `app` tables.

A9 must add merchant transaction visibility without accidentally creating a second payment state machine, leaking provider internals or customer PII, allowing cross-tenant reads, or turning a read-only dashboard feature into financial mutation authority.

The phrase “transaction status operations” in A9 means **status visibility and filtering only**. V0 contains no command that changes Payment status.

## Current proven foundation

- `Payment` is the canonical merchant resource; `ProviderAttempt` is an internal execution/recovery object.
- Canonical Payment collection states are exactly `creating`, `pending`, `paid`, `expired`, `failed`, and `cancelled`.
- `creating` explicitly includes ambiguous provider-create outcomes where SwiftPay cannot yet prove either charge existence or definitive failure.
- `paid` remains the canonical collection state even when refunds exist; refunds are separate resources and `refunded_amount_cents` is projected separately.
- A2/A3 already maintain a merchant-safe Payment projection that excludes provider identity, provider cost, raw provider status, routing internals, execution tokens and credentials.
- A6 verifies dashboard sessions online against Supabase Auth; K4 re-evaluates current merchant membership and role from canonical database state.
- A7/A8 keep dashboard and A1 machine route realms separate with no authentication fallback.
- `app.payments` is private. Browser/Data API direct access remains forbidden.
- Hosted `app.payments` currently has the index `payments_merchant_created_idx (merchant_id, environment, created_at DESC, id ASC)` and no rows in the canonical hosted project at this checkpoint.
- Hosted A8 capability baseline is exactly 21 `app` EXECUTE routines for `swiftpay_api` and 6 for `swiftpay_worker`.

## A9 scope decision

A9 V0 is a **read-only dashboard transaction read model** over canonical Payment state.

Dashboard-only routes:

- `GET /dashboard/v1/merchants/:merchantId/environments/:environment/transactions`
- `GET /dashboard/v1/merchants/:merchantId/environments/:environment/transactions/:transactionId`

No machine `/v1/**` route is added or changed by A9. Existing A2 machine `GET /v1/transactions/:id` remains frozen.

No POST/PATCH/DELETE transaction command is included.

## Authorization decision

Both list and detail require:

- the ordinary A6 online Supabase dashboard-session verifier;
- current K4 `member` authority for the route merchant/environment;
- no AAL2 requirement because A9 is read-only;
- no A1 machine-token fallback.

Transaction history remains readable to a currently authorized member in both Sandbox and Production. A9 does not make KYC or merchant lifecycle an additional read gate; those concepts govern financial capability, not historical visibility. Current auth-user and merchant-membership state remains authoritative through K4.

The trusted database routines independently re-check K4 member authority even after the application authorization boundary. Route authorization is not replaced by caller-supplied merchant IDs.

## Canonical dashboard transaction projection

A9 adds a dashboard-specific merchant-safe projection. It is derived from `app.payments` and normalized Pix data only; it is not a provider-response projection.

List item fields:

- `id`
- `externalId`
- `method` = `pix`
- `source` = `api | checkout | payment_link | quick_pix`
- `amount`
- `fee`
- `netAmount`
- `refundedAmount`
- `currency` = `BRL`
- `status`
- `description`
- `environment`
- `expiresAt`
- `paidAt`
- `createdAt`
- `updatedAt`

`expiresAt` and `paidAt` are nullable when canonical state has no value. Money is integer centavos. Timestamps are UTC RFC3339.

Detail returns the same fields plus normalized merchant-safe `pix` data when canonical A2/A3 state proves a charge payload is available:

- `txId`
- `qrCode`
- `copyAndPaste`
- `expiresAt`

The list does not include QR/copy-paste payloads. This keeps the feed bounded and avoids repeatedly returning payment instructions that are only useful on detail.

## Status decision

`status` is exactly the canonical Payment `collection_status`:

- `creating`
- `pending`
- `paid`
- `expired`
- `failed`
- `cancelled`

A9 does not overload this field with `partially_refunded` or `refunded`. Refund visibility is represented by `refundedAmount`; later refund-resource surfaces may add richer refund status.

A9 never derives public status from `provider_status_raw`.

### Ambiguous execution

A Payment whose unresolved provider attempt is `execution_unknown` remains merchant-visible as `status=creating`.

A9 V0 does not expose `ProviderAttempt.state`, `last_error_class`, provider identity, provider raw status or recovery tokens. It also does not convert `creating` into `failed`, `pending` or any invented support status. A later recovery/operator slice may add separately contracted diagnostics.

This preserves the foundational rule that lack of external certainty is not proof of failure.

## Search and filter decision

The list route supports only bounded, indexable, canonical filters in V0:

- `status` — optional, exactly one canonical collection status;
- `externalId` — optional exact merchant-reference equality;
- `createdFrom` — optional inclusive UTC RFC3339 lower bound;
- `createdTo` — optional exclusive UTC RFC3339 upper bound;
- `cursor` — optional opaque A9 cursor;
- `limit` — optional page size.

`createdTo` must be strictly greater than `createdFrom` when both are supplied.

`externalId` search is exact. A2 preserves the merchant-provided external ID rather than trimming or case-folding it, so A9 must not silently normalize it. Empty external ID filters are invalid.

V0 explicitly excludes:

- free-text `q` search;
- substring/prefix/suffix matching;
- `ILIKE`/regex search;
- description search;
- customer-name/document/email/phone search;
- metadata JSON search;
- provider-reference search.

This avoids freezing an unbounded query surface and avoids turning customer PII or provider identifiers into search indexes.

Status and external-ID filters may be combined with the date bounds.

## Pagination decision

A9 uses cursor/keyset pagination only.

- default page size: 25;
- maximum page size: 100;
- no offset pagination;
- no total-count query in V0;
- deterministic ordering: `created_at DESC, id ASC`.

The ordering intentionally matches the hosted `payments_merchant_created_idx` direction exactly.

The server fetches at most `limit + 1` rows to determine whether a next cursor exists.

The cursor is an opaque, versioned, base64url application token containing only non-secret pagination state. It is bound to the route merchant/environment and normalized filter set so a cursor cannot be accidentally reused with different filters or scope. The cursor is not authorization authority: every request still re-runs A6/K4 and every database query still scopes by merchant/environment.

Cursor tampering or filter/scope mismatch is a `validation_error`; it must never broaden database scope. The exact serialized cursor grammar is deferred to the YAML specification.

## Concurrent-state consistency

A9 is a live read model, not a historical snapshot API.

- `created_at` and `id` are immutable pagination keys;
- newly created Payments sort before an existing cursor and therefore do not cause older-page duplication;
- mutable fields such as `status`, `refundedAmount`, `paidAt` and `updatedAt` may legitimately change between page requests;
- status-filtered pagination therefore represents current state at each request, not an MVCC snapshot of the first page;
- clients that need the latest state of one Payment must fetch detail by ID.

A9 must not invent snapshot guarantees that the canonical schema does not provide.

## Privacy and disclosure decision

A9 V0 deliberately excludes `customer_snapshot` and arbitrary `metadata` from both list and detail.

Although the Payment table may contain merchant-supplied customer information, exposing or searching PII requires a separate explicit privacy/display contract. A9 closes transaction visibility without expanding PII exposure.

The following are also forbidden from A9 responses:

- `merchant_id` as an alternative authority source;
- `source_resource_id`;
- `provider_id`;
- `provider_account_id`;
- `provider_payment_id`;
- `provider_status_raw`;
- `provider_cost_cents`;
- provider credentials or raw request/response evidence;
- routing/settlement/pricing-policy versions;
- fee rule internals such as basis points/fixed components;
- execution tokens, leases, internal error classes/codes;
- audit or idempotency internals.

`source` is permitted because it is canonical SwiftPay channel identity, not provider identity.

## Detail non-disclosure rule

Detail lookup is always scoped by:

- verified/current user authority;
- route `merchantId`;
- route `environment`;
- `transactionId`.

Missing, foreign-merchant and wrong-environment IDs are indistinguishable and return the same `resource_not_found` response.

The list route can never return rows outside the exact merchant/environment scope, even with a forged cursor or filter.

## Database boundary decision

A9 adds exactly two new trusted API read routines:

1. `app.list_dashboard_transactions`
2. `app.get_dashboard_transaction`

Both are `STABLE`, `SECURITY DEFINER`, fixed-search-path routines and re-check `app.require_dashboard_merchant_context(..., 'member')` internally.

A private `_a9_*` projection/cursor helper may be introduced if required, but it must be executable by neither runtime role.

A9 does **not** grant runtime table SELECT on `app.payments` or `app.provider_attempts`. It does not reuse the machine `app.get_api_payment` routine as the dashboard authorization boundary because dashboard reads must independently re-check current K4 user membership inside the trusted database operation.

Expected post-A9 capability counts if the YAML freezes this boundary unchanged:

- `swiftpay_api`: 23 exact `app` EXECUTE capabilities;
- `swiftpay_worker`: unchanged at 6.

No worker A9 authority is added.

## Query/index decision

The hosted base index already supports the unfiltered/date-bounded feed and its frozen order:

`(merchant_id, environment, created_at DESC, id ASC)`.

Exact `status` and exact `externalId` filters are part of A9 V0, but the hosted schema currently has no corresponding composite indexes. A9 must therefore treat their index coverage as part of this feature rather than relying on future table scans.

The YAML/DB contract must freeze additive B-tree coverage for:

- merchant + environment + collection status + pagination keys;
- merchant + environment + non-null external ID + pagination keys.

No index is added for description, customer snapshot, metadata or provider fields because those query surfaces are explicitly out of scope.

A9 must not delete existing indexes as a side effect. An empty hosted database producing an “unused index” INFO lint is not evidence that a contract-required query index is unnecessary.

## HTTP/error behavior

Successful list response is a direct object containing:

- `items`
- `nextCursor` (`string | null`)

No `total`, `totalPages` or offset metadata exists in V0.

Successful detail response is the direct transaction projection.

Stable error categories:

- malformed merchant/environment/transaction/query/cursor input -> `400 validation_error`;
- invalid/missing dashboard session -> `401 invalid_session`;
- authenticated user without current member authority -> `403 forbidden`;
- missing/foreign/wrong-environment transaction -> `404 resource_not_found`;
- Supabase Auth unavailable -> `503 authentication_unavailable`;
- unexpected trusted DB/application failure -> `500 internal_error`.

No raw SQL/provider/Auth body may cross the HTTP boundary.

Because transaction data is financially sensitive, list/detail responses use `Cache-Control: private, no-store` in V0. Existing request-ID/error-envelope conventions remain authoritative.

## Side-effect invariants

A9 list/detail/search/filter operations cause **zero** mutation of:

- `payments`;
- `provider_attempts`;
- `provider_events`;
- `request_idempotency`;
- `audit_events`;
- accounts/ledger transactions/ledger entries;
- payouts/payout attempts;
- refunds/refund attempts/evidence;
- jobs;
- webhook events/deliveries/endpoints;
- API credentials or token windows.

Reads do not append audit events in A9 V0. Request/application observability logs remain separate operational telemetry and must be redacted.

## No status-changing command in A9

The following are explicit non-objectives:

- cancel transaction;
- expire transaction;
- mark paid;
- simulate paid;
- retry/replay provider create;
- resolve `execution_unknown`;
- choose/fallback provider;
- refund transaction;
- edit Payment fields;
- alter external ID;
- change fee/net/pricing/routing snapshots.

Any future transaction action is a separate monetary/operational slice with its own idempotency, authorization and evidence contract.

## Clean RED requirements

Before A9 implementation:

- current **226/226** application contracts remain green;
- current **39 files / 1288 pgTAP assertions** remain green except newly introduced A9 assertions that are intentionally RED;
- K7/A1/A2/A3/A4/A6/A7/A8 real-database acceptance remains green;
- A9 failures are assertion-level absence of the frozen read surface, not parser/module/typecheck/harness failures;
- no A9 migration is applied to the hosted canonical project before local RED -> GREEN proof;
- no existing public machine route contract changes as part of making A9 RED.

## Planned acceptance

Real isolated-Postgres acceptance must prove at minimum:

1. current member can list and get transactions in both Sandbox and Production;
2. non-member/disabled/deleted user cannot read transaction data;
3. A1 machine Bearer is not accepted by the dashboard realm;
4. list returns only the exact route merchant/environment;
5. foreign/missing/wrong-environment detail is indistinguishable 404;
6. base feed ordering is exactly `createdAt DESC, id ASC`;
7. keyset pagination produces no duplicate IDs across sequential pages;
8. newly inserted newer rows do not appear after an existing older cursor;
9. `status` filter matches only the canonical collection state;
10. `externalId` filter uses exact preserved equality, not trimming/case-folding/substring behavior;
11. date lower bound is inclusive and upper bound exclusive;
12. invalid/forged/mismatched cursor fails closed as validation error;
13. list contains no Pix QR/copy-paste payload;
14. detail exposes normalized Pix payload only when canonical state permits it;
15. `execution_unknown` underlying attempt remains exposed only as canonical Payment `status=creating`;
16. refunded Payment keeps canonical `status=paid` while `refundedAmount` changes separately;
17. customer snapshot/metadata and every provider/internal field remain absent;
18. API runtime has exactly the newly frozen read capabilities and no direct protected-table SELECT;
19. worker capability count/authority remains unchanged;
20. financial, idempotency, audit, job and webhook row/state counts remain invariant across all A9 reads.

## Out of scope

- Transaction creation changes to `/v1/transactions`.
- Any transaction mutation/action.
- Free-text/fuzzy/customer/metadata/provider search.
- Customer PII display.
- Download/export/CSV/report generation.
- Aggregate analytics, charts or total counts.
- Provider recovery/operator diagnostics.
- Refund/payout operations.
- Hosted checkout/payment-link UI.
- Dashboard frontend implementation itself.
- Live PSP activation.

## Frozen conclusion

A9 V0 is a narrow, read-only dashboard view over canonical Payment truth: member-authorized list/detail, deterministic keyset pagination, exact status/external-reference/date filters, merchant-safe projection, no PII/provider leakage and no financial side effects.

The next mandatory artifact is the A9 YAML specification. No implementation, test migration or hosted schema change is authorized until that specification and the subsequent contracts are frozen.