# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-09-03 (America/Santarem)

This is the durable handoff/backlog ledger. Repository specs, contracts, migrations, tests and `docs/evidence/**` are the source of truth; Git history preserves checkpoint chronology.

Executive status: `docs/product/v1-readiness-status.md`  
Functional checklist: `docs/product/v1-functional-checklist.md`

## Delivery states

- `PENDING`: known, not started
- `PROBLEM_ANALYSIS`: boundary being investigated/frozen
- `TDD_RED`: frozen contract with fail-first evidence
- `IN_PROGRESS`: implementation after RED authority
- `EVIDENCE_REQUIRED`: stronger current external evidence required
- `BLOCKED`: dependency prevents safe progress
- `DONE`: contract, implementation and required evidence complete
- `DEFERRED`: intentionally outside current critical path
- `SUPERSEDED`: replaced by later canonical artifact

## Current checkpoint

- Canonical source branch: `main`
- Latest accepted behavioral merge before A29: PR #8 — A28 MagicPay partial provider contract + safe primitives, merge commit `9f612c5a7592f1b05064e2e4238cc9f60699adf5`
- Current provider-contract slice: PR #10 — A29 MagicPay response/query contract normalization
- Prior canonical hosted-runtime merge: PR #5 — A25+A26+A27, merge commit `8be66916a14126e8e86f4858b32d56d5866a7c9f`
- Canonical hosted Supabase: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
- K1-K7: `DONE`
- A1-A28: `DONE` for their frozen scopes
- A29: `DONE / GREEN / APPLICATION-ONLY / EVIDENCE-PARTIAL` on PR #10 branch; canonical merge remains the current checkpoint action
- A5 remains `DONE / FIXTURE-ONLY` for retained live-provider authority
- A10 remains default-deny; MagicPay is not registered or activated
- A11 strict HTTPS transport remains unbound from MagicPay monetary behavior
- Deployed HTTP/browser/runtime-secret proof remains `PENDING`
- Retained-provider Production authority remains **zero**

### Current risk-weighted engineering estimates

- core architecture/domain/database/platform: **~99%**
- first end-to-end Pix Sandbox MVP: **~99%**
- production-capable Pix V1: **~62%**
- weighted V1 engineering completion: **~79%**

These percentages are risk/effort weighted, not file counts or launch-safety claims. A29 materially reduces provider-schema uncertainty but does not close the real-money activation/recovery gates, so the risk-weighted estimates are intentionally unchanged.

## Latest canonical hosted/runtime work

### A25 — hosted runtime identity + Sandbox DB E2E — `DONE / GREEN / HOSTED`

- Problem Analysis: `docs/design/a25-hosted-runtime-identity-sandbox-e2e-problem-analysis.md`
- Spec: `docs/specs/hosted-runtime-identity-sandbox-e2e-v0.yaml`
- Contract: `docs/contracts/hosted-runtime-identity-sandbox-e2e-v0.md`
- Test: `tests/application/067_a25_hosted_runtime_identity_sandbox_e2e.contract.test.mjs`
- Bootstrap: `ops/sql/bootstrap-hosted-runtime-identities.sql`
- Evidence: `docs/evidence/application/2026-08-21-a25-hosted-runtime-identity-sandbox-db-e2e.md`
- Hosted runtime topology exact: API runtime → `swiftpay_api`; worker runtime → `swiftpay_worker`
- Hosted capability baseline: **30 API / 6 worker**, Data API `app` EXECUTE **0**, runtime direct `app` ACL **0**
- Positive hosted transaction-scoped Sandbox DB E2E executed as `current_user=swiftpay_api_runtime`
- Payment Link/create/replay, Production fail-closed, cross-tenant denial, public projection, prepare/replay/conflict, single-winner claim, resolution and completed replay all proved
- Explicit rollback restored synthetic/business state to zero
- No retained PSP call, paid transition or ledger posting occurred
- PostgreSQL 17 creator-admin relationship is accepted only as `ADMIN TRUE, SET FALSE, INHERIT FALSE`; temporary SET/INHERIT authority returns false
- A25 installs no hosted runtime password

