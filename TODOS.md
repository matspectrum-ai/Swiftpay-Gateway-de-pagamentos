# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-09-03 (America/Santarem)

This is the durable handoff/backlog ledger. Repository specs, contracts, migrations, tests and `docs/evidence/**` are the source of truth; Git history preserves checkpoint chronology.

Executive status: `docs/product/v1-readiness-status.md`  
Functional checklist: `docs/product/v1-functional-checklist.md`

## Delivery states

- `PENDING`: known, not started
- `PROBLEM_ANALYSIS`: boundary being investigated/frozen
- `TDD_RED`: spec/contracts frozen and fail-first tests prove the intended absence
- `IN_PROGRESS`: implementation after RED authority
- `EVIDENCE_REQUIRED`: stronger current external evidence required
- `BLOCKED`: dependency prevents safe progress
- `DONE`: contract, implementation and required evidence complete
- `DEFERRED`: intentionally outside current critical path
- `SUPERSEDED`: replaced by later canonical artifact

## Current checkpoint

- Canonical source branch: `main`
- Latest accepted merge at the A25 branch cut: PR #4 — A24, merge commit `4beb379bf62afe26faaf720d7698a4698988aa2f`
- Active canonicalization PR: #5 — A25 hosted runtime identity + Sandbox DB E2E bootstrap.
- A25 branch also contains the independently tested A26/A27 PostgreSQL compatibility repairs required by the real hosted runtime smoke.
- Canonical hosted Supabase: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
- K1-K7: `DONE`
- A1-A24: `DONE` for their frozen scopes.
- A25: `DONE / GREEN / HOSTED / DATABASE-RUNTIME-E2E`; formal merge to `main` is the remaining canonicalization step for this checkpoint.
- A26: `DONE / GREEN / HOSTED / DATABASE-ONLY`.
- A27: `DONE / GREEN / HOSTED / DATABASE-ONLY`.
- A5 remains `DONE / FIXTURE-ONLY` for retained live-provider authority.
- A10 remains default-deny: repository defaults authorize zero retained-provider operations.
- A11 strict HTTPS transport remains intentionally unbound from retained A5 adapters.
- Deployed HTTP/browser/runtime-secret proof remains `PENDING` and is the next internal gate.
- Current retained-provider contract/authenticated-Sandbox gate remains `EVIDENCE_REQUIRED`; no provider is activated merely because credentials exist.

### Current risk-weighted engineering estimates

- core architecture/domain/database/platform: **~99%**
- first end-to-end Pix Sandbox MVP: **~99%**
- production-capable Pix V1: **~62%**
- weighted V1 engineering completion: **~79%**

These percentages are risk/effort-weighted, not file counts and not a claim that production launch is 79% safe. The hosted database/runtime Sandbox path is now proven. The remaining Sandbox gap is deployed HTTP/browser compute and secret injection. Production risk remains dominated by provider evidence/activation and launch operations.

## Latest accepted work on A25 canonicalization branch

### A25 — hosted runtime identity + Sandbox DB E2E — `DONE / GREEN / HOSTED / DATABASE-RUNTIME-E2E`

