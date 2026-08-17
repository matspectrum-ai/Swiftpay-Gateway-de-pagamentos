# SwiftPay V2 — A9 Merchant Transaction Operations Contracts

Status: **FROZEN FOR TDD**  
Date: 2026-08-17  
Specification: `docs/specs/merchant-transaction-operations-v0.yaml`

## Realm and authority

A9 exists only under the dashboard realm:

- `GET /dashboard/v1/merchants/{merchantId}/environments/{environment}/transactions`
- `GET /dashboard/v1/merchants/{merchantId}/environments/{environment}/transactions/{transactionId}`

Both operations use the ordinary A6 online dashboard-session verifier and current K4 `member` authority for the exact merchant/environment. AAL2 is not required. A1 machine credentials never authenticate A9 routes and there is no authentication fallback between realms.

A9 is read-only. It defines no create, cancel, expire, mark-paid, simulate-paid, retry, recovery, refund or other Payment mutation.

## Canonical status

A9 `status` is exactly `app.payments.collection_status`:

`creating | pending | paid | expired | failed | cancelled`.

ProviderAttempt state is never a public status source. An underlying `execution_unknown` attempt remains visible only as the canonical Payment `status=creating`.

Refunds do not rewrite collection state. A refunded Payment remains `status=paid` and exposes `refundedAmount` separately.

## List projection

Each item exposes exactly:

`id`, `externalId`, `method=pix`, `source`, `amount`, `fee`, `netAmount`, `refundedAmount`, `currency=BRL`, `status`, `description`, `environment`, `expiresAt`, `paidAt`, `createdAt`, `updatedAt`.

Money is integer centavos. Timestamps are RFC3339. Nullable canonical timestamps remain null.

The list never returns Pix QR/copy-paste fields.

Customer snapshot, metadata, source resource id, provider identity/account/payment id, raw provider status, provider cost, pricing/routing/settlement versions, fee-rule internals, execution tokens, leases and internal error fields are forbidden.

## Detail projection

Detail contains the list fields plus `pix`, which is either null or:

```text
{
  txId: string
  qrCode: string
  copyAndPaste: string
  expiresAt: RFC3339
}
```

`pix` is non-null only for canonical `pending`/`paid` Payments with a complete succeeded normalized Pix attempt.

## Filters

The list accepts only:

- `status`: one exact canonical status;
- `externalId`: exact preserved equality, non-empty, max 255 characters, no trim/case-fold;
- `createdFrom`: inclusive RFC3339 timestamp with explicit offset;
- `createdTo`: exclusive RFC3339 timestamp with explicit offset;
- `cursor`: optional A9 cursor;
- `limit`: integer 1..100, default 25.

When both timestamps exist, `createdTo` must be strictly greater than `createdFrom`. Unknown query parameters are invalid. No free-text, fuzzy, customer, metadata, description or provider search exists in V0.

## Filter identity and cursor

Normalized filter identity is SHA-256 over:

```text
a9-filter-v0\nJSON.stringify([
  status_or_null,
  externalId_exact_or_null,
  createdFrom_UTC_ISO_milliseconds_or_null,
  createdTo_UTC_ISO_milliseconds_or_null
])
```

Cursor format is:

`a9v0.<payload-base64url>.<HMAC-SHA256-signature-base64url>`.

Payload is the ordered JSON vector:

```text
[merchantId, environment, filterDigest, cursorCreatedAt, cursorPaymentId]
```

The signature covers the ASCII bytes of `a9v0.<payload-base64url>` and uses a dedicated runtime cursor-integrity key with at least 32 UTF-8 bytes. Tests inject deterministic key material. The key is never a database or response field.

Malformed/tampered cursor, signature failure, scope mismatch or filter mismatch returns `validation_error` before database list access. The cursor is never authorization authority.

## Pagination

Ordering is exactly `created_at DESC, id ASC`.

Rows after a cursor satisfy:

```text
created_at < cursor_created_at
OR (created_at = cursor_created_at AND id > cursor_payment_id)
```

The trusted read returns at most `limit + 1` rows. Application returns the first `limit` and emits a next cursor from the last returned item only when an extra row exists.

There is no OFFSET, page number, total count or snapshot guarantee.

## HTTP behavior

List success is HTTP 200:

```text
{
  items: DashboardTransactionListItem[],
  nextCursor: string | null
}
```

Detail success is HTTP 200 with the direct detail projection. Both success responses use `Cache-Control: private, no-store`.

Stable failures are `400 validation_error`, `401 invalid_session`, `403 forbidden`, `404 resource_not_found`, `503 authentication_unavailable`, and `500 internal_error`.

Missing, foreign-merchant and wrong-environment detail IDs are indistinguishable 404s.

## Application boundary

`packages/payments` must export:

- `validateDashboardTransactionListQuery`
- `createDashboardTransactionCursorCodec`
- `createDashboardTransactionReadService`

`packages/db` must export `createDashboardTransactionStore`.

The read service exposes only `list` and `get`, reuses A6/K4, performs cursor validation before list database access, and has no AAL2 or mutation path.

## Side-effect invariance

A9 reads mutate none of: Payments, ProviderAttempts, ProviderEvents, idempotency, audit, accounts/ledger, payouts/refunds, jobs, webhook state, API credentials or token windows. Reads do not append A9 audit events.

## Fail-first boundary

Before implementation, baseline 226/226 application contracts, 39 files / 1288 pgTAP assertions, K5/K6 and K7/A1/A2/A3/A4/A6/A7/A8 acceptance remain GREEN. New A9 failures must be assertion-level missing behavior/structure, not parser/typecheck/module/harness failures. No hosted A9 migration is allowed before RED -> GREEN proof.