# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-21 (America/Santarem)

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
- Latest accepted merge: PR #4 — A24, merge commit `4beb379bf62afe26faaf720d7698a4698988aa2f`
- No active implementation slice at this checkpoint; the next behavior starts again at `PROBLEM_ANALYSIS`.
- Canonical hosted Supabase: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
- K1-K7: `DONE`
- A1-A24: `DONE` for their frozen scopes.
- A5 remains `DONE / FIXTURE-ONLY` for live retained-provider authority.
- A10 remains default-deny: repository defaults authorize zero retained-provider operations.
- A11 strict HTTPS transport remains intentionally unbound from retained A5 adapters.
- Current retained-provider contract/sandbox gate remains `EVIDENCE_REQUIRED` / externally blocked.

### Current risk-weighted engineering estimates

- core architecture/domain/database/platform: **~99%**
- first end-to-end Pix Sandbox MVP: **~98%**
- production-capable Pix V1: **~62%**
- weighted V1 engineering completion: **~78%**

These percentages are risk/effort-weighted, not file counts and not a claim that production launch is 78% safe. Roughly **~22% of weighted V1 engineering** remains, while approximately **~38% of production-capability/risk closure** remains because the hardest open work is provider authority and launch operations.

## Latest accepted work

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
- Final documentation HEAD also reran GREEN before merge: Application `32543357285`, Database `32543357255`.
- Hosted migration history: `20260822012110_checkout_abuse_policy_constraint`.
- Hosted checkout quota smoke: allowed=true, remaining=119, retry_after_seconds=0; rollback left no smoke row.
- Hosted authority after repair: exactly **30 API / 6 worker**, Data API `app` EXECUTE 0, Payments 0, ProviderAttempts 0.
- Change is only the persisted A14/A18 policy CHECK vocabulary; quota limits/HMAC semantics/function identity/provider/financial behavior are unchanged.

### A23 — hosted Pix checkout + Payment Links — `DONE / GREEN / HOSTED / SANDBOX-ONLY`

- Problem Analysis: `docs/design/a23-hosted-pix-checkout-payment-links-problem-analysis.md`
- Spec: `docs/specs/hosted-pix-checkout-payment-links-v0.yaml`
- Contract: `docs/contracts/hosted-pix-checkout-payment-links-v0.md`
- Repository evidence: `docs/evidence/application/2026-08-21-a23-hosted-pix-checkout-payment-links.md`
- A24 final hosted evidence supersedes the earlier `HOSTED DEPLOY PENDING` checkpoint.
- Application baseline: **393/393 PASS** on final A23 consolidation before A24 DB-only repair.
- Database baseline before A24: **45 files / 1368 pgTAP assertions PASS**.
- Hosted A23 migration history entries:
  - `20260822011210_hosted_pix_checkout_payment_links`
  - `20260822011224_a23_checkout_quota_special_forms_fix`
- Adds Sandbox-only hosted checkout and fixed-amount Payment Links, anonymous same-origin checkout API path and merchant dashboard link management.
- Production remains fail-closed; no retained PSP authority is granted.
- Hosted project currently has no merchant/provider fixture data, so a positive hosted end-to-end Pix creation smoke still requires controlled runtime fixture/bootstrap rather than persistent ad-hoc production data.

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

Current hosted capability baseline after A23/A24 is exactly **30 API / 6 worker**.

## Current hosted security state

- canonical project healthy and migration history includes A23 + A24;
- `app.payment_links` RLS: enabled;
- Data API (`anon`, `authenticated`, `service_role`) effective `app` EXECUTE: 0 at latest attestation;
- direct trusted-runtime protected-table privileges: 0 at A23 post-DDL attestation;
- Payments / ProviderAttempts / Payment Links: 0 / 0 / 0 after hosted smoke;
- retained-provider monetary calls during A23/A24: 0;
- Security Advisor: one INFO `rls_enabled_no_policy` for intentionally private `app.payment_links`; no policy was added outside a dedicated contract.

