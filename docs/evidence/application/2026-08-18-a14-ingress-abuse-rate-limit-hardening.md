# A14 — Ingress Abuse / Rate-Limit Hardening — Final Evidence

Date: 2026-08-18  
Status: **DONE / GREEN / HOSTED**  
Branch: `agent/foundation-phase-0`

## Scope

A14 adds a fail-closed ingress/admission-control layer for public machine, dashboard and readiness boundaries without changing provider or financial authority.

Canonical planning/contract artifacts:

- Problem Analysis: `docs/design/a14-ingress-abuse-rate-limit-hardening-problem-analysis.md`
- Specification: `docs/specs/ingress-abuse-rate-limit-hardening-v0.yaml`
- Contract: `docs/contracts/ingress-abuse-rate-limit-hardening-v0.md`
- Application contracts: `tests/application/054_a14_ingress_abuse_rate_limit_hardening.contract.test.mjs`
- DB adapter contracts: `tests/application/055_a14_abuse_database_adapter.contract.test.mjs`
- Runtime acceptance driver: `tests/application/056_a14_ingress_abuse_runtime_driver.mjs`
- Runtime acceptance wrapper: `tests/application/056_a14_ingress_abuse_runtime_acceptance.sh`
- pgTAP contract: `supabase/tests/database/041_ingress_abuse_rate_limit_hardening.test.sql`
- Migration: `supabase/migrations/20260818040000_ingress_abuse_rate_limit_hardening.sql`

## Accepted behavior

- No generic Fastify `trustProxy: true` authority.
- `SWIFTPAY_TRUSTED_PROXY_IPS` accepts only a bounded exact canonical IP list.
- `SWIFTPAY_ABUSE_HMAC_KEY` is a dedicated API-side HMAC authority with no fallback to unrelated signing keys.
- Raw client IPs and merchant identifiers are not persisted by the limiter; deterministic HMAC-SHA256 subjects are used instead.
- One distributed PostgreSQL fixed-window limiter is shared across API instances.
- Frozen 60-second policies:
  - `token_exchange_pre_auth`: 30/min per resolved network subject, before expensive A1 credential work;
  - `machine_request_pre_auth`: 12000/min per resolved network subject, before bearer DB revalidation;
  - `machine_read`: 6000/min per merchant/environment;
  - `machine_mutation`: 3000/min per merchant/environment;
  - `dashboard_request_pre_auth`: 300/min per resolved network subject, before Supabase/K4/business work;
  - `readiness_probe`: 120/min per resolved network subject, before readiness DB probe.
- `/health/live` is intentionally independent from limiter availability.
- Quota denial is deterministic HTTP 429 with `Retry-After` and `rate_limit_exceeded`.
- Limiter unavailability/malformed decision fails closed as sanitized HTTP 503 `request_admission_unavailable`.
- The pre-existing A1 successful-token issuance quota remains 10/hour after credential/secret/IP authorization; A14 does not weaken or replace it.
- `app.api_abuse_windows` is private and keyed only by `(policy, subject_hash)`.
- `app.consume_api_abuse_quota(text,text)` is `SECURITY DEFINER`, `VOLATILE`, and fixes `search_path=''`.
- Runtime EXECUTE authority for the A14 RPC is `swiftpay_api` only.
- One consume opportunistically prunes at most 32 rows older than 24 hours.
- Row locking preserves fixed-window concurrency semantics.
- A14 adds no provider call, provider credential, Payment mutation, ledger mutation, payout/refund mutation, webhook authority or worker-side abuse authority.

## Final CI proof

Behavior/evidence head before this evidence-only commit: `d12d05016019cf07065da141e0a5d4e7abecc58a`.

### Application workflow

GitHub Actions run `32103726491`: **GREEN**.

- frozen dependency install: GREEN;
- TypeScript typecheck: GREEN;
- build: GREEN;
- application contracts: **306/306 PASS**;
- K7 real runtime database acceptance: GREEN;
- A1 real token authentication acceptance: GREEN;
- A2 real Pix runtime acceptance: GREEN;
- A3 real paid/ledger/balance acceptance: GREEN;
- A4 real merchant webhook acceptance: GREEN;
- A6 dashboard authorization acceptance: GREEN;
- A7 webhook endpoint management acceptance: GREEN;
- A8 API credential management acceptance: GREEN;
- A9 dashboard transaction acceptance: GREEN;
- A14 distributed fixed-window acceptance: `A14_ACCEPTANCE_OK distributed fixed-window abuse behavior`.

