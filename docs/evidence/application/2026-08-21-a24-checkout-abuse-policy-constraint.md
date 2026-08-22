# A24 — Checkout abuse-policy constraint repair — final evidence

Date: 2026-08-21 (America/Santarem)
Status: DONE / GREEN / HOSTED / DATABASE-ONLY

## Trigger

After A23 repository/CI GREEN, the two A23 migrations were applied to canonical hosted Supabase project `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`). Exact capability attestation reached 30 API / 6 worker with missing 0 / extra 0, zero Data API `app` EXECUTE, zero direct protected-table privileges for runtime roles and zero Payment/ProviderAttempt rows.

The first hosted checkout admission smoke then exposed a real defect: `app.consume_api_abuse_quota('checkout_request_pre_auth', ...)` failed with SQLSTATE `23514` because `app.api_abuse_windows_policy_check` still contained only the pre-A23 policy vocabulary.

No Payment, ProviderAttempt, payment-link, ledger or provider state was created by the failed smoke.

## Frozen A24 repair

Artifacts:

- Problem Analysis: `docs/design/a24-checkout-abuse-policy-constraint-problem-analysis.md`
- Spec: `docs/specs/checkout-abuse-policy-constraint-v0.yaml`
- Contract: `docs/contracts/checkout-abuse-policy-constraint-v0.md`
- pgTAP: `supabase/tests/database/046_checkout_abuse_policy_constraint.test.sql`
- Migration: `supabase/migrations/20260822012000_checkout_abuse_policy_constraint.sql`

The migration changes only `app.api_abuse_windows_policy_check`. It preserves the six existing policies and adds exactly `checkout_request_pre_auth`. It does not modify the quota function, limits, HMAC continuity, runtime capability set, provider authority or financial behavior.

## TDD RED

Database workflow: `32542942243`.

- existing database tests `001` through `045`: GREEN;
- K5 sandbox fixtures: GREEN;
- K6 runtime topology: GREEN;
- new A24 test `046`: 10/14 PASS, exactly four intended failures;
- failed assertions were #6 and #9-#11: missing checkout policy, real checkout quota call rejected, no row materialized, no request count.
- full run: 46 files / 1382 assertions, RED only on the frozen A24 absence.

Application workflow: `32542942244`; no A24 application behavior was implemented.

## GREEN

Implementation head before final documentation: `c0502bbcc807feb7e879265be7cdf2e866d0f379`.

Application workflow `32543077528`:

- frozen dependency install GREEN;
- typecheck GREEN;
- build GREEN;
- application contracts GREEN;
- real PostgreSQL acceptance GREEN for K7, A14, A18, A1, A2, A3, A4, A6, A7, A8 and A9.

Database workflow `32543077585`:

- 46/46 database files GREEN;
- 1382/1382 pgTAP assertions PASS;
- A24 `046`: 14/14 PASS;
- K5 deterministic fixtures GREEN;
- K6 exact runtime topology GREEN.

## Hosted deployment and smoke

Canonical hosted project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

A23 repository migrations were first applied to hosted Supabase as migration-history entries:

- `20260822011210_hosted_pix_checkout_payment_links`
- `20260822011224_a23_checkout_quota_special_forms_fix`

A24 was then applied as:

- `20260822012110_checkout_abuse_policy_constraint`

Post-A24 hosted checkout quota smoke returned:

- `allowed = true`
- `remaining = 119`
- `retry_after_seconds = 0`

Unknown/nonexistent payment-link lookup remained `null` / `not_found`. The smoke was wrapped in rollback; post-smoke state remained:

- checkout smoke quota rows: 0
- Payment Links: 0
- Payments: 0
- ProviderAttempts: 0

The Supabase connector cannot `SET ROLE swiftpay_api` (`42501`), so the hosted functional smoke executed through the administrative connector session. Runtime-role authority was independently attested with PostgreSQL privilege inspection.

## Final hosted authority attestation

After A24:

- `swiftpay_api` `app` EXECUTE capabilities: exactly 30;
- `swiftpay_worker` `app` EXECUTE capabilities: exactly 6;
- `checkout_request_pre_auth` present in the persisted CHECK: yes;
- Data API (`anon`, `authenticated`, `service_role`) `app` EXECUTE count: 0;
- direct API/worker protected-table privileges: 0 at the A23 post-DDL attestation;
- Payments: 0;
- ProviderAttempts: 0;
- retained PSP monetary traffic: 0.

Security Advisor reports one informational `rls_enabled_no_policy` item for `app.payment_links`. This matches the current private deny-all table posture: RLS is enabled, Data API/table privileges are absent and access is through trusted SECURITY DEFINER routines. It is recorded rather than altered outside a dedicated contract.

## Result

A23 is now database-hosted for its Sandbox-only scope, and A24 closes the admission-control defect found by the first hosted smoke. Production checkout remains fail-closed because retained-provider current-contract and authenticated-sandbox evidence are still not closed.