- Problem Analysis: `docs/design/a25-hosted-runtime-identity-sandbox-e2e-problem-analysis.md`
- Spec: `docs/specs/hosted-runtime-identity-sandbox-e2e-v0.yaml`
- Contract: `docs/contracts/hosted-runtime-identity-sandbox-e2e-v0.md`
- Application contract: `tests/application/067_a25_hosted_runtime_identity_sandbox_e2e.contract.test.mjs`
- Bootstrap: `ops/sql/bootstrap-hosted-runtime-identities.sql`
- Local K6 helper: `scripts/provision-local-runtime-identities`
- Evidence: `docs/evidence/application/2026-08-21-a25-hosted-runtime-identity-sandbox-db-e2e.md`
- Formal RED SHA `c83690f41d2f1d7b5d4cce613905853c7fa8508c`, workflow `32544773993`: 397 total, 395 PASS, exactly two intended failures for the absent shared bootstrap and K6 reuse.
- Initial A25 GREEN workflows: Application `32544895450`, Database `32544895405`.
- Hosted bootstrap applied outside migration history, credentialless.
- Hosted exact runtime memberships: API runtime → `swiftpay_api`; worker runtime → `swiftpay_worker`.
- Hosted capabilities remain exactly **30 API / 6 worker**, Data API `app` EXECUTE **0**, direct runtime `app` ACL **0**.
- Positive hosted Sandbox DB smoke executed as `current_user=swiftpay_api_runtime` in one transaction.
- Proven flow: Payment Link create/replay, Production fail-closed, cross-tenant denial, public projection, checkout prepare/replay/conflict, single-winner claim, resolver success, completed replay/conflict.
- Pre-rollback deltas: exactly +1 Payment Link, +1 Payment, +1 ProviderAttempt; no paid transition, ledger posting, job, payout, refund or retained provider I/O.
- Explicit rollback returned all synthetic/business rows to zero.
- PostgreSQL 17 creator-admin semantics are now frozen correctly: automatic creator membership may remain `ADMIN TRUE, SET FALSE, INHERIT FALSE`; temporary smoke SET/INHERIT authority must return false.
- This scope does **not** prove deployed Fastify/HTTP/Vercel/browser E2E or install a hosted runtime password.

### A26 — A23 JSONB object arity runtime fix — `DONE / GREEN / HOSTED / DATABASE-ONLY`

- Problem Analysis: `docs/design/a26-a23-jsonb-object-arity-runtime-fix-problem-analysis.md`
- Spec: `docs/specs/a23-jsonb-object-arity-runtime-fix-v0.yaml`
- Contract: `docs/contracts/a23-jsonb-object-arity-runtime-fix-v0.md`
- Test: `supabase/tests/database/047_a23_jsonb_object_arity_runtime_fix.test.sql`
- Migration: `supabase/migrations/20260822025900_a23_jsonb_object_arity_runtime_fix.sql`
- Evidence: `docs/evidence/application/2026-08-21-a26-a23-jsonb-object-arity-runtime-fix.md`
- Formal RED workflow `32545329166`: 47 files / 1397 assertions, failures isolated to the nonexistent `pg_catalog.jsonb_object_length(jsonb)` usage.
- Repair uses `count(*)` over `pg_catalog.jsonb_object_keys(jsonb)` and changes only affected A23 functions.
- Hosted migration version: `20260822031801_a23_jsonb_object_arity_runtime_fix`.
- No capability/provider/financial authority change.

### A27 — A23 COALESCE special-form runtime fix — `DONE / GREEN / HOSTED / DATABASE-ONLY`

- Problem Analysis: `docs/design/a27-a23-coalesce-special-form-runtime-fix-problem-analysis.md`
- Spec: `docs/specs/a23-coalesce-special-form-runtime-fix-v0.yaml`
- Contract: `docs/contracts/a23-coalesce-special-form-runtime-fix-v0.md`
- Test: `supabase/tests/database/048_a23_coalesce_special_form_runtime_fix.test.sql`
- Migration: `supabase/migrations/20260822030500_a23_coalesce_special_form_runtime_fix.sql`
- Evidence: `docs/evidence/application/2026-08-21-a27-a23-coalesce-special-form-runtime-fix.md`
- Exact defect count: six invalid `pg_catalog.coalesce(...)` references in `_a23_resolve_payment_link_pix_attempt`.
- GREEN database baseline after A27: **48 files / 1403 pgTAP assertions PASS**; #047 15/15 and #048 6/6 PASS.
- Hosted migration version: `20260822031818_a23_coalesce_special_form_runtime_fix`.
- No capability/provider/financial authority change.

### Integrated A25+A26+A27 CI

Integrated head before final documentation: `ea1914bc9a9c50f2bcb1f67585350bef098555f9`.

- Application workflow `32548379380`: application contracts + runtime DB acceptance GREEN, including K7/A14/A18/A1-A9.
- Database workflow `32548379307`: pgTAP and K5 GREEN; first runtime-topology job hit a runner port-54322 collision before tests.
- Isolated runtime-topology retry job `96971120366`: Postgres startup, provisioning, K6 structural contracts, API own connection and worker own connection all GREEN.
- Runner port collision is classified as infrastructure, not code.

