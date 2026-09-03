# SwiftPay V2 — V1 Readiness Status

Date: 2026-09-03 (America/Santarem)  
Canonical source: `main`  
Latest accepted behavioral merge: A28 PR #8, `9f612c5a7592f1b05064e2e4238cc9f60699adf5`

This document reports engineering/readiness by risk, not by lines of code or number of files.

## Executive estimate

| Dimension | Current estimate | Interpretation |
| --- | ---: | --- |
| Core architecture/domain/database/platform | **~99%** | Core payment, financial, security and trusted-runtime foundations are essentially established. |
| First end-to-end Pix Sandbox MVP | **~99%** | Hosted database/runtime Sandbox flow is proven; deployed HTTP/browser compute and server-side runtime secret injection remain. |
| Production-capable Pix V1 | **~62%** | Major Production blockers remain provider response/idempotency/recovery evidence, explicit activation and launch operations. |
| Weighted V1 engineering completion | **~79%** | Remaining implementation is smaller in volume but concentrated in high-risk provider and operational work. |

Do not interpret 79% engineering completion as 79% launch safety.

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

A28 is now `DONE / GREEN / APPLICATION-ONLY / EVIDENCE-PARTIAL` and is canonical in `main` through PR #8 (`9f612c5a7592f1b05064e2e4238cc9f60699adf5`).

The provider-supplied integration guide establishes:

- API base URL `https://api.dashboardmagicpay.com/v1`
- Basic Auth with public key as username and secret key as password
- integer-centavo amounts
- Pix create request via `POST /transactions` with `paymentMethod=pix`
- transaction query route `GET /transactions/{id}`
- read-only company and available-balance routes
- `postbackUrl` 2xx acknowledgement/retry behavior
- separate `x-withdraw-key` requirement for withdrawal/anticipation

A28 implements only an internal, non-authorizing module with:

- exact contract-gap metadata
- pure Pix request serialization
- local validation/normalization
- read-only company/balance request primitives

The MagicPay module is intentionally **not** exported by the public providers barrel. MagicPay is not added to A10 and no monetary A11 binding exists.

A28 formal RED:

- SHA `ee1cd36325bc283fdf4153d7ee7d6c16efa5d964`
- Application workflow `33809027827`
- install/typecheck/build GREEN; application contracts failed as intended before the dedicated module existed

A28 implementation GREEN checkpoint:

- SHA `41af647e5cf3a4dcff206953168d5e770b77a6fc`
- Application workflow `33809360204`: full workflow GREEN

A28 final pre-merge validation:

- SHA `7a2d52a44544fc659daae83fde4c4d444d5d5b6b`
- Application workflow `33809654802`: **GREEN**
- application contracts GREEN
- unchanged runtime-database acceptance GREEN
- canonical merge `9f612c5a7592f1b05064e2e4238cc9f60699adf5`

Evidence: `docs/evidence/application/2026-09-03-a28-magicpay-provider-contract-evidence.md`.

## Why MagicPay is not yet Production-authorized

The guide still does not establish the exact facts needed to safely normalize and recover a real Pix execution:

- successful `POST /transactions` response schema
- Pix QR/copy-and-paste field location
- exact `GET /transactions/{id}` response envelope
- provider idempotency semantics
- ambiguous-create recovery semantics
- provider error certainty semantics
- Sandbox/homologation classification
- webhook authentication/signature and replay identity
- explicit rate limits

`externalRef` is not treated as idempotency evidence.

A non-destructive authenticated probe could not reach `api.dashboardmagicpay.com` because the available execution environment failed DNS resolution. That is not a provider rejection and does not prove or disprove the supplied credentials.

Therefore MagicPay Production provider authority remains **zero**.

## Why Sandbox is ~99%, not 100%

The hosted database/runtime-role path is proven. Remaining Sandbox closure is deployed compute:

1. server-side runtime database credential/bootstrap/rotation contract
2. actual SwiftPay V2 API/checkout deployment
3. server-only runtime credential injection
4. deployed Fastify routing/CORS/TLS/readiness verification
5. browser Payment Link → checkout → deterministic Sandbox Pix E2E
6. HTTP replay/tenant/security acceptance

## Remaining V1 engineering

### Launch critical

1. Deployed HTTP runtime E2E for actual V2 API/checkout.
2. Exact MagicPay Pix response/query/idempotency/recovery evidence.
3. Authenticated safe MagicPay proof from a working network path/environment.
4. Live provider adapter + A11 bridge only after evidence closes.
5. Deliberate A10 activation only after live-provider proof.
6. Provider webhook authenticity/recovery/reconciliation runtime.
7. Deployment/cutover/rollback/backup contract.
8. Production secrets/bootstrap rotation drills.
9. Load/capacity, WAF/network and external observability hardening.
10. `main` branch protection with required checks.

### Merchant product completion

- KYC/compliance operations
- payout API/UI
- refund API/UI
- reporting/analytics
- Production checkout/Payment Links after provider activation

## Practical interpretation

SwiftPay V2 is no longer an early prototype. Core payment, financial, idempotency, tenant and runtime-security invariants have executable and hosted evidence. A28 materially reduces MagicPay documentation uncertainty, but deliberately stops before payable provider execution because response, idempotency and recovery evidence is still incomplete.
