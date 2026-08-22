# SwiftPay V2 — A26 A23 JSONB object-arity runtime fix

Status: FROZEN FOR TDD
Date: 2026-08-21 (America/Santarem)

## Problem

A25 hosted runtime-role E2E reached the real A23 `create_dashboard_payment_link` routine as `swiftpay_api_runtime` and failed with SQLSTATE `42883`:

```text
function pg_catalog.jsonb_object_length(jsonb) does not exist
```

Hosted PostgreSQL inspection proves:

- `pg_catalog.jsonb_object_length(jsonb)`: absent;
- `pg_catalog.jsonb_object_keys(jsonb)`: present;
- exactly two `app` functions reference the nonexistent helper:
  - `app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)`;
  - `app._a23_resolve_payment_link_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)`.

The defect is latent because A23 pgTAP checked structure/authority but did not execute the command-arity and success-resolution branches. A25 is blocked until both paths execute on the canonical PostgreSQL runtime.

## Frozen repair

A26 is DB-only and may only replace the two affected functions with semantically identical definitions where JSON object arity is computed by counting `pg_catalog.jsonb_object_keys(...)`.

No table, column, index, capability, role, route, provider, payment-state, quota, idempotency, pricing, ledger or browser contract may change.

`CREATE OR REPLACE` must preserve function identities and SECURITY DEFINER/empty-search-path posture. ACLs are restated explicitly.

## TDD

A fail-first pgTAP must independently prove:

1. dashboard Payment Link creation with an exact valid five-key command executes and returns `created` rather than `42883`;
2. a prepared/claimed payment-link checkout accepts an exact six-key success resolution and moves Payment to `pending` rather than `42883`;
3. invalid extra-key command/resolution inputs remain rejected so replacing arity logic does not weaken strict schemas;
4. all pre-A26 contracts remain GREEN.

## Hosted acceptance

After repository GREEN, apply one forward migration to canonical `swiftpay v2`, then rerun the A25 runtime-role E2E from the beginning. No manual hot-patch outside migration history is acceptable for this schema behavior repair.
