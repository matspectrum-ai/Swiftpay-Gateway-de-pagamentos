# SwiftPay V2 — V1 Readiness Status

Date: 2026-08-21 (America/Santarem)  
Canonical source: `main`  
Current repair PR: #4 — A24 checkout abuse-policy constraint

This document reports engineering/readiness by risk, not by lines of code or number of files.

## Executive estimate

| Dimension | Current estimate | Interpretation |
| --- | ---: | --- |
| Core architecture/domain/database/platform | **~99%** | Core payment, financial, security and trusted-runtime foundations are essentially established. |
| First end-to-end Pix Sandbox MVP | **~98%** | Deterministic Pix, dashboard and hosted Sandbox checkout/Payment Links exist; controlled positive hosted runtime E2E remains. |
| Production-capable Pix V1 | **~62%** | Major production blockers are retained-PSP authority/evidence and launch operations, not core data modeling. |
| Weighted V1 engineering completion | **~78%** | Approximately 22% of weighted engineering remains; remaining work is disproportionately risk-heavy. |

Do not interpret 78% engineering completion as 78% launch safety. The production-capable estimate is intentionally lower because provider and operational gates dominate real-money risk.

## What is already real

### Platform and financial core

- private Supabase/PostgreSQL canonical state;
- identity/compliance/provider catalog foundations;
- request idempotency and provider-attempt model;
- append-oriented double-entry ledger and merchant balance;
- payout/refund/reservation/reconciliation database foundations;
- durable jobs and merchant webhook persistence;
- trusted API/worker runtime database identities;
- exact runtime capability manifest and attestation.

### Pix application path

- API credential token exchange and Bearer authentication;
- authenticated Pix create/get;
- deterministic Sandbox emulator;
- paid transition + ledger + balance;
- merchant webhook delivery runtime;
- conservative `execution_unknown` semantics;
- strict provider default-deny activation boundary;
- strict provider HTTPS transport primitive, intentionally unbound from retained live adapters.

### Merchant product

- React/Vite merchant dashboard;
- Supabase Auth login/session/logout;
- merchant/environment context discovery;
- transaction list/detail;
- API credential management;
- webhook endpoint management;
- one-time secret reveal semantics;
- Sandbox hosted checkout and fixed-amount Payment Links;
- separate anonymous checkout SPA/API surface with Production fail-closed.

### Security / production foundations

- safe structured logging and server-owned correlation;
- bounded operational metrics/OpenMetrics;
- ingress abuse/rate limiting;
- access-token and cursor key rotation;
- webhook RSA secret wrapping and legacy AES retirement;
- abuse-subject HMAC rotation;
- Fastify logging compatibility;
- exact least-privilege runtime capability attestation.

## Latest hosted state

Canonical Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

A23 hosted migrations are applied. The first post-deploy smoke discovered a stale CHECK constraint in the distributed abuse-quota table; A24 repaired it under a clean RED→GREEN cycle.

Current hosted attestation after A24:

- `swiftpay_api` `app` EXECUTE capabilities: **30**
- `swiftpay_worker` `app` EXECUTE capabilities: **6**
- Data API effective `app` EXECUTE: **0**
- `checkout_request_pre_auth` persisted CHECK support: **yes**
- Payment Links rows after smoke: **0**
- Payments rows after smoke: **0**
- ProviderAttempts rows after smoke: **0**
- retained-provider monetary traffic during hosted validation: **0**

A24 hosted quota smoke returned `allowed=true`, `remaining=119`, `retry_after_seconds=0` and was rolled back.

Security Advisor currently reports one INFO `rls_enabled_no_policy` for `app.payment_links`. The table is intentionally private: RLS is enabled, Data API/table authority is absent and trusted SECURITY DEFINER routines are the access boundary. This INFO is recorded and must only be changed through a dedicated contract if the policy model changes.

## Current quality gates

### A23 baseline

- Application: **393/393 PASS**
- Database: **45 files / 1368 pgTAP PASS**
- K7/A14/A18/A1-A9 real PostgreSQL runtime acceptance: GREEN
- K5/K6: GREEN

### A24

RED Database workflow `32542942243`:

- #001-#045 existing tests GREEN;
- A24 #046: exactly four intended failures proving the stale CHECK;
- K5/K6 GREEN.

GREEN Application workflow `32543077528`:

- install/typecheck/build/application contracts GREEN;
- K7/A14/A18/A1-A9 real PostgreSQL runtime acceptance GREEN.

GREEN Database workflow `32543077585`:

- **46 files / 1382 assertions PASS**;
- A24 #046: **14/14 PASS**;
- K5/K6 GREEN.

Evidence: `docs/evidence/application/2026-08-21-a24-checkout-abuse-policy-constraint.md`.

## Why Sandbox is ~98%, not 100%

The repository and database can support a Sandbox hosted checkout, but the canonical hosted project currently contains no merchant/provider fixture data. A positive end-to-end hosted flow should be exercised through a controlled runtime/bootstrap fixture, not by inserting ad-hoc persistent production-project data through an administrative connector.

The remaining Sandbox closure is therefore operational integration evidence:

1. provision controlled Sandbox merchant/membership/emulator fixture;
2. deploy/configure API + checkout runtime against canonical hosted database using the intended runtime identity;
3. create a Payment Link through the trusted dashboard/API path;
4. open the anonymous checkout path;
5. create the deterministic Pix through the hosted runtime;
6. prove idempotent replay and no cross-tenant authority;
7. clean/rollback according to the fixture contract.

## Why production capability is only ~62%

The real-money critical path is still intentionally blocked. A5 fixture adapters plus A10/A11 do **not** authorize a live provider call.

Before Production Pix can be enabled, we need provider-owned/current evidence for the selected PSP:

- contractual lineage/current API authority;
- exact authentication;
- exact create/query contract;
- idempotency and ambiguous-execution recovery;
- webhook authentication/replay identity;
- status vocabulary/rate limits;
- authenticated current Sandbox proof;
- dedicated A5→A11 bridge under Problem Analysis → YAML → contracts → RED → GREEN;
- deliberate A10 activation state transition.

This is the largest single production blocker.

## Remaining V1 engineering

### High priority / launch critical

1. **Controlled positive hosted Sandbox E2E** — finish the last Sandbox integration proof.
2. **Current PSP contract + authenticated Sandbox evidence** — externally blocked/critical.
3. **Provider bridge + activation** — only after evidence closes.
4. **Provider webhook/recovery/reconciliation runtime** — live-provider correctness path.
5. **Deployment/cutover/rollback/backup contract** — production operations.
6. **Production secrets/bootstrap and rotation drills**.
7. **Load/capacity testing and measured tuning**.
8. **Production WAF/network hardening**.
9. **External observability dashboards/alerts/SLO policy**.
10. **Branch protection / required checks on `main`**.

### Merchant product completion

- KYC/compliance operations;
- payout API/UI;
- refund API/UI;
- reporting/analytics;
- Production checkout/Payment Links once PSP authority exists.

## Practical interpretation

The project is no longer an early prototype. Most difficult internal invariants — payment state, financial accounting, idempotency, tenant boundaries, secrets, runtime least privilege, abuse controls and merchant administration — already have executable contracts.

What remains is smaller in raw code volume but higher in launch risk. That is why the engineering estimate can be ~78% while the production-capable estimate remains ~62%.

## Next milestone

After A24 merges, the next internal slice should be a **controlled positive hosted Sandbox E2E/bootstrap**. In parallel, current provider evidence acquisition continues. No retained provider should be activated merely to increase a completion percentage.
