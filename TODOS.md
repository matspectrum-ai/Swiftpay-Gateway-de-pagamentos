# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-21

This is the durable backlog and handoff ledger for the reconstruction. Repository artifacts are the source of truth. Detailed proof lives in specs, contracts, migrations, tests and `docs/evidence/**`; Git history preserves checkpoint chronology.

Executive readiness checkpoint: `docs/product/v1-readiness-status.md`.  
Living functional checklist: `docs/product/v1-functional-checklist.md`.

## States

- `PENDING`: known, not started
- `PROBLEM_ANALYSIS`: problem boundary is actively being investigated/frozen; no spec or implementation authority yet
- `TDD_RED`: problem/spec/contracts are frozen and fail-first tests prove only the intended behavior/structure is missing; implementation is authorized next
- `IN_PROGRESS`: actively being implemented after the applicable planning/TDD boundary exists
- `EVIDENCE_REQUIRED`: implementation cannot safely advance without stronger current evidence
- `BLOCKED`: cannot proceed without an external dependency or unresolved contract
- `DONE`: contract, implementation and required evidence are complete
- `DEFERRED`: intentionally outside the current critical path
- `DROPPED`: explicitly removed from scope
- `SUPERSEDED`: replaced by a later canonical artifact

## Current checkpoint

- Consolidation source: `agent/foundation-phase-0`
- Canonical consolidation PR: #1 — `foundation: establish SwiftPay V2 reconstruction baseline`
- Canonical source after this consolidation: `main`; historical `agent/foundation-phase-0-*` branches are checkpoint/superseded lineage and must not be merged independently unless a later audit proves unique missing work.
- Canonical hosted Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
- K1-K7: `DONE`
- A1-A23: `DONE` for their frozen repository/CI scopes.
- A23: `DONE / GREEN / SANDBOX-ONLY / HOSTED DEPLOY PENDING`.
- A5 remains `DONE / FIXTURE-ONLY` for live-provider authority.
- A10 remains executable default-deny with zero retained-provider operations authorized by repository defaults.
- A11 remains strict outbound HTTPS and intentionally unbound from retained A5 adapters.
- Current retained-provider contract/sandbox gate remains `EVIDENCE_REQUIRED` / externally blocked.

Current engineering estimates remain conservative and unchanged by A23 until hosted/launch risk is retired:

- core architecture/domain/database/platform: **~99%**
- first end-to-end Pix sandbox MVP: **~97%**
- production-capable Pix V1: **~60%**
- weighted V1 engineering completion: **~75%**

Important product-surface qualifier: these percentages are engineering/risk-weighted and are not a claim that the merchant-facing visual product is 75-97% complete. A21 provides the merchant web application foundation, A22 adds functional API-credential and webhook settings, and A23 adds Sandbox-only hosted Pix checkout + Payment Links. KYC/payout/refund, broader reporting and production provider/cutover work remain separate slices.

Current hosted/runtime split after A23 repository GREEN:

- repository/CI exact capability contract: **30 API / 6 worker**;
- canonical hosted Supabase remains pre-A23 at **25 API / 6 worker** until the two A23 migrations are deliberately deployed and re-attested;
- A23 hosted migrations are checked in but not yet present in hosted migration history.

Current external critical blocker:

- exact current PSP contract/lineage/auth/create/query/idempotency/recovery/webhook-auth evidence;
- authenticated current sandbox proof for the selected retained provider contract.

Do not bridge A5 retained adapters to A11 and do not promote A10 provider authority until those evidence gates close.

## Latest accepted slices

### A23 — hosted Pix checkout + Payment Links — `DONE / GREEN / SANDBOX-ONLY / HOSTED DEPLOY PENDING`

