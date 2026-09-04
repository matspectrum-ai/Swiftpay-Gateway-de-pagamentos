# SwiftPay V2 — V1 Readiness Status

Date: 2026-09-03 (America/Santarem)  
Canonical source: `main`  
Latest accepted behavioral merge before A29: A28 PR #8, `9f612c5a7592f1b05064e2e4238cc9f60699adf5`  
Current provider-contract slice: A29 PR #10

This document reports engineering/readiness by risk, not by lines of code or number of files.

## Executive estimate

| Dimension | Current estimate | Interpretation |
| --- | ---: | --- |
| Core architecture/domain/database/platform | **~99%** | Core payment, financial, security and trusted-runtime foundations are essentially established. |
| First end-to-end Pix Sandbox MVP | **~99%** | Hosted database/runtime Sandbox flow is proven; deployed HTTP/browser compute and server-side runtime secret injection remain. |
| Production-capable Pix V1 | **~62%** | A29 closes top-level MagicPay create/query schema uncertainty, but real-money blockers remain canonical Pix payload semantics, idempotency/recovery, authenticated provider proof, explicit activation and launch operations. |
| Weighted V1 engineering completion | **~79%** | Remaining implementation is smaller in volume but concentrated in high-risk provider and operational work. |

Do not interpret 79% engineering completion as 79% launch safety. A29 removes documentation uncertainty but does not yet reduce the dominant real-money execution/recovery risk enough to justify changing the risk-weighted percentages.

## Canonical platform state

Canonical Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

A23/A24/A26/A27 hosted migrations are applied. A25's operational runtime LOGIN bootstrap is applied outside migration history and installs no hosted password.

Current hosted attestation:

- `swiftpay_api` effective `app` EXECUTE: **30**
- `swiftpay_worker` effective `app` EXECUTE: **6**
- Data API effective `app` EXECUTE: **0**
- runtime direct `app` ACL: **0**
- invalid A23 compatibility references: **0**
- Payment Links / Payments / ProviderAttempts after A25 rollback: **0 / 0 / 0**
- retained-provider monetary traffic during accepted hosted validation: **0**

Security Advisor still reports one INFO `rls_enabled_no_policy` for intentionally private `app.payment_links`; the current deny-all/Data-API-isolated boundary remains deliberate.

## Quality baseline

A25+A26+A27 are canonical in `main` through PR #5 (`8be66916a14126e8e86f4858b32d56d5866a7c9f`).

- final A25 branch Application workflow `33807825924`: GREEN
- final A25 branch Database workflow `33807825927`: GREEN
- database baseline: **48 pgTAP files / 1403 assertions PASS**
- hosted A25 positive Sandbox DB E2E executed as `current_user=swiftpay_api_runtime`
- A25 rollback returned all synthetic/business state to zero
- no paid transition, ledger posting or retained PSP I/O occurred in A25 hosted acceptance

Evidence:

- `docs/evidence/application/2026-08-21-a25-hosted-runtime-identity-sandbox-db-e2e.md`
- `docs/evidence/application/2026-08-21-a26-a23-jsonb-object-arity-runtime-fix.md`
- `docs/evidence/application/2026-08-21-a27-a23-coalesce-special-form-runtime-fix.md`

## A28 MagicPay status — canonical partial contract

A28 is `DONE / GREEN / APPLICATION-ONLY / EVIDENCE-PARTIAL` and is canonical in `main` through PR #8 (`9f612c5a7592f1b05064e2e4238cc9f60699adf5`).

A28 established:

- API base URL `https://api.dashboardmagicpay.com/v1`
- Basic Auth with public key as username and secret key as password
- integer-centavo amounts
- Pix create request via `POST /transactions` with `paymentMethod=pix`
- transaction query route `GET /transactions/{id}`
- read-only company and available-balance routes
- `postbackUrl` 2xx acknowledgement/retry behavior
- separate `x-withdraw-key` requirement for withdrawal/anticipation

A28 implements only an internal, non-authorizing module. The MagicPay module is not exported by the public providers barrel, MagicPay is not registered in A10 and no monetary A11 binding exists.

A28 final pre-merge validation:

- SHA `7a2d52a44544fc659daae83fde4c4d444d5d5b6b`
- Application workflow `33809654802`: GREEN including runtime-database acceptance
- canonical merge `9f612c5a7592f1b05064e2e4238cc9f60699adf5`

Evidence: `docs/evidence/application/2026-09-03-a28-magicpay-provider-contract-evidence.md`.

## A29 MagicPay response/query status

A29 is `DONE / GREEN / APPLICATION-ONLY / EVIDENCE-PARTIAL` on PR #10 and is awaiting canonical merge.

