# SwiftPay V2 — V1 Readiness Status

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
PR: #1 — draft  
`main`: intentionally untouched

## Executive checkpoint

Conservative risk/effort-weighted readiness after hosted A9 closure:

- core architecture/domain/database/platform foundation: **~99%**;
- first end-to-end Pix sandbox MVP: **~97%**;
- production-capable Pix V1: **~60%**;
- weighted V1 engineering completion: **~75%**.

The movement is deliberately small. A9 closes an important merchant operational surface, but it does not reduce the dominant external risk around current retained-PSP contracts, live transport, provider webhook authority or recovery/reconciliation behavior.

## Proven executable path

K1-K7 and A1-A9 are DONE. A5 remains fixture-only for live-provider authority.

The branch proves:

1. API credential `client_credentials` -> 900-second machine Bearer token;
2. authenticated/idempotent Pix Payment creation;
3. deterministic visibly non-payable sandbox emulator;
4. authenticated machine Payment retrieval;
5. worker trusted paid evidence with replay/concurrency absorption;
6. exactly one `settlement_paid` double-entry posting;
7. authenticated merchant balance;
8. transactional `payment.paid` outbox;
9. signed/fenced/retried merchant webhook delivery;
10. network-free retained-provider conformance fixtures;
11. online-verified Supabase dashboard sessions + K4 current membership/role authorization;
12. hosted webhook endpoint lifecycle administration;
13. hosted API credential lifecycle administration with AAL2 mutation step-up and immediate A1 token invalidation on rotation/revocation;
14. hosted dashboard transaction list/detail with exact filters, authenticated keyset cursor, tenant/environment isolation and merchant-safe projection.

## A9 hosted checkpoint

Evidence: `docs/evidence/application/2026-08-17-a9-merchant-transaction-operations.md`.

Behavioral GREEN head: `f846a50f2c8afe8f5561a59aebef8574e22ac6d6`.

- Application workflow `32009421604`: **240/240 PASS**, including K7/A1/A2/A3/A4/A6/A7/A8/A9 real-database acceptance.
- Database workflow `32009421592`: **40 files / 1292 pgTAP assertions PASS**, K5 fixtures and K6 topology.
- Hosted migration: `20260817081745_merchant_transaction_operations.sql`.
- Hosted `swiftpay_api`: exact **23** `app` EXECUTE capabilities.
- Hosted `swiftpay_worker`: exact **6**.
- Hosted A9 RPCs: exactly list/detail read operations, both `SECURITY DEFINER` with `search_path=''`.
- Hosted A9/payment indexes: existing merchant-created feed index plus status and exact-externalId query indexes.
- Direct protected-table runtime privileges observed in the hosted A9 audit: **0**.
- Hosted Payment rows after deployment: **0**; ProviderAttempt rows: **0**.
- Security Advisor: **0 lints**.
- Performance Advisor: INFO-only observations; no unrelated optimization was performed without measured workload evidence.

A9 V0 is dashboard-only and read-only. It adds no Payment status mutation, provider recovery command, reconciliation command or monetary capability. `execution_unknown` remains represented by canonical Payment `creating`; refunds remain separate through `refundedAmount`; list responses omit Pix instructions and customer/provider internals; detail exposes only normalized safe Pix instructions when complete canonical pending/paid data exists.

## What remains for V1

The remaining weighted V1 work is approximately **25%**, but it is risk-heavy rather than a simple quarter of feature count.

The largest unresolved block is production PSP authority:

- current provider-owned AkkadPag/AkadPay contractual lineage/equivalence;
- current create/query/idempotency and ambiguous-execution recovery semantics;
- current FlevoPay technical create/query/recovery semantics;
- exact provider webhook authentication/replay contracts;
- live provider transport activation only after those evidence gates close;
- provider webhook ingress and recovery/reconciliation runtime against verified current contracts;
- production monetary activation and end-to-end live/sandbox acceptance gates.

There are also remaining merchant/product surfaces outside the completed A1-A9 path, including merchant-usable payout/refund operations, additional operational/reporting surfaces and broader product/UI completion. Those do not supersede the PSP evidence gate on the Pix V1 critical path.

For the sandbox MVP specifically, only a small residual hardening/product-integration tail remains; the core executable Pix lifecycle and dashboard operational reads are already proven.

## External production blocker

The critical production blocker remains current provider-owned contract evidence for retained PSPs.

AkkadPag/AkadPay lineage/equivalence and current create/query/idempotency/recovery/webhook semantics are not sufficiently proven. FlevoPay current technical create/query/recovery/webhook semantics are also not sufficiently proven.

Therefore A5 fixture conformance does not authorize live money movement. Live provider transport, provider webhook ingress and provider recovery/reconciliation remain blocked until the applicable current evidence gates close.

## Next internal action

With A9 DONE/HOSTED, choose the next V1 slice from the canonical ledger while continuing PSP evidence acquisition in parallel. No real monetary PSP call is authorized until the current-contract evidence gates and the applicable live acceptance gates are closed.