- Problem Analysis: `docs/design/a23-hosted-pix-checkout-payment-links-problem-analysis.md`
- Spec: `docs/specs/hosted-pix-checkout-payment-links-v0.yaml`
- Contract: `docs/contracts/hosted-pix-checkout-payment-links-v0.md`
- Evidence: `docs/evidence/application/2026-08-21-a23-hosted-pix-checkout-payment-links.md`
- Behavioral GREEN head before evidence/handoff documentation: `fd3ad0ed32b7eadd0f3f82178181864f02534680`.
- Final Application workflow `32529455364`: typecheck/build GREEN, **393/393 application contracts PASS**, including **10/10 A23**, plus K7/A14/A18/A1-A9 real-PostgreSQL runtime acceptance GREEN.
- Final Database workflow `32529455405`: **45 files / 1368 pgTAP assertions PASS**, including `045_hosted_pix_checkout_payment_links.test.sql`, with K5 deterministic fixtures and K6 runtime topology GREEN.
- A23 introduces Sandbox-only fixed-amount Payment Links, opaque public tokens, anonymous same-origin checkout read/create routes, `source='payment_link'`, dashboard management, a separate anonymous checkout SPA and A14/A18 admission control reuse.
- A2 machine creation remains `source='api'` and is not weakened; A23 uses the deterministic Sandbox emulator/attempt claim-resolve path without authorizing retained PSP traffic.
- Production checkout/payment-link creation remains fail-closed; A10 default retained-provider authority remains zero.
- Repository/CI exact runtime capability set is now **30 API / 6 worker**.
- Checked-in migrations: `20260819163000_hosted_pix_checkout_payment_links.sql` and `20260820041000_a23_checkout_quota_special_forms_fix.sql`.
- Hosted `swiftpay v2` has **not** applied those two migrations at this checkpoint and therefore remains at the pre-A23 **25 API / 6 worker** hosted baseline.
- Final consolidation repaired only stale test/CI assumptions: canonical A3/A4 runtime script paths and A8/A9 pre-A23 capability-count assertions. No production contract was weakened.

### A22 — merchant dashboard integration settings UI — `DONE / GREEN / APPLICATION-ONLY`

- Problem Analysis: `docs/design/a22-merchant-dashboard-integration-settings-ui-problem-analysis.md`
- Spec: `docs/specs/merchant-dashboard-integration-settings-ui-v0.yaml`
- Contract: `docs/contracts/merchant-dashboard-integration-settings-ui-v0.md`
- Evidence: `docs/evidence/application/2026-08-19-a22-merchant-dashboard-integration-settings-ui.md`
- Accepted implementation head: `2647d4da55d9344a139cd9a0e18cd316f2d1f12f`.
- RED workflow `32259787311`: **375/383 PASS**, exactly eight intended A22 absence failures; existing runtime regression GREEN.
- GREEN Application workflow `32262432986`: **383/383 PASS**, typecheck/build GREEN.
- Same-SHA runtime rerun job `96099664047`: K7/A14/A18/A1-A9 all GREEN.
- Database workflow `32262432998`: **44 files / 1340 pgTAP assertions PASS**, K5/K6 GREEN.
- API-credential settings now support list/create/rotate/revoke; webhook settings support list/create/disable/enable/disabled-URL edit/rotate.
- A8 `secretKey` and A7 `signingSecret` remain one-time-only and ephemeral in browser component state; no browser secret persistence was introduced.
- Browser role gating is presentation only; A7/A8 server-side role and AAL2 authority remains canonical.
- A22 adds no migration, backend route, provider call, financial authority or runtime capability; its accepted hosted capability checkpoint was exactly **25 API / 6 worker**.

### A21 — merchant dashboard web foundation — `DONE / GREEN / HOSTED`