### A26/A27 — A23 PostgreSQL runtime compatibility — `DONE / GREEN / HOSTED`

- A26 evidence: `docs/evidence/application/2026-08-21-a26-a23-jsonb-object-arity-runtime-fix.md`
- A27 evidence: `docs/evidence/application/2026-08-21-a27-a23-coalesce-special-form-runtime-fix.md`
- A26 repaired nonexistent `pg_catalog.jsonb_object_length(jsonb)` usage
- A27 repaired exactly six invalid `pg_catalog.coalesce(...)` references
- Final database baseline: **48 files / 1403 pgTAP assertions PASS**
- Hosted migration versions: `20260822031801_a23_jsonb_object_arity_runtime_fix`, `20260822031818_a23_coalesce_special_form_runtime_fix`
- PR #5 final Application `33807825924` GREEN; Database `33807825927` GREEN
- Canonical merge: `8be66916a14126e8e86f4858b32d56d5866a7c9f`

## A28 — MagicPay partial provider contract — `DONE / GREEN / APPLICATION-ONLY / EVIDENCE-PARTIAL`

### Source evidence

- Provider documentation entry point: `https://app.dashboardmagicpay.com/docs/intro/first-steps`
- Provider-supplied integration guide SHA-256: `b9b493227d45b880077383c145e9ca5a0c16e6fae327b84d2c614566b8c47104`
- Real credentials were supplied out-of-repository and MUST NOT enter Git, CI, browser state, screenshots or ordinary logs

### Contract facts proven by provider guide

- base URL: `https://api.dashboardmagicpay.com/v1`
- HTTP Basic Auth: public key username + secret key password
- money: integer centavos
- Pix create request: `POST /transactions`, `paymentMethod=pix`
- transaction query route: `GET /transactions/{id}`
- read-only company: `GET /company`
- read-only balance: `GET /balance/available`
- postback: per-transaction `postbackUrl`, transaction-shaped status body, 2xx acknowledgement, retry after non-2xx
- withdrawal/anticipation requires additional `x-withdraw-key`

### A28 artifacts / validation

- Problem Analysis: `docs/design/a28-magicpay-provider-contract-evidence-problem-analysis.md`
- Spec: `docs/specs/magicpay-provider-contract-evidence-v0.yaml`
- Contract: `docs/contracts/magicpay-provider-contract-evidence-v0.md`
- Test: `tests/application/068_a28_magicpay_provider_contract_evidence.contract.test.mjs`
- Implementation: `packages/providers/src/magicpay.ts`
- Evidence: `docs/evidence/application/2026-09-03-a28-magicpay-provider-contract-evidence.md`
- RED SHA `ee1cd36325bc283fdf4153d7ee7d6c16efa5d964`, workflow `33809027827`
- Final pre-merge head `7a2d52a44544fc659daae83fde4c4d444d5d5b6b`, workflow `33809654802`: GREEN including runtime-database acceptance
- Canonical merge: `9f612c5a7592f1b05064e2e4238cc9f60699adf5`

A28 deliberately left create-success/query response semantics unresolved; A29 closes the evidenced top-level portions without changing live authority.

## A29 — MagicPay response/query contract normalization — `DONE / GREEN / APPLICATION-ONLY / EVIDENCE-PARTIAL`

### Source evidence and architecture

- Provider docs: `https://app.dashboardmagicpay.com/docs/sales/create-sale`
- Provider docs: `https://app.dashboardmagicpay.com/docs/sales/find-sale`
- Ordered screenshot digest-manifest SHA-256: `8838db6276152af9d43d16ce71fa32cb9310b01f46f10c20897dea668d2f6833`
- ADR 0005 explicitly admits MagicPay as the third provider **candidate**, satisfying ADR 0004's explicit-decision requirement without granting runtime authority
- screenshots themselves are not committed; only provider-owned facts and digest lineage are recorded

### Newly closed contract facts