## Prior accepted work

### A24 — checkout abuse-policy constraint repair — `DONE / GREEN / HOSTED / DATABASE-ONLY`

- Problem Analysis: `docs/design/a24-checkout-abuse-policy-constraint-problem-analysis.md`
- Spec: `docs/specs/checkout-abuse-policy-constraint-v0.yaml`
- Contract: `docs/contracts/checkout-abuse-policy-constraint-v0.md`
- Test: `supabase/tests/database/046_checkout_abuse_policy_constraint.test.sql`
- Migration: `supabase/migrations/20260822012000_checkout_abuse_policy_constraint.sql`
- Evidence: `docs/evidence/application/2026-08-21-a24-checkout-abuse-policy-constraint.md`
- RED Database workflow `32542942243`: existing #001-#045 GREEN; A24 #046 failed exactly 4/14 intended assertions; K5/K6 GREEN.
- GREEN Application workflow `32543077528`: install/typecheck/build/application contracts GREEN; K7/A14/A18/A1-A9 real PostgreSQL acceptance GREEN.
- GREEN Database workflow `32543077585`: **46 files / 1382 pgTAP assertions PASS**; K5/K6 GREEN.
- Hosted migration history: `20260822012110_checkout_abuse_policy_constraint`.

### A23 — hosted Pix checkout + Payment Links — `DONE / GREEN / HOSTED / SANDBOX-ONLY`

- Problem Analysis: `docs/design/a23-hosted-pix-checkout-payment-links-problem-analysis.md`
- Spec: `docs/specs/hosted-pix-checkout-payment-links-v0.yaml`
- Contract: `docs/contracts/hosted-pix-checkout-payment-links-v0.md`
- Evidence: `docs/evidence/application/2026-08-21-a23-hosted-pix-checkout-payment-links.md`
- A26/A27 supersede the two runtime compatibility defects exposed only by A25 hosted execution.
- Production remains fail-closed; no retained PSP authority is granted.

### A21-A22 merchant dashboard — `DONE`

- A21 merchant dashboard web foundation: `DONE / GREEN / HOSTED`.
- A22 API credential + webhook settings UI: `DONE / GREEN / APPLICATION-ONLY`.
- Dashboard supports login/session refresh/logout, merchant/environment context, transaction list/detail, API credential administration and webhook endpoint administration.
- Secrets remain one-time/ephemeral; browser has no direct financial/database/provider authority.

### A12-A20 production/security foundations — `DONE` for frozen scopes

- A12 safe structured logging/correlation
- A13 bounded operational metrics/OpenMetrics
- A14 distributed ingress abuse/rate limiting
- A15 machine access-token signing-key rotation
- A16 dashboard cursor HMAC rotation
- A17 legacy webhook AES persisted-secret retirement
- A18 abuse-subject HMAC rotation
- A19 Fastify LogController compatibility
- A20 exact runtime capability manifest/attestation

Current hosted capability baseline remains exactly **30 API / 6 worker**.

## Current hosted security state

- canonical project healthy and migration history includes A23/A24/A26/A27;
- `app.payment_links` RLS enabled;
- Data API (`anon`, `authenticated`, `service_role`) effective `app` EXECUTE: 0;
- direct trusted-runtime protected-table privileges remain capability/RPC-scoped;
- Payments / ProviderAttempts / Payment Links: 0 / 0 / 0 after final A25 rollback;
- retained-provider monetary calls during A23-A27/A25 validation: 0;
- hosted runtime password installed by A25: no;
- invalid A23 compatibility references after A26/A27: 0;
- Security Advisor INFO `rls_enabled_no_policy` for intentionally private `app.payment_links` remains accepted under the current deny-all/Data-API-isolated boundary.

## Provider evidence / MagicPay input

Current retained-provider production authority remains zero.

A new MagicPay credential set and provider documentation URL have been supplied out-of-repository for evaluation. Those secrets MUST NOT enter Git, durable docs, browser code, test snapshots, logs or CI variables by accident.