- Problem Analysis: `docs/design/a21-merchant-dashboard-web-foundation-problem-analysis.md`
- Spec: `docs/specs/merchant-dashboard-web-foundation-v0.yaml`
- Contract: `docs/contracts/merchant-dashboard-web-foundation-v0.md`
- Evidence: `docs/evidence/application/2026-08-19-a21-merchant-dashboard-web-foundation.md`
- Accepted behavior/fix head before evidence documentation: `98b7b24073e8291a16984492236b4bf1339c0d6f`.
- Application workflow `32257443845`: **372/372 PASS**, typecheck/build GREEN.
- Real PostgreSQL runtime rerun job `96084137179`: K7/A14/A18/A1-A9 all GREEN.
- Database workflow `32257443899`: **44 files / 1340 pgTAP assertions PASS**, K5/K6 GREEN.
- Hosted migration: `20260819132759_dashboard_context_discovery`.
- A18 concurrency repair hosted migration: `20260819132824_abuse_subject_hmac_rotation_canonical_insert_order`.
- Hosted exact capability attestation: missing **0**, extra **0**, API **25**, worker **6**.
- Hosted Data API EXECUTE on touched functions: **0**; direct API/worker protected-relation DML: **0 / 0**.
- Hosted Security Advisor: **0 lints**; Payments/ProviderAttempts: **0 / 0**.
- `apps/dashboard` provides login/session refresh/logout, merchant/environment selection, transaction list/detail and explicit empty/error/session-expired states.
- Browser authority remains Supabase Auth + SwiftPay API only; no direct database/provider/financial authority was introduced.

### A20 — runtime capability manifest & exact attestation — `DONE / GREEN / HOSTED-ATTESTED`

- Problem Analysis: `docs/design/a20-runtime-capability-manifest-attestation-problem-analysis.md`
- Spec: `docs/specs/runtime-capability-manifest-attestation-v0.yaml`
- Contract: `docs/contracts/runtime-capability-manifest-attestation-v0.md`
- Evidence: `docs/evidence/application/2026-08-19-a20-runtime-capability-manifest-attestation.md`
- Canonical manifest: `ops/security/runtime-capabilities-v0.json`
- Accepted implementation head: `b9188cf7954af70f464fbab50f5776c1ee5e9269`
- RED application workflow `32217764269`: **359/362 PASS**, exactly three expected A20 artifact-absence failures; A1-A19 remained GREEN.
- GREEN application workflow `32217961040`: **362/362 PASS**, typecheck/build GREEN and full real PostgreSQL runtime regression GREEN.
- Database workflow `32217961050`: pgTAP/K5/K6+A20 runtime topology all GREEN.
- Hosted exact `regprocedure` attestation: missing **0**, extra **0**, API **24**, worker **6**.
- Hosted authorized functions lacking `SECURITY DEFINER`: **0**; lacking explicit `search_path`: **0**.
- Hosted direct `app` table privileges for API/worker: **0 / 0**.
- Hosted `anon`/`authenticated`/`service_role` effective `app` EXECUTE capabilities: **0**.
- Hosted Security Advisor: **0 lints**.
- Hosted Payment/ProviderAttempt rows: **0 / 0**.
- A20 introduces no migration, GRANT/REVOKE, provider bridge, route or financial authority.

### A19 — Fastify LogController compatibility — `DONE / GREEN / APPLICATION-ONLY`

- Problem Analysis: `docs/design/a19-fastify-log-controller-compatibility-problem-analysis.md`
- Spec: `docs/specs/fastify-log-controller-compatibility-v0.yaml`
- Contract: `docs/contracts/fastify-log-controller-compatibility-v0.md`
- Evidence: `docs/evidence/application/2026-08-19-a19-fastify-log-controller-compatibility.md`
- Accepted implementation head: `3882a691ced38e0403ec741d544c8f8b66c17f82`
- RED workflow `32216969526`: **356/358 PASS**, with exactly the two intended A19 failures.
- GREEN application workflow `32217137426`: **358/358 PASS**, typecheck/build GREEN, full real-runtime regression GREEN.
- Database workflow `32217137442`: **43 files / 1326 pgTAP assertions PASS**, K5/K6 GREEN.
- Fastify top-level `disableRequestLogging` compatibility debt is closed through the stock `LogController` path.
- A12 remains the sole SwiftPay safe HTTP logging authority; A13 metrics remain unchanged.
- No database migration, hosted Supabase change, worker authority, provider call or monetary authority change.

### A18 — abuse-subject HMAC key rotation — `DONE / GREEN / HOSTED`