- create-sale `200` is a top-level transaction object with provider `id`, `amount`, `paymentMethod`, `status`, `externalRef` and nested `pix` object among documented fields
- create-sale `400` documents `{ code: integer, message: string }`
- request Pix object documents optional `expiresInDays` int32
- find-sale `200` is a top-level transaction object with provider `id`, `status`, `paidAt`, `externalRef` and `pix` string among documented fields
- query `pix` is described as provider Pix **key or code**; it is preserved as `providerPixValue` and is not relabeled as canonical copy-and-paste
- documented status normalization is restricted to:
  - `waiting_payment`, `pending` → `pending`
  - `paid` → `paid`
  - `refused` → `failed`
  - `refunded` → `refunded`
  - `chargedback` → `disputed`
  - all other values → explicit unrecognized status

### A29 artifacts

- Problem Analysis: `docs/design/a29-magicpay-response-query-contract-problem-analysis.md`
- ADR: `docs/decisions/0005-admit-magicpay-provider-candidate.md`
- Spec: `docs/specs/magicpay-response-query-contract-v0.yaml`
- Contract: `docs/contracts/magicpay-response-query-contract-v0.md`
- Test: `tests/application/069_a29_magicpay_response_query_contract.contract.test.mjs`
- Implementation: `packages/providers/src/magicpay.ts`
- Evidence: `docs/evidence/application/2026-09-03-a29-magicpay-response-query-contract.md`

### A29 TDD

- Formal RED SHA: `be50ec5a280867ac24e0ba5331c5c9669875ce74`
- RED Application workflow: `33822220854`, application-contracts job `100867151352`
- RED: typecheck/build GREEN; **412 tests / 405 PASS / exactly 7 intended failures**, all isolated to absent A29 functions/metadata
- GREEN implementation SHA: `a5ca665501a5e8c68f7e4902ffc36153ecacd185`
- GREEN Application workflow: `33822375392`, application-contracts job `100867618596`
- GREEN application contracts: **412 / 412 PASS**
- existing A1-A28 application contracts remain GREEN

### A29 implementation boundary

Implemented, network-free:

- separate `MAGICPAY_RESPONSE_QUERY_EVIDENCE` metadata while preserving A28 metadata unchanged
- optional positive-int32 `pix.expiresInDays` request serialization
- exact documented MagicPay status normalization
- pure create-success parser
- pure create-400 parser with **no** execution-certainty inference
- pure Basic-authenticated transaction-query request builder
- pure query-success parser preserving `providerPixValue`

Still explicitly absent/forbidden:

- `createMagicPayAdapter`
- public MagicPay provider-barrel export
- MagicPay A10 registration or activation
- MagicPay A11 monetary binding
- payable Pix execution
- automatic retry after ambiguous create
- `externalRef` as provider idempotency authority
- `providerPixValue` as canonical `copyAndPaste`
- trusted MagicPay webhook
- withdrawal/refund/anticipation implementation

### Remaining MagicPay evidence after A29

- nested fields of the successful create-response `pix` object
- canonical Pix copy-and-paste/EMV semantics
- provider create idempotency semantics
- ambiguous-create recovery semantics
- provider error execution-certainty contract
- Sandbox/homologation environment classification
- authenticated non-destructive provider proof from a working network path
- webhook authentication/signature and replay identity
- explicit rate limits

Production provider authority remains **zero**.

## Current hosted security state

- canonical project migration history includes A23/A24/A26/A27
- `app.payment_links` RLS enabled
- Data API effective `app` EXECUTE: **0**
- Payments / ProviderAttempts / Payment Links: **0 / 0 / 0** after A25 rollback
- retained-provider monetary calls during accepted hosted validation: **0**
- hosted runtime password installed by A25: **no**
- invalid A23 compatibility references after A26/A27: **0**
- Security Advisor INFO `rls_enabled_no_policy` for intentionally private `app.payment_links` remains accepted under current boundary

## Remaining product work

### Merchant product

- KYC/compliance operational workflow + UI — `PENDING`
- payout merchant-usable API/UI — `PENDING`
- refund merchant-usable API/UI — `PENDING`
- reporting/analytics merchant UI — `PENDING`
- deployed HTTP/browser Sandbox checkout E2E using actual V2 API compute — `PENDING`
- Production checkout/Payment Links — `BLOCKED ON PSP EVIDENCE/ACTIVATION`

