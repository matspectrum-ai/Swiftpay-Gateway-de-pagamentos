# SwiftPay V2 — A27 A23 COALESCE special-form runtime fix contract v0

Status: Frozen for TDD
Date: 2026-08-21 (America/Santarem)

A27 repairs one PostgreSQL compatibility defect in `app._a23_resolve_payment_link_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)`.

The function currently schema-qualifies SQL `COALESCE` as `pg_catalog.coalesce(...)`. PostgreSQL does not expose that as an ordinary function, so the A23 payment-link resolver fails with SQLSTATE `42883` after the A26 JSONB arity defect is removed.

Exact source review proves six invalid qualifications in this one function: five in the success-resolution field validation and one in definitive-rejection `errorCode` validation.

The implementation contract is exact:

1. `CREATE OR REPLACE` only `_a23_resolve_payment_link_pix_attempt`.
2. Replace exactly six `pg_catalog.coalesce(...)` expressions with ordinary `coalesce(...)` expressions: five in success validation and one in definitive-rejection validation.
3. Preserve the A26 JSONB arity expression based on `pg_catalog.jsonb_object_keys(...)` unchanged.
4. Preserve the function signature, `VOLATILE`, `SECURITY DEFINER`, and `SET search_path = ''`.
5. Preserve every success, execution-unknown, definitive-rejection, idempotency and state-transition branch byte-for-byte except for the six qualification repairs.
6. Restate that PUBLIC/Data API/API/worker roles receive no direct EXECUTE on the internal helper.
7. Do not modify `app.resolve_api_pix_attempt` or any runtime capability manifest.
8. Exact effective capabilities remain 30 `swiftpay_api` and 6 `swiftpay_worker`.
9. A26 database test #047 must become 15/15 GREEN; A27 #048 must become 6/6 GREEN and prove zero invalid `pg_catalog.coalesce` references remain.
10. Hosted application happens only after repository GREEN and before restarting the A25 runtime-role E2E.

A27 does not authorize Production checkout, retained PSP traffic, paid transitions, ledger posting, new Data API authority, or deployment credentials.