- Problem Analysis: `docs/design/a18-abuse-subject-hmac-key-rotation-problem-analysis.md`
- Spec: `docs/specs/abuse-subject-hmac-key-rotation-v0.yaml`
- Contract: `docs/contracts/abuse-subject-hmac-key-rotation-v0.md`
- Evidence: `docs/evidence/application/2026-08-19-a18-abuse-subject-hmac-key-rotation.md`
- Accepted implementation head: `15958e178f9496fc273d5576b38ad125134b59dc`
- Application workflow `32210344185`: **353/353 PASS**, including real-database A18 concurrency acceptance.
- Database workflow `32210344189`: **43 files / 1326 pgTAP assertions PASS**, K5/K6 GREEN.
- Hosted migration: `20260819043811_abuse_subject_hmac_key_rotation`.
- Hosted quota RPC: exactly one `app.consume_api_abuse_quota(text,text,text)` with one trailing default for A14 two-argument compatibility.
- Hosted API/worker `app` EXECUTE totals remain exactly **24 / 6** at that accepted checkpoint.
- Hosted Security Advisor: **0 lints**.
- Hosted smoke was rolled back; `app.api_abuse_windows`, Payments and ProviderAttempts remained **0 / 0 / 0** after the check.
- One active + at most one previous continuity key; no raw subject/key material reaches PostgreSQL.

### A17 — legacy webhook AES secret retirement — `DONE / GREEN / HOSTED`

- Evidence: `docs/evidence/application/2026-08-18-a17-legacy-webhook-aes-secret-retirement.md`
- Accepted implementation head: `e7c41e9a416cf454724b8167a5d17c9bf1c19e08`
- Application workflow `32168309740`: **344/344 PASS**.
- Database workflow `32168309894`: **42 files / 1304 pgTAP assertions PASS**, K5/K6 GREEN.
- Hosted migration: `20260818175935_legacy_webhook_aes_secret_retirement`.
- Persisted merchant webhook secret-version authority is RSA-OAEP-SHA256 only; legacy AES compatibility authority is retired.
- Hosted API/worker `app` EXECUTE totals remained **24 / 6**; Security Advisor remained **0 lints**.

## Non-negotiable delivery method

Every new behavior follows this order:

1. Problem Analysis
2. YAML Specification
3. Contracts/interfaces
4. Tests first — RED
5. Minimal implementation — GREEN
6. Refactor without behavior drift
7. Evidence + handoff update

No live PSP integration may bypass deterministic emulator, provider-conformance, A10 activation or A11 transport-safety gates. No merchant/browser surface receives direct financial authority. Ambiguous monetary execution remains explicit `execution_unknown`/recovery state; it is never converted into fabricated definitive failure.

---

# Phase 0 — Reconstruction truth and target architecture

## Product/reverse-engineering baseline — `DONE`

Canonical artifacts establish a Pix-first TypeScript modular monolith with Fastify trusted API, separate worker, Supabase/PostgreSQL canonical state, provider-agnostic Payment Core, append-oriented financial/audit semantics, durable jobs and merchant webhooks.

AkkadPag and FlevoPay remain the retained historical provider targets behind current-contract evidence gates. Current AkadPay/FlevoPay material must not be treated as implicit lineage compatibility.

---

# Phase 1 — Database and financial core

- Identity, compliance and provider catalog — `DONE`
- Payment idempotency and provider events — `DONE`
- Ledger foundation — `DONE`
- Durable jobs — `DONE`
- Merchant webhook persistence — `DONE`
- Payout/refund database foundations — `DONE`
- Financial reservations — `DONE`
- Internal/provider reconciliation foundations — `DONE`

Remaining product execution:

- payout/refund merchant-usable application/API/UI — `PENDING`
- live-provider reconciliation — `BLOCKED ON CURRENT PSP EVIDENCE`

---

# Phase 2 — Supabase security and trusted runtime foundation

- K1 private schema / Data API boundary — `DONE`
- K2 append-only audit events — `DONE`
- K3 dashboard membership authorization — `DONE`
- K4 trusted runtime database boundary — `DONE`
- K5 deterministic local sandbox fixtures — `DONE`
- K6 trusted runtime deployment topology — `DONE`
- K7 executable API/worker runtime bootstrap — `DONE`
- A20 exact runtime capability manifest/attestation — `DONE / GREEN / HOSTED-ATTESTED`