Before MagicPay can become an activated provider, a dedicated provider slice must still establish:

1. provider-owned/current endpoint and authentication contract;
2. environment classification (Sandbox/homologation vs Production);
3. exact create/query/idempotency and ambiguous-execution recovery semantics;
4. webhook authentication/replay identity;
5. current status vocabulary and rate-limit evidence;
6. authenticated non-destructive proof first;
7. fail-first adapter/bridge tests;
8. explicit A10 activation transition only after evidence closes.

The existence of keys alone is not activation authority.

## Remaining product work

### Merchant product

- KYC/compliance operational workflow + UI — `PENDING`
- payout merchant-usable API/UI — `PENDING`
- refund merchant-usable API/UI — `PENDING`
- reporting/analytics merchant UI — `PENDING`
- deployed HTTP/browser Sandbox checkout E2E using actual V2 API compute — `PENDING`
- Production checkout/Payment Links over an activated retained PSP — `BLOCKED ON PSP EVIDENCE`

### Provider/reconciliation

- MagicPay current executable contract/evidence — `EVIDENCE_REQUIRED / IN INVESTIGATION`
- authenticated provider non-destructive/Sandbox proof — `BLOCKED UNTIL ENVIRONMENT/ENDPOINT CONTRACT IS CONFIRMED`
- retained-provider A5→A11 bridge — `BLOCKED ON EVIDENCE`
- provider webhook ingress — `BLOCKED ON EVIDENCE`
- provider recovery/reconciliation runtime — `BLOCKED ON EVIDENCE`

### Operations / launch hardening

- server-side runtime database credential/bootstrap/rotation contract — `PENDING`
- actual V2 API/worker/dashboard/checkout deployment contract — `PENDING`
- deployed HTTP runtime E2E — `PENDING`
- backup/restore and disaster-recovery verification — `PENDING`
- cutover/rollback/incident runbooks — `PENDING`
- production secrets/bootstrap/rotation drills — `PENDING`
- external metrics collection + dashboards + alerts/SLO policy — `PENDING`
- production-like load/capacity testing — `PENDING`
- measured database/index/performance tuning — `PENDING`
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
  -> current PSP evidence                             EVIDENCE_REQUIRED
       -> MagicPay current contract/environment       IN INVESTIGATION
       -> authenticated safe provider proof           BLOCKED UNTIL CONTRACT CONFIRMED
       -> A5→A11 provider bridge                      BLOCKED
       -> live provider activation                    BLOCKED

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

## Changed files in A25 canonicalization closure

- `docs/design/a25-hosted-runtime-identity-sandbox-e2e-problem-analysis.md`
- `docs/specs/hosted-runtime-identity-sandbox-e2e-v0.yaml`
- `docs/contracts/hosted-runtime-identity-sandbox-e2e-v0.md`
- `tests/application/067_a25_hosted_runtime_identity_sandbox_e2e.contract.test.mjs`
- `ops/sql/bootstrap-hosted-runtime-identities.sql`
- `scripts/provision-local-runtime-identities`
- `docs/evidence/application/2026-08-21-a25-hosted-runtime-identity-sandbox-db-e2e.md`
- A26/A27 design/spec/contract/test/migrations/evidence artifacts
- `TODOS.md`
- `docs/product/v1-readiness-status.md`
- `docs/product/v1-functional-checklist.md`

## Immediate next action

1. run final A25 branch CI after the contract/evidence/TODO/readiness closure;
2. merge PR #5 only after required Application checks are GREEN and previously accepted Database evidence remains intact;
3. freeze the next **deployed HTTP runtime E2E** slice: server-side runtime DB credential bootstrap/rotation + actual V2 API/checkout deployment, without reusing unrelated historical Vercel projects;
4. in parallel, acquire/verify MagicPay's current executable API contract and environment semantics without committing the supplied credentials;
5. only after provider evidence and authenticated safe proof, implement a dedicated provider bridge and deliberate A10 activation transition;
6. no live withdrawal or uncontrolled monetary request is authorized during provider discovery.
