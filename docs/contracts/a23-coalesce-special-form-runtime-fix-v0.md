# SwiftPay V2 — A27 A23 COALESCE special-form runtime fix contract v0

Status: Frozen for TDD
Date: 2026-08-21 (America/Santarem)

A27 repairs one PostgreSQL compatibility defect in `app._a23_resolve_payment_link_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)`.

The function currently schema-qualifies SQL `COALESCE` as `pg_catalog.coalesce(...)`. PostgreSQL does not expose that as an ordinary function, so the A23 payment-link success-resolution branch fails with SQLSTATE `42883` after the A26 JSONB arity defect is removed.

The implementation contract is exact:

1. `CREATE OR REPLACE` only `_a23_resolve_payment_link_pix_attempt`.
2. Replace only the five `pg_catalog.coalesce(...)` expressions in the success-resolution validation with ordinary `coalesce(...)` expressions.
3. Preserve the function signature, `VOLATILE`, `SECURITY DEFINER`, and `SET search_path = ''`.
4. Preserve every success, execution-unknown, definitive-rejection, idempotency and state-transition branch byte-for-byte except for the qualification repair.
5. Restate that PUBLIC/Data API/API/worker roles receive no direct EXECUTE on the internal helper.
6. Do not modify `app.resolve_api_pix_attempt` or any runtime capability manifest.
7. Exact effective capabilities remain 30 `swiftpay_api` and 6 `swiftpay_worker`.
8. A26 database test #047 must become 15/15 GREEN; A27 #048 must prove the invalid qualified form is gone and no financial/provider authority changed.
9. Hosted application happens only after repository GREEN and before restarting the A25 runtime-role E2E.

A27 does not authorize Production checkout, retained PSP traffic, paid transitions, ledger posting, new Data API authority, or deployment credentials.