Runtime identities remain separate and capability-scoped. The repository/CI post-A23 exact capability set is **30 API / 6 worker**. The canonical hosted project remains at the pre-A23 **25 API / 6 worker** checkpoint until A23 migrations are deployed. Public/Data API `app` authority and direct protected app-table privileges remain forbidden.

---

# Phase 3 — Public API authentication and deterministic Pix lifecycle

- A1 API credential token exchange and Bearer authentication — `DONE`
- A2 authenticated Pix create/get emulator — `DONE`
- A3 paid transition + ledger + balance — `DONE`
- A4 merchant webhook delivery runtime — `DONE / HOSTED`

The deterministic emulator remains the only implemented Pix execution path authorized without retained-provider evidence.

---

# Phase 4 — PSP conformance and live Pix providers

## A5 — provider conformance fixtures — `DONE / FIXTURE-ONLY`

Evidence: `docs/evidence/application/2026-08-16-a5-provider-conformance-fixtures.md`.

A5 establishes sanitized deterministic adapter fixtures and conservative `execution_unknown` semantics but grants no current live-provider authority.

## A10 — provider activation & outbound safety — `DONE / GREEN / NETWORK-FREE`

Evidence: `docs/evidence/application/2026-08-17-a10-provider-activation-outbound-safety.md`.

Exact activation subject is provider + operation + environment + contract lineage. Current default registry authorizes zero runtime retained-provider operations.

## A11 — strict provider HTTP transport — `DONE / GREEN / UNBOUND`

Evidence: `docs/evidence/application/2026-08-17-a11-strict-provider-http-transport.md`.

A11 is the sole approved provider-package Node network boundary, but retained A5 adapters are explicitly not wired to it.

## Current-provider contract evidence gate — `EVIDENCE_REQUIRED`

Canonical evidence pack:

- `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`
- `docs/evidence/providers/2026-08-18-current-provider-contract-critical-path-refresh.md`
- `docs/evidence/providers/2026-08-18-provider-contract-evidence-acquisition-pack.md`

### AkkadPag / AkadPay

Current public AkadPay material does not prove provider-owned contractual lineage/equivalence with retained `akkadpag-legacy-api-v1`. Exact query/recovery and cryptographic webhook verification also remain incomplete.

Required before activation:

- provider-owned lineage/equivalence or deliberate provider replacement decision;
- exact current auth/create/query/idempotency/recovery semantics;
- exact webhook authentication/replay identity;
- current status vocabulary/rate limits;
- authenticated sandbox proof.

### FlevoPay

Current provider-owned material proves authentication drift from the retained historical adapter. Exact current executable create/query/recovery/webhook/idempotency contract remains incomplete.

Required before activation:

- current provider-owned create/query technical contract or authenticated current sandbox proof;
- authoritative recovery identifier and idempotency semantics;
- exact webhook authentication/replay identity;
- current status vocabulary/rate limits;
- exact Pix-out contract before capability reconsideration.

Current state:

- AkkadPag live bridge/activation — `BLOCKED ON CURRENT EVIDENCE`
- FlevoPay live bridge/activation — `BLOCKED ON CURRENT EVIDENCE`
- Provider webhook ingress — `BLOCKED ON CURRENT EVIDENCE`
- Provider recovery/reconciliation runtime — `BLOCKED ON CURRENT EVIDENCE`

**A5 + A10 + A11 authorize zero live retained-provider operations.**

---

# Phase 5 — Merchant/admin product surfaces

- A6 dashboard session authentication backend — `DONE`
- A7 merchant webhook endpoint management API — `DONE / HOSTED`
- A8 API credential management API — `DONE / HOSTED`
- A9 merchant transaction operations API — `DONE / HOSTED`
- A16 dashboard transaction cursor HMAC rotation — `DONE / GREEN`
- A21 merchant dashboard web foundation — `DONE / GREEN / HOSTED`
- A22 merchant dashboard integration settings UI — `DONE / GREEN / APPLICATION-ONLY`
- A23 merchant Payment Links management surface — `DONE / GREEN / SANDBOX-ONLY / HOSTED DEPLOY PENDING`

