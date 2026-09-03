# A26 Evidence — A23 JSONB Object Arity Runtime Fix

Date: 2026-08-21 (America/Santarem)
Scope: PostgreSQL compatibility repair for A23 hosted Payment Link / checkout functions

## Trigger

A25's first hosted runtime-role smoke reached the real A23 functions and exposed SQLSTATE `42883` because PostgreSQL does not provide `pg_catalog.jsonb_object_length(jsonb)`.

The defect was runtime compatibility, not provider behavior, tenant authority, pricing, or financial state.

## Frozen repair

A26 added one forward migration and replaced only the affected A23 routines:

- `app.create_dashboard_payment_link(...)`;
- `app._a23_resolve_payment_link_pix_attempt(...)`.

Object arity is computed using `count(*)` over `pg_catalog.jsonb_object_keys(jsonb)`.

A26 did not add a compatibility shim under `pg_catalog`, change routine identity, change grants, alter provider activation, or expand runtime capabilities.

Artifacts:

- `docs/design/a26-a23-jsonb-object-arity-runtime-fix-problem-analysis.md`;
- `docs/specs/a23-jsonb-object-arity-runtime-fix-v0.yaml`;
- `docs/contracts/a23-jsonb-object-arity-runtime-fix-v0.md`;
- `supabase/tests/database/047_a23_jsonb_object_arity_runtime_fix.test.sql`;
- `supabase/migrations/20260822025900_a23_jsonb_object_arity_runtime_fix.sql`.

## Formal RED

Database workflow `32545329166`:

- 47 pgTAP files;
- 1397 assertions total;
- existing #001-#046 GREEN;
- A26 #047 produced the intended failures demonstrating the missing JSONB object-arity primitive.

After the A26 migration, Payment Link create coverage became GREEN. Four resolver assertions still failed with SQLSTATE `42883`, exposing the separate `pg_catalog.coalesce(...)` defect later isolated as A27.

## Hosted application

Hosted migration version: `20260822031801_a23_jsonb_object_arity_runtime_fix`.

Repository filename remains `20260822025900_a23_jsonb_object_arity_runtime_fix.sql`.

Post-migration authority remained exact:

- API app EXECUTE: 30;
- worker app EXECUTE: 6;
- Data API app EXECUTE: 0;
- retained provider authority change: 0.

## Final proof

A26 was integrated with A27 into A25 and the final hosted A25 transaction-scoped E2E passed as `swiftpay_api_runtime`.

Integrated database baseline after A27:

- 48 pgTAP files;
- 1403 assertions PASS.

See `docs/evidence/application/2026-08-21-a25-hosted-runtime-identity-sandbox-db-e2e.md` for the final hosted runtime proof.
