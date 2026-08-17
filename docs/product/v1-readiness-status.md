# SwiftPay V2 — V1 Readiness Status

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
PR: #1 — draft  
`main`: intentionally untouched

## Executive checkpoint

Conservative risk/effort-weighted readiness after A10 closure remains:

- core architecture/domain/database/platform foundation: **~99%**;
- first end-to-end Pix sandbox MVP: **~97%**;
- production-capable Pix V1: **~60%**;
- weighted V1 engineering completion: **~75%**.

A10 deliberately does not increase these estimates. It materially reduces the chance of accidental premature PSP activation, but it does not prove a current retained-provider contract, perform authenticated provider sandbox traffic, or close recovery/webhook/live monetary gates.

## Proven executable path

K1-K7 and A1-A10 are DONE. A5 remains fixture-only for live-provider authority; A10 now makes that default-deny state executable.

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
14. hosted dashboard transaction list/detail with exact filters, authenticated keyset cursor, tenant/environment isolation and merchant-safe projection;
15. network-free provider activation registry/authorizer that denies every checked-in retained-provider operation and binds any future grant to exact provider/operation/environment/contract lineage plus reviewed evidence metadata.

## A10 checkpoint — provider activation & outbound safety

Evidence: `docs/evidence/application/2026-08-17-a10-provider-activation-outbound-safety.md`.

GREEN implementation head: `0308844c4aedb1d359068becfd29d1f4a234b064`.

- Application workflow `32011311478`: **250/250 PASS**, including 10/10 A10 contracts and K7/A1-A9 real-database regression acceptance.
- Database workflow `32011311485`: **40 files / 1292 pgTAP assertions PASS**, K5 fixtures and K6 topology.
- A10 Supabase migrations: **none**.
- A10 provider network calls: **none**.
- Default A10 runtime-authorized provider operations: **0**.

A10 V0 introduces a strict versioned registry and immutable in-memory authorization grant boundary in `packages/providers`. `unsupported`, `fixture_only` and `current_contract_proven` do not authorize runtime provider traffic. Sandbox requires an exact `sandbox_proven`/`production_enabled` Sandbox record; Production requires an exact `production_enabled` Production record. Evidence is contract-lineage specific: similarly named AkadPay material cannot silently authorize the retained AkkadPag legacy lineage.

A10 does not add HTTP transport, credentials, public routes, database state, provider webhook ingress, monetary execution, recovery or reconciliation behavior.

## A9 hosted checkpoint

Evidence: `docs/evidence/application/2026-08-17-a9-merchant-transaction-operations.md`.

Behavioral GREEN head: `f846a50f2c8afe8f5561a59aebef8574e22ac6d6`.

- Application workflow `32009421604`: **240/240 PASS**, including K7/A1/A2/A3/A4/A6/A7/A8/A9 real-database acceptance.
- Database workflow `32009421592`: **40 files / 1292 pgTAP assertions PASS**, K5 fixtures and K6 topology.
- Hosted migration: `20260817081745_merchant_transaction_operations.sql`.
- Hosted `swiftpay_api`: exact **23** `app` EXECUTE capabilities.
- Hosted `swiftpay_worker`: exact **6**.
- Security Advisor after A9: **0 lints**.

A9 V0 is dashboard-only and read-only. It adds no Payment status mutation, provider recovery command, reconciliation command or monetary capability.

## What remains for V1

The remaining weighted V1 work is approximately **25%**, but it is risk-heavy rather than a simple quarter of feature count.

The largest unresolved block is production PSP authority:

- provider-owned proof of the exact retained AkkadPag/AkadPay contractual lineage/equivalence or a deliberate replacement decision;
- current create/query/idempotency and ambiguous-execution recovery semantics for the selected retained contract;
- current FlevoPay technical create/query/recovery semantics;
- exact provider webhook authentication/replay contracts;
- strict live HTTP transport that can execute only with an A10 authorization grant;
- authenticated current sandbox acceptance before any registry transition to `sandbox_proven`;
- provider webhook ingress and recovery/reconciliation runtime against verified current contracts;
- deliberate `production_enabled` transition only after production acceptance gates.

There are also remaining merchant/product surfaces outside the completed A1-A10 path, including merchant-usable payout/refund operations, additional operational/reporting surfaces and broader product/UI completion. Those do not supersede the PSP evidence gate on the Pix V1 critical path.

## External production blocker

The critical production blocker remains current provider-owned contract evidence for retained PSPs.

The 2026-08-17 evidence refresh is recorded at `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`.

Current AkadPay public technical material now documents useful Pix-out idempotency/replay details, but no accepted provider-owned evidence proves that the public AkadPay contract is the authoritative/current lineage of the retained AkkadPag legacy adapter. Exact trusted webhook verification also remains unproven.

Current FlevoPay public material exposes a current API host and high-level Pix capabilities but still does not provide the exact executable create/query/recovery/webhook contract required to activate the retained integration.

Therefore A5 fixture conformance plus A10 outbound safety still authorize **zero live retained-provider runtime operations**.

## Next internal action

A10 is DONE / GREEN / NETWORK-FREE. The next production-oriented slice must restart at Problem Analysis and should define the strict live HTTP transport foundation that can only consume an A10 authorization grant, while provider-owned contract evidence acquisition continues in parallel.

No real monetary PSP call is authorized until the current-contract evidence, authenticated sandbox proof and applicable activation gates are closed.