### Database workflow

GitHub Actions run `32103726496`: **GREEN**.

- deterministic sandbox fixtures / K5: GREEN;
- production-like runtime topology / K6: GREEN;
- pgTAP: **41 files / 1298 assertions PASS**.

### Evidence-head verification

The documentation/handoff head was rerun after final evidence/checklist/readiness/TODOS synchronization and remained fully GREEN:

- Application workflow `32104297491`: **GREEN** — typecheck/build + **306/306 application contracts**, K7 and A1-A9/A14 real-database acceptance all PASS;
- Database workflow `32104297387`: **GREEN** — K5 deterministic fixtures, K6 runtime topology and **41 files / 1298 pgTAP assertions PASS**.

This confirms that final evidence and handoff-only commits introduced no behavior or schema regression.

## Compatibility synchronization during GREEN

A14 legitimately expands the exact `swiftpay_api` RPC allowlist from 23 to 24 by adding only `app.consume_api_abuse_quota(text,text)`. Several historical acceptance assertions froze the prior count and were synchronized without widening the actual contract beyond A14:

- `supabase/tests/database/028_trusted_runtime_database_boundary_schema.test.sql`;
- `supabase/tests/database/034_paid_transition_ledger_balance_schema.test.sql`;
- `tests/application/046_a8_api_credential_management_runtime_acceptance.sh`;
- `tests/application/049_a9_merchant_transaction_operations_runtime_acceptance.sh`.

K7 wrong-runtime readiness acceptance was also updated to the stricter A14 semantics: if the API is deliberately booted with the worker DB identity, A14 fails closed before the readiness probe because the worker lacks the abuse-quota RPC; liveness remains independent and the public response remains sanitized.

One superseded runtime run (`32102923764`) observed `A8_ACCEPTANCE_FAIL concurrent_limit_created_6` during an A8 concurrency acceptance. It was not accepted as GREEN. The final clean head reran the full chain and A8 passed, followed by A9 and A14. Final closure relies only on the clean final runs listed above.

## Hosted Supabase proof

Canonical project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

The exact repository migration was applied successfully. Hosted migration history records:

- `20260818054252_ingress_abuse_rate_limit_hardening`

Post-deploy SQL verification proved:

- `app.api_abuse_windows` exists;
- `app.consume_api_abuse_quota(text,text)` exists;
- function is `SECURITY DEFINER`;
- function is `VOLATILE`;
- function has `search_path=''`;
- function result is exactly `TABLE(allowed boolean, remaining integer, retry_after_seconds integer)`;
- hosted `swiftpay_api` has exactly **24** `app` EXECUTE capabilities;
- hosted `swiftpay_worker` remains exactly **6**;
- `swiftpay_api` can execute the A14 RPC;
- `swiftpay_worker` cannot execute the A14 RPC;
- forbidden A14 function EXECUTE ACL entries for `PUBLIC`, `anon`, `authenticated`, `service_role`, and `swiftpay_worker`: **0**;
- forbidden direct A14 table privilege entries for `PUBLIC`, `anon`, `authenticated`, `service_role`, `swiftpay_api`, and `swiftpay_worker`: **0**;
- A14 abuse-window rows immediately after deploy: **0**;
- hosted Payment rows after deploy: **0**;
- hosted ProviderAttempt rows after deploy: **0**.

Supabase Security Advisor after deployment: **0 lints**.

Performance Advisor still reports INFO-level pre-existing optimization items such as unindexed foreign keys and unused indexes. Those remain a separately measured performance-hardening backlog and are not widened into A14.

## Authority and readiness conclusion

A14 closes the public ingress/rate-limit hardening slice and is **DONE / GREEN / HOSTED**.

It does **not** change retained-provider authority. A5 remains fixture-only, A10 still authorizes zero checked-in retained-provider runtime operations, and A11 remains unbound from A5 adapters. No real AkkadPag/AkadPay/FlevoPay monetary call was introduced.

Readiness therefore remains conservatively unchanged:

- core architecture/domain/database/platform: ~99%;
- first end-to-end Pix sandbox MVP: ~97%;
- production-capable Pix V1: ~60%;
- weighted V1 engineering completion: ~75%.

The highest-value critical path remains current provider-owned contract/lineage evidence plus authenticated current sandbox proof before any A10 promotion or A5→A11 bridge.