Current visual-product reality:

- `apps/dashboard` is a real merchant-facing React/Vite application;
- Supabase Auth login/logout/session refresh, merchant/environment context selection and transaction list/detail are implemented;
- API credential and webhook endpoint settings are functional through the trusted A7/A8 APIs;
- Payment Links management is implemented for the frozen Sandbox-only A23 boundary;
- browser authority remains confined to Supabase Auth and trusted SwiftPay API calls, with integration secrets kept ephemeral.

Remaining product surfaces:
- KYC/compliance operations UI — `PENDING`
- Payout/refund operational API/UI — `PENDING`
- Reporting/analytics merchant UI — `PENDING`

---

# Phase 6 — Hosted checkout / links / conversion

- A23 Hosted Pix checkout — `DONE / GREEN / SANDBOX-ONLY / HOSTED DEPLOY PENDING`
- A23 Payment Links — `DONE / GREEN / SANDBOX-ONLY / HOSTED DEPLOY PENDING`
- Conversion/analytics surfaces — `PENDING`

A23 is repository/CI complete but is not yet a hosted feature. The canonical hosted Supabase project must receive the two A23 migrations and exact 30/6 post-deploy attestation before hosted availability can be claimed.

---

# Phase 7 — Production hardening and launch

- A12 structured runtime logging & correlation — `DONE / GREEN / RUNTIME-ONLY`
- A13 operational metrics & health signals — `DONE / GREEN / RUNTIME-ONLY`
- A14 ingress abuse / rate-limit hardening — `DONE / GREEN / HOSTED`
- A15 machine access-token signing-key rotation — `DONE / GREEN / APPLICATION-ONLY`
- A16 dashboard transaction cursor HMAC rotation — `DONE / GREEN / APPLICATION-ONLY`
- A17 legacy webhook AES secret retirement — `DONE / GREEN / HOSTED`
- A18 abuse-subject HMAC key rotation — `DONE / GREEN / HOSTED`
- A19 Fastify LogController compatibility — `DONE / GREEN / APPLICATION-ONLY`
- A20 exact runtime capability manifest/attestation — `DONE / GREEN / HOSTED-ATTESTED`

## Security hardening — `IN_PROGRESS`

Completed foundations:

- ingress/rate limiting;
- machine access-token key rotation;
- dashboard cursor HMAC rotation;
- merchant webhook persisted-secret AES retirement;
- abuse-subject HMAC rotation;
- Fastify request-log compatibility debt;
- exact nominal runtime capability/least-privilege attestation.

Remaining:

- dependency/supply-chain final review;
- operational audit review;
- production network/WAF hardening;
- secret/key rotation runbooks and drills.

## Observability operations — `PENDING`

A12/A13 internal telemetry boundaries are done. Remaining:

- external metrics collection/export;
- dashboards;
- alerts/SLO policy;
- distributed tracing if justified by measured operational need.

## Performance / capacity — `PENDING`

- production-like load/capacity testing;
- measured A14 limit tuning;
- measured database index/performance work.

Supabase Performance Advisor findings must be addressed only in a dedicated measured/tested optimization slice; arbitrary index or rate-limit changes are forbidden.

## Deployment / cutover / rollback — `PENDING`

- production environment contract;
- migration/cutover plan;
- forward-fix/rollback policy;
- provider credential bootstrap;
- smoke tests;
- backup/restore and disaster-recovery verification;
- deploy/rollback/incident runbooks;
- production cutover readiness.

---

# Current handoff spine

