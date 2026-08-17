# SwiftPay V2 — V1 Readiness Status

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
PR: #1 — draft  
`main`: intentionally untouched

## Executive checkpoint

Conservative risk/effort-weighted readiness remains:

- core architecture/domain/database/platform foundation: **~99%**;
- first end-to-end Pix sandbox MVP: **~96%**;
- production-capable Pix V1: **~58%**;
- weighted V1 engineering completion: **~73%**.

These estimates intentionally do not increase for A9 planning/TDD work before implementation is GREEN.

## Proven executable path

K1-K7 and A1-A8 are DONE. A5 remains fixture-only for live-provider authority.

The branch proves:

1. API credential `client_credentials` -> 900-second machine Bearer token;
2. authenticated/idempotent Pix Payment creation;
3. deterministic visibly non-payable sandbox emulator;
4. authenticated Payment retrieval;
5. worker trusted paid evidence with replay/concurrency absorption;
6. exactly one `settlement_paid` double-entry posting;
7. authenticated merchant balance;
8. transactional `payment.paid` outbox;
9. signed/fenced/retried merchant webhook delivery;
10. network-free retained-provider conformance fixtures;
11. online-verified Supabase dashboard sessions + K4 current membership/role authorization;
12. hosted webhook endpoint lifecycle administration;
13. hosted API credential lifecycle administration with AAL2 mutation step-up and immediate A1 token invalidation on rotation/revocation.

## A8 hosted baseline

A8 final GREEN head: `d74624198918aca53a3769334aeb6b8adbba8092`.

- Application workflow `32001023852`: **226/226 PASS**, including K7/A1/A2/A3/A4/A6/A7/A8 real-database acceptance.
- Database workflow `32001023848`: **39 files / 1288 pgTAP assertions PASS**, K5 fixtures and K6 topology.
- Hosted `swiftpay_api`: exact **21** `app` EXECUTE capabilities.
- Hosted `swiftpay_worker`: exact **6**.
- Security Advisor: **0 lints**.

Hosted A8 migrations:

- `20260817061316_api_credential_management_foundation.sql`
- `20260817061346_api_credential_management_create.sql`
- `20260817061415_api_credential_management_behavior.sql`

## A9 — merchant transaction operations

Status: **TDD_RED**.

Frozen artifacts:

- Problem Analysis: `docs/design/a9-merchant-transaction-operations-problem-analysis.md`
- YAML spec: `docs/specs/merchant-transaction-operations-v0.yaml`
- application/HTTP contract: `docs/contracts/merchant-transaction-operations-v0.md`
- database contract: `docs/contracts/merchant-transaction-operations-database-v0.md`
- RED evidence: `docs/evidence/application/2026-08-17-a9-merchant-transaction-operations-red.md`

A9 V0 is a dashboard-only, read-only transaction list/detail surface over canonical Payment state. It adds no Payment status mutation, provider recovery command or other monetary capability.

Critical frozen properties:

- ordinary A6 online session verification + current K4 member authority;
- no AAL2 requirement for reads and no machine-token fallback;
- canonical Payment status only; `execution_unknown` remains `creating`;
- refunds projected separately through `refundedAmount`;
- no customer snapshot, metadata or provider/execution internals;
- exact status/externalId/date filters only;
- deterministic keyset pagination by `created_at DESC, id ASC`;
- HMAC-SHA256 authenticated scope/filter-bound cursor;
- exactly two planned trusted read RPCs;
- post-A9 target capabilities: API 23, worker unchanged at 6;
- fixed-width externalId digest-expression index plus mandatory exact original equality, preserving A2 compatibility for arbitrarily long pre-existing external IDs;
- zero financial/provider/idempotency/audit/job/webhook/credential side effects.

Clean RED:

- Application workflow `32005108260`: typecheck/build GREEN; **226 prior contracts PASS + 10 A9 expected FAIL**.
- Runtime-database acceptance job `95312863871`: K7/A1/A2/A3/A4/A6/A7/A8 all GREEN.
- Database workflow `32005108254`: files 001-039 GREEN; file 040 fails exactly **4/4** expected A9 assertions for the two absent RPCs and two absent indexes.
- K5 fixtures and K6 runtime topology: GREEN.

No A9 migration has been applied to hosted Supabase. Implementation is authorized next by the frozen RED contracts, but hosted deployment remains forbidden until full local/CI GREEN and isolated A9 real-database acceptance.

## External production blocker

The critical production blocker remains current provider-owned contract evidence for retained PSPs.

AkkadPag/AkadPay lineage/equivalence and current create/query/idempotency/recovery/webhook semantics are not sufficiently proven. FlevoPay current technical create/query/recovery/webhook semantics are also not sufficiently proven.

Therefore A5 fixture conformance does not authorize live money movement. Live provider transport, provider webhook ingress and provider recovery/reconciliation remain blocked until the applicable current evidence gates close.

## Next internal action

Implement only the frozen A9 behavior to turn its RED tests GREEN, then add isolated PostgreSQL acceptance and prove capability/privacy/state invariants. Do not deploy A9 hosted before that verification.