## Critical external blocker — live retained PSP

A5 + A10 + A11 still authorize **zero live retained-provider operations**.

Before any production provider activation we still require:

1. provider-owned current contract/lineage evidence;
2. exact authentication/create/query/idempotency/recovery semantics;
3. exact webhook authentication/replay identity;
4. current status vocabulary and rate-limit evidence;
5. authenticated current Sandbox proof;
6. deliberate A5→A11 bridge Problem Analysis/spec/contracts/RED/GREEN;
7. explicit A10 activation state transition only after evidence closes.

AkkadPag/AkadPay and FlevoPay remain blocked on these gates. No live monetary call is authorized.

## Remaining product work

### Merchant product

- KYC/compliance operational workflow + UI — `PENDING`
- payout merchant-usable API/UI — `PENDING`
- refund merchant-usable API/UI — `PENDING`
- reporting/analytics merchant UI — `PENDING`
- positive hosted Sandbox checkout E2E with controlled merchant/emulator fixture/runtime deployment — `PENDING`
- Production checkout/Payment Links over an activated retained PSP — `BLOCKED ON PSP EVIDENCE`

### Provider/reconciliation

- current retained PSP executable contract — `EVIDENCE_REQUIRED`
- authenticated provider Sandbox proof — `BLOCKED ON EVIDENCE`
- A5→A11 live bridge — `BLOCKED ON EVIDENCE`
- provider webhook ingress — `BLOCKED ON EVIDENCE`
- provider recovery/reconciliation runtime — `BLOCKED ON EVIDENCE`

### Operations / launch hardening

- production API/worker/dashboard/checkout deployment contract — `PENDING`
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
       -> authenticated provider Sandbox proof        BLOCKED
       -> A5→A11 provider bridge                      BLOCKED
       -> live provider activation                    BLOCKED

Merchant path:
  -> A6-A9 trusted merchant APIs                      DONE
  -> A21 dashboard foundation                        DONE / HOSTED
  -> A22 integration settings UI                     DONE
  -> A23 Sandbox checkout + Payment Links            DONE / HOSTED
  -> A24 checkout admission DB repair                DONE / HOSTED
  -> positive hosted Sandbox E2E fixture/runtime      PENDING
  -> KYC/payout/refund/reporting                     PENDING

Production-hardening path:
  -> A12-A20 security/telemetry/runtime hardening     DONE
  -> external observability/alerts/SLOs              PENDING
  -> load/capacity + network/WAF                     PENDING
  -> deploy/backup/cutover/rollback                  PENDING
  -> production PSP activation                       BLOCKED ON EVIDENCE
```

## Changed files in A24

- `docs/design/a24-checkout-abuse-policy-constraint-problem-analysis.md`
- `docs/specs/checkout-abuse-policy-constraint-v0.yaml`
- `docs/contracts/checkout-abuse-policy-constraint-v0.md`
- `supabase/tests/database/046_checkout_abuse_policy_constraint.test.sql`
- `supabase/migrations/20260822012000_checkout_abuse_policy_constraint.sql`
- `docs/evidence/application/2026-08-21-a24-checkout-abuse-policy-constraint.md`
- `TODOS.md`
- `docs/product/v1-readiness-status.md`
- `docs/product/v1-functional-checklist.md`

## Immediate next action

1. protect `main` with required Application/Database checks;
2. freeze a controlled positive hosted Sandbox E2E/bootstrap slice so A23 is exercised through deployed API/runtime without seeding ad-hoc production data;
3. continue current provider-owned contract evidence acquisition in parallel;
4. do not wire or activate AkkadPag/AkadPay/FlevoPay until current-contract + authenticated-Sandbox gates close;
5. after the positive hosted Sandbox E2E, take the highest-risk launch slice: deployment/cutover/backup/rollback or merchant KYC/payout/refund, chosen by explicit Problem Analysis rather than speculative implementation.
