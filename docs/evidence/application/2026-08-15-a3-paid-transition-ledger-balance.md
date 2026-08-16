# SwiftPay V2 — A3 Paid Transition, Ledger and Balance Evidence

Date: 2026-08-15
Slice: `paid-transition-ledger-balance-v0`
Status: DONE

## Scope accepted

A3 closes the first canonical money-state transition for the deterministic sandbox Pix path. It accepts trusted worker-side paid evidence, moves an eligible Pix Payment to `paid`, posts the corresponding double-entry ledger effect exactly once, exposes merchant balance through the trusted API boundary, and persists a `payment.paid` outbox event for A4 delivery.

This slice does not deliver merchant webhooks over HTTP and does not call a live PSP.

## Canonical specification and contracts

- Spec: `docs/specs/paid-transition-ledger-balance-v0.yaml`
- Database schema contract: `supabase/tests/database/034_paid_transition_ledger_balance_schema.test.sql`
- Database behavior contract: `supabase/tests/database/035_paid_transition_ledger_balance_behavior.test.sql`
- Application financial adapter contracts: `tests/application/018_a3_financial_adapters.contract.test.mjs`
- Balance HTTP contracts: `tests/application/019_a3_balance_http.contract.test.mjs`
- Runtime wiring contracts: `tests/application/020_a3_runtime_wiring.contract.test.mjs`
- Real runtime acceptance: `tests/application/021_a3_real_runtime_acceptance.sh`

## Implemented invariants

- Only the trusted worker capability may submit sandbox paid evidence.
- Merchant/API callers cannot mark Payments paid.
- The Payment row is the serialization point for concurrent paid evidence.
- Evidence identity is persisted in `ProviderEvent` and replayed evidence cannot post money twice.
- `pending` and eligible `expired` sandbox emulator Payments may transition to `paid`; incompatible states/evidence are rejected or absorbed according to the frozen contract.
- The Payment settlement policy is snapshotted as `sandbox-pending-settlement-v0`.
- Exactly one `settlement_paid` ledger transaction is associated with the Payment.
- Ledger entries remain balanced and use the canonical account helpers/locking path.
- Merchant funds first enter `merchant_pending_liability`; A3 does not promote them to available/withdrawable settlement.
- `GET /v1/balance` derives merchant/environment exclusively from the revalidated A1 Bearer principal.
- Balance keeps `pendingSettlement`, `available`, `reserved`, payout/refund blocked buckets, `withdrawable`, and `totalMerchantFunds` distinct.
- The public paid Payment projection preserves normalized Pix data and excludes provider cost, provider-account identity, settlement policy and other internals.
- `payment.paid` is written transactionally to the existing merchant webhook outbox. HTTP signing/delivery is intentionally deferred to A4.

## Canonical hosted Supabase migrations

Applied to project `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`):

- `20260816004515_paid_transition_ledger_balance_foundation.sql`
- `20260816004620_paid_transition_ledger_balance_behavior.sql`

The Git migration filenames were atomically aligned to those hosted versions in commit `0f1027dd045dbe6fa8b3fca6ab27b6ff8ddcb485`; SQL blob contents were unchanged during the rename.

Hosted verification after migration application:

- `settlement_policy_version` exists on `app.payments`.
- `swiftpay_worker` has EXECUTE on `app.apply_sandbox_pix_paid(...)`.
- `swiftpay_api`, `anon`, `authenticated` and `service_role` do not have that capability.
- `swiftpay_api` has EXECUTE on `app.get_api_balance(uuid,text)`.
- `swiftpay_worker`, `anon`, `authenticated` and `service_role` do not have that capability.
- `_a2_public_payment_json(uuid)` is not executable by API or worker roles directly.
- migration application itself created zero `settlement_paid` ledger transactions, zero `pix_paid` ProviderEvents and zero `payment.paid` webhook events.
- Supabase Security Advisor returned no lints after the A3 DDL.

No A3 runtime fixture, emulator provider account, API credential or webhook endpoint was inserted into the canonical hosted project.

## Final database acceptance

Database workflow: `31885388900` — GREEN.

Accepted result:

- 35 pgTAP files;
- 1209 database assertions;
- all tests successful / PASS;
- K5 deterministic sandbox fixture lane GREEN;
- K6 runtime-topology / least-privilege lane GREEN.

The A3 database contracts prove the paid transition, evidence replay semantics, double-entry posting, balance projection, outbox identity and role isolation.

## Final application/runtime acceptance

Application workflow: `31885388887` — GREEN.

Application contract lane:

- 104 tests;
- 104 pass;
- 0 fail.

The real runtime database acceptance job passed, in order:

- `SwiftPay K7 real runtime database acceptance: OK`
- `SwiftPay A1 real runtime acceptance: OK`
- A1 quota race: `200/429`
- A2 create race: `201/202`
- `SwiftPay A2 real runtime acceptance: OK`
- A3 paid-evidence race: `applied/absorbed`
- `SwiftPay A3 real runtime acceptance: OK`

The A3 acceptance uses the production-like `swiftpay_api_runtime` and `swiftpay_worker_runtime` identities against one isolated PostgreSQL database. Two independent worker processes race distinct valid paid observations for one Payment; exactly one applies the monetary transition and the other is absorbed. The merchant then observes the paid Payment and balance only through authenticated API calls.

## Atomicity and side-effect proof

For the accepted A3 runtime Payment the harness verifies:

- exactly one canonical Payment reaches `paid`;
- exactly one `settlement_paid` ledger transaction exists;
- exactly one merchant pending-liability credit is produced for the merchant net amount;
- duplicate/concurrent evidence cannot double-credit;
- exactly one canonical `payment.paid` webhook outbox event exists;
- balance reports the credited amount as pending settlement rather than available/withdrawable;
- API and worker identities remain capability-separated;
- no live provider/network payment operation is introduced.

## Explicitly outside A3

Still pending after this slice:

- merchant webhook HTTP signing/delivery/retry/dead-letter runtime (A4);
- settlement promotion from pending to available;
- live PSP paid-webhook ingress and signature verification;
- AkkadPag/FlevoPay adapter conformance and live calls;
- provider timeout/recovery/reconciliation against real PSP behavior;
- merchant/admin operational UI and production observability/cutover.

## Closure

A3 is accepted as DONE. The next critical slice is A4 merchant webhook delivery runtime, consuming the durable `payment.paid` outbox state without weakening the exactly-once financial boundary established here.
