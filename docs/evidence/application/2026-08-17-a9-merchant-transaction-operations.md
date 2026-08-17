# A9 — Merchant transaction operations — GREEN / HOSTED

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
Status: **DONE / GREEN / HOSTED**

## Contract authority

- Problem Analysis: `docs/design/a9-merchant-transaction-operations-problem-analysis.md`
- Spec: `docs/specs/merchant-transaction-operations-v0.yaml`
- HTTP/application contract: `docs/contracts/merchant-transaction-operations-v0.md`
- Database contract: `docs/contracts/merchant-transaction-operations-database-v0.md`
- RED evidence: `docs/evidence/application/2026-08-17-a9-merchant-transaction-operations-red.md`

A9 adds only dashboard read visibility over canonical Payment state. It does not add Payment status mutation, PSP transport, recovery commands, reconciliation commands or monetary authority.

## Implemented behavior

- dashboard-only transaction list and detail GET routes;
- ordinary A6 online dashboard session verification plus current K4 member authority;
- no AAL2 read requirement and no A1 machine-token fallback;
- exact status, externalId and created-time filtering;
- deterministic keyset pagination by `created_at DESC, id ASC`;
- authenticated `a9v0` HMAC-SHA256 cursor using dedicated `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY`;
- cursor bound to merchant/environment and normalized filters;
- list projection excludes Pix instructions, customer snapshot/PII, metadata and provider/execution internals;
- detail exposes only normalized complete Pix instructions for canonical pending/paid Payments;
- canonical Payment status remains authoritative, including `execution_unknown -> creating` and paid status retained across refunds with separate `refundedAmount`;
- exactly two trusted read RPCs and no direct protected-table runtime authority;
- status and exact-externalId query indexes, with digest plus original-text equality for arbitrarily long external IDs;
- zero read-side financial/provider/idempotency/audit/job/webhook/credential mutations.

## Final CI proof

Behavioral GREEN head before hosted timestamp alignment: `f846a50f2c8afe8f5561a59aebef8574e22ac6d6`.

Application workflow `32009421604`: **GREEN**.

- typecheck: PASS;
- build: PASS;
- application contracts: **240/240 PASS**;
- real PostgreSQL acceptance: K7, A1, A2, A3, A4, A6, A7, A8 and A9 all PASS.

Database workflow `32009421592`: **GREEN**.

- pgTAP: **40 files / 1292 assertions PASS**;
- K5 deterministic sandbox fixtures: PASS;
- K6 runtime topology: PASS.

The final A9 acceptance includes member Sandbox/Production reads, nonmember rejection, missing/machine dashboard-session rejection, deterministic pagination, insertion between pages without duplication, exact externalId case/whitespace semantics, 5000-character externalId lookup, time bounds, cursor tamper/filter/scope rejection, privacy projection checks, normalized Pix detail, refund projection, `creating` ambiguity preservation and indistinguishable absent/foreign/wrong-environment detail.

## Hosted Supabase deployment

Canonical project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

Hosted migration:

- `20260817081745_merchant_transaction_operations.sql`

Hosted audit after deployment:

- `app.list_dashboard_transactions(...)`: present, `SECURITY DEFINER`, `search_path=''`;
- `app.get_dashboard_transaction(uuid,uuid,text,uuid)`: present, `SECURITY DEFINER`, `search_path=''`;
- `payments_merchant_created_idx`: retained;
- `payments_dashboard_status_created_idx`: present;
- `payments_dashboard_external_id_created_idx`: present;
- `swiftpay_api`: exact **23** `app` EXECUTE capabilities;
- `swiftpay_worker`: exact **6** `app` EXECUTE capabilities;
- API can execute exactly the two A9 routines; worker cannot execute either;
- direct protected-table runtime privileges observed for audited A9/financial tables: **0**;
- hosted `app.payments` rows: **0**;
- hosted `app.provider_attempts` rows: **0**;
- Security Advisor: **0 lints**.

Performance Advisor remains INFO-only. It reports pre-existing unindexed-FK/unused-index observations plus the two newly created A9 indexes as unused, which is expected while hosted Payment count is zero. No unrelated optimization was performed without measured workload evidence.

## Production blocker unchanged

A9 does not authorize live PSP traffic. Current provider-owned contract evidence/lineage/recovery/webhook semantics for retained AkkadPag/AkadPay and FlevoPay remain the critical external blocker. A5 remains fixture-only for live-provider authority.
