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
- Latest accepted canonical merge: PR #5 — A25+A26+A27, merge commit `8be66916a14126e8e86f4858b32d56d5866a7c9f`
- Active PR: #8 — A28 MagicPay provider contract evidence, branch `agent/a28-magicpay-provider-contract-evidence`
- Canonical hosted Supabase: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
- K1-K7: `DONE`
- A1-A27: `DONE` for their frozen scopes
- A25: `DONE / GREEN / HOSTED / DATABASE-RUNTIME-E2E`
- A26: `DONE / GREEN / HOSTED / DATABASE-ONLY`
- A27: `DONE / GREEN / HOSTED / DATABASE-ONLY`
- A28: `GREEN IMPLEMENTATION / APPLICATION-ONLY / EVIDENCE-PARTIAL`; final documentation-head CI + PR merge remain
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

These percentages are risk/effort weighted, not file counts or launch-safety claims. Remaining risk is concentrated in deployed HTTP operations, provider authority/evidence and launch operations.

## Latest canonical work

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

## A28 — MagicPay partial provider contract — `GREEN / APPLICATION-ONLY / EVIDENCE-PARTIAL`

### Source evidence

- Provider documentation entry point: `https://app.dashboardmagicpay.com/docs/intro/first-steps`
- Provider-supplied integration guide SHA-256: `b9b493227d45b880077383c145e9ca5a0c16e6fae327b84d2c614566b8c47104`
- Real credentials were supplied out-of-repository and MUST NOT enter Git, CI, browser state, screenshots or ordinary logs

### Contract facts now proven by provider guide

- base URL: `https://api.dashboardmagicpay.com/v1`
- HTTP Basic Auth: public key username + secret key password
- money: integer centavos
- Pix create request: `POST /transactions`, `paymentMethod=pix`
- transaction query route: `GET /transactions/{id}`
- read-only company: `GET /company`
- read-only balance: `GET /balance/available`
- postback: per-transaction `postbackUrl`, transaction-shaped status body, 2xx acknowledgement, retry after non-2xx
- withdrawal/anticipation requires additional `x-withdraw-key`

### Deliberately unresolved provider evidence

- exact successful Pix-create response schema
- exact Pix QR/copy-and-paste field
- exact transaction-query response envelope
- provider idempotency semantics
- ambiguous-create recovery semantics
- provider error certainty semantics
- Sandbox/homologation classification
- webhook authentication/signature
- webhook replay identity
- explicit rate limits

`externalRef` is **not** treated as provider idempotency evidence.

### A28 frozen artifacts

- Problem Analysis: `docs/design/a28-magicpay-provider-contract-evidence-problem-analysis.md`
- Spec: `docs/specs/magicpay-provider-contract-evidence-v0.yaml`
- Contract: `docs/contracts/magicpay-provider-contract-evidence-v0.md`
- Test: `tests/application/068_a28_magicpay_provider_contract_evidence.contract.test.mjs`
- Implementation: `packages/providers/src/magicpay.ts`
- Evidence: `docs/evidence/application/2026-09-03-a28-magicpay-provider-contract-evidence.md`

### A28 TDD evidence

- RED SHA `ee1cd36325bc283fdf4153d7ee7d6c16efa5d964`
- RED Application workflow `33809027827`: install/typecheck/build GREEN; `Run application contracts` FAIL as intended before the MagicPay module existed
- GREEN implementation head before evidence/docs: `41af647e5cf3a4dcff206953168d5e770b77a6fc`
- GREEN Application workflow `33809360204`: application-contracts job `100827316426` GREEN for install/typecheck/build/contracts
- Runtime DB acceptance is unchanged existing infrastructure and remains required on final documentation head

### A28 implementation boundary

Allowed and implemented:

- exact partial-contract metadata
- pure Basic-authenticated Pix request builder using documented camelCase payload vocabulary
- validation/normalization before transport
- read-only `/company` and `/balance/available` client primitives

Explicitly forbidden/not implemented:

- `createMagicPayAdapter`
- public `packages/providers/src/index.ts` MagicPay export
- MagicPay registration in A10
- A11 monetary binding
- payable Pix call
- trusted MagicPay webhook
- withdrawal/refund/anticipation implementation

A non-destructive authenticated probe could not reach the provider because the available execution environment failed DNS resolution for `api.dashboardmagicpay.com`; this is not an authentication rejection or provider failure.

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

- MagicPay partial request/auth contract — `DONE / EVIDENCE-PARTIAL`
- exact Pix response/query/idempotency/recovery contract — `EVIDENCE_REQUIRED`
- authenticated provider read-only proof — `BLOCKED ON NETWORK PATH / ENVIRONMENT CLASSIFICATION`
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
  -> A28 MagicPay auth/request contract               GREEN / PARTIAL
       -> exact response/idempotency/recovery          EVIDENCE_REQUIRED
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

## Changed files in A28

- `docs/design/a28-magicpay-provider-contract-evidence-problem-analysis.md`
- `docs/specs/magicpay-provider-contract-evidence-v0.yaml`
- `docs/contracts/magicpay-provider-contract-evidence-v0.md`
- `tests/application/068_a28_magicpay_provider_contract_evidence.contract.test.mjs`
- `packages/providers/src/magicpay.ts`
- `docs/evidence/application/2026-09-03-a28-magicpay-provider-contract-evidence.md`
- `TODOS.md`

## Immediate next action

1. require final documentation-head Application workflow GREEN, including unchanged runtime-database acceptance;
2. update PR #8 with final RED/GREEN evidence and merge A28 only if that final gate is GREEN;
3. acquire exact MagicPay successful Pix create + transaction-query examples/schema;
4. acquire idempotency/retry/ambiguous-execution recovery semantics and Sandbox/environment evidence;
5. acquire webhook authenticity/replay semantics or freeze a conservative query-only reconciliation design;
6. separately freeze deployed HTTP runtime E2E for SwiftPay V2;
7. no payable MagicPay Pix, withdrawal, refund or provider activation is authorized until the later live-provider gate explicitly closes.
