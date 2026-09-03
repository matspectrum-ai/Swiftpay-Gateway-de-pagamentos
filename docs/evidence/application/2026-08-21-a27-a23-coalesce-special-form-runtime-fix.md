# A27 Evidence — A23 COALESCE Special-Form Runtime Fix

Date: 2026-08-21 (America/Santarem)
Scope: PostgreSQL compatibility repair for A23 resolver

## Trigger

After A26 repaired JSONB object arity, four hosted/runtime resolver assertions still failed with SQLSTATE `42883` because A23 qualified `COALESCE` as `pg_catalog.coalesce(...)`.

`COALESCE` is a SQL special form and cannot be schema-qualified as a normal function.

Exact affected count after inspection: six references in `app._a23_resolve_payment_link_pix_attempt(...)`:

- five in success-resolution validation;
- one in definitive-rejection `errorCode` validation.

## Frozen repair

A27 `CREATE OR REPLACE`s only `app._a23_resolve_payment_link_pix_attempt(...)` and replaces exactly those six invalid `pg_catalog.coalesce(...)` references with ordinary `coalesce(...)`.

The A26 JSONB-key-count expression is preserved.

Artifacts:

- `docs/design/a27-a23-coalesce-special-form-runtime-fix-problem-analysis.md`;
- `docs/specs/a23-coalesce-special-form-runtime-fix-v0.yaml`;
- `docs/contracts/a23-coalesce-special-form-runtime-fix-v0.md`;
- `supabase/tests/database/048_a23_coalesce_special_form_runtime_fix.test.sql`;
- `supabase/migrations/20260822030500_a23_coalesce_special_form_runtime_fix.sql`.

## Formal RED

A27 RED baseline:

- 48 pgTAP files;
- 1403 assertions total;
- #001-#046 GREEN;
- #047 retained the four resolver failures from the invalid qualification;
- #048 produced exactly two intended qualification failures;
- K5, K6 and application/runtime acceptance remained GREEN.

## GREEN

A27 GREEN:

- database pgTAP: **48 files / 1403 assertions PASS**;
- #047: 15/15 PASS;
- #048: 6/6 PASS;
- application contracts GREEN;
- runtime database acceptance GREEN;
- K7/A14/A18/A1-A9 GREEN;
- K5 GREEN;
- K6/runtime topology GREEN.

A27 merged into A26 with merge SHA `c23c55c04f39a5fff82ce92d3ac98cf04cd5dbd7`.

A26+A27 merged into A25 with SHA `ea1914bc9a9c50f2bcb1f67585350bef098555f9`.

## Hosted application

Hosted migration version: `20260822031818_a23_coalesce_special_form_runtime_fix`.

Repository filename remains `20260822030500_a23_coalesce_special_form_runtime_fix.sql`.

Post-migration attestation:

- invalid A23 compatibility references: 0;
- API app EXECUTE: 30;
- worker app EXECUTE: 6;
- Data API app EXECUTE: 0;
- retained provider authority change: 0.

## Final proof

The final hosted A25 Sandbox transaction ran successfully as `swiftpay_api_runtime`, including Payment Link creation, checkout prepare, claim, resolver success, replay/conflict invariants, tenant denial and clean rollback.

See `docs/evidence/application/2026-08-21-a25-hosted-runtime-identity-sandbox-db-e2e.md`.