```text
Foundation contracts / architecture                       DONE
  -> database + financial foundations                    DONE
  -> Supabase private/security boundaries K1-K4          DONE
  -> K5 deterministic sandbox fixtures                   DONE
  -> K6 trusted runtime topology                         DONE
  -> K7 executable API/worker runtime                    DONE
  -> A20 exact runtime capability attestation            DONE / GREEN / HOSTED-ATTESTED
  -> A1 API credential token authentication              DONE
  -> A2 authenticated Pix create/get + emulator          DONE
  -> A3 paid transition + ledger + balance               DONE
  -> A4 merchant webhook delivery runtime                DONE
  -> A5 provider conformance fixtures                    DONE / FIXTURE-ONLY
  -> A10 provider activation/outbound safety             DONE / NETWORK-FREE
  -> A11 strict provider HTTP transport                  DONE / GREEN / UNBOUND
  -> current retained-PSP contract evidence              EVIDENCE_REQUIRED
       -> authenticated current sandbox proof            BLOCKED ON EVIDENCE
       -> A5-to-A11 provider bridge                      BLOCKED ON EVIDENCE
       -> live provider activation                       BLOCKED
       -> provider webhook ingress                       BLOCKED
       -> provider recovery/reconciliation               BLOCKED

Parallel merchant/admin path:
  -> A6 dashboard session authentication backend         DONE
  -> A7 webhook endpoint management API                  DONE / HOSTED
  -> A8 API credential management API                    DONE / HOSTED
  -> A9 merchant transaction operations API              DONE / HOSTED
  -> A16 dashboard cursor HMAC rotation                  DONE / GREEN
  -> A21 merchant dashboard web foundation               DONE / GREEN / HOSTED
  -> A22 API credential + webhook settings UI            DONE / GREEN
  -> A23 hosted Pix checkout + Payment Links             DONE / GREEN / SANDBOX-ONLY
       -> canonical hosted A23 migration deployment      PENDING
       -> exact hosted 30/6 re-attestation               PENDING
  -> KYC/payout/refund/reporting UI                      PENDING

Parallel production-hardening path:
  -> A12 safe runtime logging/correlation                DONE / GREEN
  -> A13 bounded operational metrics/OpenMetrics         DONE / GREEN
  -> A14 ingress abuse/rate-limit hardening              DONE / GREEN / HOSTED
  -> A15 machine access-token signing-key rotation       DONE / GREEN
  -> A16 dashboard cursor HMAC rotation                  DONE / GREEN
  -> A17 legacy webhook AES secret retirement            DONE / GREEN / HOSTED
  -> A18 abuse-subject HMAC key rotation                 DONE / GREEN / HOSTED
  -> A19 Fastify LogController compatibility             DONE / GREEN
  -> A20 exact runtime capability attestation            DONE / GREEN / HOSTED-ATTESTED
  -> external exporters/alerts/SLOs/tracing              PENDING
  -> dependency review/rotation drills/WAF               PENDING
  -> performance/load/capacity                           PENDING
  -> deployment/backup/cutover/rollback                  PENDING
```

## Immediate next action

A23 is fully GREEN in repository/CI and deliberately Sandbox-only. The canonical hosted `swiftpay v2` project remains pre-A23 and retained-provider activation remains externally blocked by current-contract and authenticated-sandbox evidence.

1. consolidate the canonical `agent/foundation-phase-0` lineage into `main` through PR #1; do **not** merge historical `agent/foundation-phase-0-*` checkpoint branches individually;
2. after source consolidation, deploy the two A23 migrations to canonical hosted `swiftpay v2` as a separate controlled operation;
3. immediately after A23 hosted migration, attest exact **30 API / 6 worker** capabilities, zero direct protected-table runtime authority, Data API isolation, Security Advisor state and zero unintended financial rows;
4. run a bounded Sandbox-only Payment Link/checkout smoke and preserve rollback/forward-fix evidence before claiming hosted availability;
5. do not wire AkkadPag/AkadPay/FlevoPay adapters to A11 merely because transport exists; require exact provider-owned current technical evidence and authenticated current sandbox proof before `sandbox_proven`;
6. preserve the checked-in A10 registry at zero outbound retained-provider authority until an evidence-backed transition is deliberately reviewed;
7. treat remaining launch-hardening work only as bounded evidence-driven slices: dependency/supply-chain review, rotation drills, measured performance/load, deployment/backup/rollback contracts and production WAF/network policy;
8. do not call AkkadPag, AkadPay or FlevoPay monetarily until exact current-contract, sandbox and activation gates are closed.
