# SwiftPay V2 — A9 Merchant Transaction Operations Database Contract

Status: **FROZEN FOR TDD**  
Date: 2026-08-17  
Parent contract: `docs/contracts/merchant-transaction-operations-v0.md`

## Trusted routine signatures

A9 adds exactly two trusted read routines. These signatures are exact and have no V0 overloads.

```text
app.list_dashboard_transactions(
  actor_user_id uuid,
  merchant_id uuid,
  environment text,
  status text,
  external_id text,
  created_from timestamptz,
  created_to timestamptz,
  cursor_created_at timestamptz,
  cursor_payment_id uuid,
  limit integer
)

app.get_dashboard_transaction(
  actor_user_id uuid,
  merchant_id uuid,
  environment text,
  transaction_id uuid
)
```

Optional filters/cursor fields are passed as null. `cursor_created_at` and `cursor_payment_id` must either both be null or both be non-null.

## List return contract

`app.list_dashboard_transactions` returns one JSON array containing at most `limit + 1` merchant-safe list projections.

The database validates:

- actor/merchant/environment through K4 `member` authorization;
- environment is Sandbox or Production;
- optional status is canonical;
- optional external ID is non-empty and max 255 characters;
- created range is valid and upper bound is greater than lower bound when both exist;
- cursor key pair is complete;
- limit is 1..100.

Predicates are exact:

```text
merchant_id = requested merchant
environment = requested environment
status null OR collection_status = status
external_id null OR external_id = external_id
created_from null OR created_at >= created_from
created_to null OR created_at < created_to
cursor null OR created_at < cursor_created_at
             OR (created_at = cursor_created_at AND id > cursor_payment_id)
```

Ordering is exactly `created_at DESC, id ASC`.

The list routine never returns normalized Pix QR/copy-paste payloads.

## Detail return contract

`app.get_dashboard_transaction` returns the merchant-safe detail JSON projection or SQL/JSON null when no exact merchant/environment/id row exists.

Foreign merchant, wrong environment and missing ids therefore share one absence result at the application boundary.

Normalized `pix` may be returned only for a canonical `pending` or `paid` Payment with a complete succeeded ProviderAttempt Pix payload.

## Authorization and privilege contract

Both routines are `STABLE SECURITY DEFINER` with a fixed search path and independently call the existing dashboard merchant-context authorization boundary using required role `member`.

Only `swiftpay_api` receives EXECUTE on the two public A9 routines.

PUBLIC, anon, authenticated, service_role and swiftpay_worker receive no A9 EXECUTE capability. Private `_a9_*` helpers are executable by neither runtime role.

Expected post-A9 app routine capability counts:

```text
swiftpay_api = 23
swiftpay_worker = 6
```

Neither runtime receives direct SELECT/INSERT/UPDATE/DELETE on `app.payments` or `app.provider_attempts` as part of A9.

## Projection privacy contract

The database projection must omit customer snapshot, metadata, provider identity/account/payment id, raw provider status, provider cost, routing/pricing/settlement internals, execution tokens, leases and internal provider error fields.

`status` comes only from Payment `collection_status`; ProviderAttempt state cannot replace it.

`refundedAmount` comes from `refunded_amount_cents` and does not rewrite a paid Payment status.

## Index contract

A9 preserves `payments_merchant_created_idx` and adds exactly the query-supporting indexes:

```text
payments_dashboard_status_created_idx
  (merchant_id, environment, collection_status, created_at DESC, id ASC)

payments_dashboard_external_id_created_idx
  (merchant_id, environment, external_id, created_at DESC, id ASC)
  WHERE external_id IS NOT NULL
```

No description, customer, metadata or provider search index belongs to A9.

## Transaction/side-effect contract

Both routines are reads only. They append no audit event and mutate no Payment, provider, ledger, payout/refund, idempotency, job, webhook or credential state.