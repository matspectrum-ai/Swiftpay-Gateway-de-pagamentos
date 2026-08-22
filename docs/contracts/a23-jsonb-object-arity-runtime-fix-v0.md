# SwiftPay V2 — A26 A23 JSONB object-arity runtime fix contract v0

Status: Frozen for TDD
Date: 2026-08-21 (America/Santarem)

A26 repairs exactly two A23 function bodies that call a nonexistent PostgreSQL helper. It introduces no new product capability.

## Required implementation

One forward migration must `CREATE OR REPLACE`:

- `app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)`;
- `app._a23_resolve_payment_link_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)`.

Every A23 behavior remains byte/field compatible except the internal object-key count expression.

The replacement arity expression must derive cardinality from:

```sql
select count(*) from pg_catalog.jsonb_object_keys(<jsonb object>)
```

and must not add a compatibility function to `pg_catalog`.

## Payment Link command contract

`create_dashboard_payment_link` still accepts only a JSON object containing exactly four required keys plus optional `publicToken`:

- `amount`;
- `currency`;
- `description`;
- `pixExpirationMinutes`;
- optional `publicToken`.

A valid five-key Sandbox command returns `kind=created`. Any sixth/unknown key returns `kind=validation_error`. Production remains `kind=forbidden`. Existing idempotency/token collision/replay semantics are unchanged.

## Payment-link resolution contract

For a `source='payment_link'` Payment whose ProviderAttempt is owned by the supplied execution token, success resolution still requires exactly six keys:

- `certainty=success`;
- `providerPaymentId`;
- `txId`;
- `copyAndPaste`;
- `qrCode`;
- `expiresAt`.

A valid success moves ProviderAttempt `executing -> succeeded`, Payment `creating -> pending`, and completes the checkout idempotency snapshot. A seventh/unknown key remains invalid with SQLSTATE `22023`.

No A26 path may transition Payment to `paid`, create ledger state, or call a provider.

## Function/security identity

Both affected functions retain:

- the same argument/return identities;
- `SECURITY DEFINER`;
- empty fixed `search_path`;
- existing API-only effective authority;
- no Data API/PUBLIC/worker authority.

The canonical runtime capability set remains exactly 30 API / 6 worker.

## RED proof

The A26 pgTAP must construct one synthetic Sandbox merchant/user/emulator fixture inside a transaction and independently exercise:

1. valid dashboard link creation;
2. extra-key link command rejection;
3. direct synthetic Payment Link prepare + claim + valid success resolution;
4. extra-key success resolution rejection on a second prepared/claimed checkout or isolated equivalent;
5. no paid/ledger side effect.

Before implementation the valid-create and valid-resolution cases must expose the `42883` missing-function defect. No unrelated test may fail.

## GREEN/hosted proof

After migration GREEN:

- all pgTAP/application/runtime/K5/K6 checks are GREEN;
- hosted migration is applied;
- no capability/authority count changes;
- A25 hosted runtime-role E2E is rerun from Payment Link creation through completed replay and rollback.