Provider-owned screenshots from the MagicPay create-sale/find-sale documentation close the previously unknown top-level response envelopes. Their ordered digest-manifest SHA-256 is:

`8838db6276152af9d43d16ce71fa32cb9310b01f46f10c20897dea668d2f6833`

A29 also adds ADR 0005, explicitly admitting MagicPay as a third provider candidate while leaving all runtime-activation gates intact.

A29 now proves and implements, network-free:

- create-sale `200` top-level transaction response normalization from provider `id`, `amount`, `paymentMethod`, `status`, `externalRef`;
- create-sale `400` `{ code, message }` parsing without claiming execution certainty;
- optional request `pix.expiresInDays` positive-int32 serialization;
- Basic-authenticated `GET /transactions/{id}` request construction;
- find-sale `200` transaction response normalization;
- query `pix` preservation only as `providerPixValue` because the provider describes it as a Pix key or code, not unambiguously as EMV copy-and-paste;
- exact narrow status mapping for `waiting_payment`, `pending`, `paid`, `refused`, `refunded`, `chargedback`.

A29 formal RED:

- SHA `be50ec5a280867ac24e0ba5331c5c9669875ce74`
- Application workflow `33822220854`
- application-contracts job `100867151352`
- typecheck/build GREEN; **412 tests / 405 PASS / exactly 7 intended A29 failures**

A29 implementation GREEN:

- SHA `a5ca665501a5e8c68f7e4902ffc36153ecacd185`
- Application workflow `33822375392`
- application-contracts job `100867618596`: **412 / 412 PASS**
- runtime-database-acceptance job `100867618738`: GREEN, including K7/A14/A18/A1-A9

Evidence: `docs/evidence/application/2026-09-03-a29-magicpay-response-query-contract.md`.

## Why MagicPay is still not Production-authorized

A29 removes the old top-level create/query response-schema blocker, but the provider contract still does not establish the facts required for safe payable execution:

- internal fields of the successful create-response `pix` object;
- whether the provider `pix` value is guaranteed to be the canonical EMV/copy-and-paste value SwiftPay must return to merchants;
- provider idempotency/replay semantics;
- ambiguous-create recovery after timeout or connection loss;
- provider error execution-certainty semantics;
- Sandbox/homologation classification;
- authenticated non-destructive provider proof from a working network path;
- webhook authentication/signature and replay identity;
- explicit rate limits.

`externalRef` remains correlation only; it is not treated as idempotency evidence.

A documented provider `400` is parsed but not interpreted as proof that monetary execution did not occur.

The prior non-destructive authenticated probe could not reach `api.dashboardmagicpay.com` because the available execution environment failed DNS resolution. That is not a provider rejection and does not prove or disprove the supplied credentials.

Therefore MagicPay Production provider authority remains **zero**.

## Why Sandbox is ~99%, not 100%

The hosted database/runtime-role path is proven. Remaining SwiftPay Sandbox closure is deployed compute:

1. server-side runtime database credential/bootstrap/rotation contract;
2. actual SwiftPay V2 API/checkout deployment;
3. server-only runtime credential injection;
4. deployed Fastify routing/CORS/TLS/readiness verification;
5. browser Payment Link → checkout → deterministic Sandbox Pix E2E;
6. HTTP replay/tenant/security acceptance.

This internal Sandbox milestone is independent from MagicPay's still-unclassified provider environment.

## Remaining V1 engineering

### Launch critical

1. Canonicalize A29 after final CI.
2. Deployed HTTP runtime E2E for actual V2 API/checkout.
3. MagicPay canonical Pix payload + idempotency/ambiguous-recovery evidence.
4. MagicPay environment classification and authenticated safe proof from a working network path.
5. Live provider adapter + A11 bridge only after evidence closes.
6. Deliberate A10 activation only after live-provider proof.
7. Provider webhook authenticity/recovery/reconciliation runtime.
8. Deployment/cutover/rollback/backup contract.
9. Production secrets/bootstrap rotation drills.
10. Load/capacity, WAF/network and external observability hardening.
11. `main` branch protection with required checks.

### Merchant product completion

- KYC/compliance operations;
- payout API/UI;
- refund API/UI;
- reporting/analytics;
- Production checkout/Payment Links after provider activation.

## Practical interpretation

SwiftPay V2 is no longer an early prototype. Core payment, financial, idempotency, tenant and runtime-security invariants have executable and hosted evidence. A28 established MagicPay auth/request semantics; A29 now closes the provider's top-level create/query response contract without over-claiming the ambiguous Pix field. The remaining provider work is no longer primarily basic schema discovery — it is the higher-risk idempotency, recovery, canonical Pix payload, environment/authenticated proof and webhook authority needed before real-money activation.
