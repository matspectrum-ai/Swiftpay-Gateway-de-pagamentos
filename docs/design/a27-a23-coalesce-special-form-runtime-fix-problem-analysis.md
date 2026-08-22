# SwiftPay V2 — A27 A23 COALESCE special-form runtime fix

Status: PROBLEM_ANALYSIS / FROZEN FOR SPEC
Date: 2026-08-21 (America/Santarem)

## Problem

A26 replaced the unsupported `pg_catalog.jsonb_object_length(jsonb)` usage and reduced the A23 behavioral RED from eight failures to four. Dashboard Payment Link creation is now GREEN, but the payment-link success-resolution path still fails with SQLSTATE `42883`.

Hosted inspection of canonical `swiftpay v2` proves:

- `pg_catalog.coalesce(text,text)` does not exist;
- `COALESCE(...)` is a PostgreSQL/SQL conditional expression, not an ordinary schema-qualified function;
- exactly one `app` function contains `pg_catalog.coalesce`: `app._a23_resolve_payment_link_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)`;
- exact source review finds six invalid qualifications in that one function: five in success-resolution field validation and one in definitive-rejection `errorCode` validation.

The remaining A26 failures are therefore an adjacent PostgreSQL compatibility defect, not an arity-regression.

## Decision boundary

A27 is DB-only. It may `CREATE OR REPLACE` only `_a23_resolve_payment_link_pix_attempt` and replace exactly six `pg_catalog.coalesce(...)` calls with ordinary `coalesce(...)` expressions.

A27 must not change function identity, arguments, result type, SECURITY DEFINER posture, empty search_path, idempotency, ProviderAttempt transitions, Payment transitions, public projection, runtime capabilities, Data API authority, provider activation, pricing, ledger behavior, or any HTTP/browser contract.

## TDD

A27 RED is the already-observed A26 behavioral remainder plus a dedicated pgTAP guard that proves the invalid schema-qualified special form remains present before implementation.

GREEN requires:

- A26 #047 15/15 PASS;
- A27 #048 PASS;
- all previous database/application/runtime/K5/K6 contracts PASS;
- exact runtime capabilities remain 30 API / 6 worker;
- zero `pg_catalog.coalesce` references remain in `app` function bodies.

## Hosted acceptance

After repository GREEN, A26 and A27 migrations are applied in order to canonical hosted Supabase. The A25 transaction-scoped runtime-role E2E is then restarted from the beginning. No direct hot patch is acceptable.