### Provider/reconciliation

- MagicPay auth/request contract — `DONE / EVIDENCE-PARTIAL`
- MagicPay top-level create/query response normalization — `DONE / EVIDENCE-PARTIAL`
- canonical Pix payload + create idempotency/recovery semantics — `EVIDENCE_REQUIRED`
- authenticated provider non-destructive proof — `BLOCKED ON WORKING NETWORK PATH / ENVIRONMENT CLASSIFICATION`
- MagicPay live adapter + A11 bridge — `BLOCKED ON EVIDENCE`
- MagicPay A10 activation — `BLOCKED ON EVIDENCE`
- provider webhook authenticity/ingress — `BLOCKED ON EVIDENCE`
- provider recovery/reconciliation runtime — `BLOCKED ON EVIDENCE`

### Operations / launch hardening

- server-side runtime DB credential/bootstrap/rotation contract — `PENDING`
- actual V2 API/worker/dashboard/checkout deployment contract — `PENDING`
- deployed HTTP runtime E2E — `PENDING`
- backup/restore + disaster recovery verification — `PENDING`
- cutover/rollback/incident runbooks — `PENDING`
- production secrets/bootstrap/rotation drills — `PENDING`
- external metrics dashboards/alerts/SLO policy — `PENDING`
- production-like load/capacity testing — `PENDING`
- measured DB/index/performance tuning — `PENDING`
- production WAF/network hardening — `PENDING`
- dependency/supply-chain final review — `PENDING`
- `main` branch protection / required checks — `PENDING`

## Current handoff spine

```text
Foundation / domain / database                         DONE
  -> K1-K7 trusted Supabase/runtime foundation         DONE
  -> A1-A4 deterministic authenticated Pix lifecycle  DONE
  -> A5 provider fixtures                             DONE / FIXTURE-ONLY
  -> A10 activation default-deny                      DONE
  -> A11 strict HTTPS provider transport              DONE / UNBOUND
  -> A28 MagicPay auth/request contract               DONE / PARTIAL
  -> A29 MagicPay top-level response/query contract   DONE / PARTIAL
       -> canonical Pix payload/idempotency/recovery   EVIDENCE_REQUIRED
       -> authenticated safe provider proof           BLOCKED
       -> live MagicPay adapter + A11 bridge           BLOCKED
       -> A10 MagicPay activation                      BLOCKED

Merchant / Sandbox path:
  -> A6-A9 trusted merchant APIs                      DONE
  -> A21 dashboard foundation                        DONE / HOSTED
  -> A22 integration settings UI                     DONE
  -> A23 Sandbox checkout + Payment Links            DONE / HOSTED
  -> A24 checkout admission DB repair                DONE / HOSTED
  -> A25 hosted runtime-role Sandbox DB E2E           DONE / HOSTED
  -> A26/A27 PostgreSQL runtime compatibility         DONE / HOSTED
  -> deployed HTTP/browser/runtime-secret E2E         PENDING

Production-hardening path:
  -> A12-A20 security/telemetry/runtime hardening     DONE
  -> deployment credential/bootstrap contract         PENDING
  -> external observability/alerts/SLOs              PENDING
  -> load/capacity + network/WAF                     PENDING
  -> deploy/backup/cutover/rollback                  PENDING
  -> production PSP activation                       BLOCKED ON EVIDENCE
```

## Immediate next action

1. acquire/expand the successful create-response `pix` object or obtain a provider-owned real/sample JSON proving canonical Pix copy-and-paste semantics;
2. acquire provider idempotency/retry/ambiguous-execution recovery semantics and Sandbox/environment evidence;
3. acquire webhook authenticity/replay semantics or freeze a conservative query-only reconciliation design;
4. run authenticated non-destructive provider proof from a working network path;
5. only then freeze a live MagicPay adapter + A11 bridge + deliberate A10 activation slice;
6. separately freeze deployed HTTP runtime E2E for SwiftPay V2;
7. no payable MagicPay Pix, withdrawal, refund or provider activation is authorized until the later live-provider gate explicitly closes.
