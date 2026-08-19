# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-19

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

- Branch: `agent/foundation-phase-0`
- Draft PR: #1 — `foundation: establish SwiftPay V2 reconstruction baseline`
- `main`: intentionally untouched
- Canonical hosted Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
- K1-K7: `DONE`
- A1-A19: `DONE`
- A5 remains `DONE / FIXTURE-ONLY` for live-provider authority.
- A10 remains executable default-deny with zero retained-provider operations authorized by repository defaults.
- A11 remains strict outbound HTTPS and intentionally unbound from retained A5 adapters.
- Current retained-provider contract/sandbox gate remains `EVIDENCE_REQUIRED` / externally blocked.

Current engineering estimates:

- core architecture/domain/database/platform: **~99%**
- first end-to-end Pix sandbox MVP: **~97%**
- production-capable Pix V1: **~60%**
- weighted V1 engineering completion: **~75%**

Current external critical blocker:

- exact current PSP contract/lineage/auth/create/query/idempotency/recovery/webhook-auth evidence;
- authenticated current sandbox proof for the selected retained provider contract.

Do not bridge A5 retained adapters to A11 and do not promote A10 provider authority until those evidence gates close.

## Latest accepted slices

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
- Hosted API/worker `app` EXECUTE totals remain exactly **24 / 6**.
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

Runtime identities remain separate and capability-scoped. Current hosted post-A18 capability totals are exactly **24 API / 6 worker** `app` EXECUTEs.

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

- A6 dashboard session authentication — `DONE`
- A7 merchant webhook endpoint management — `DONE / HOSTED`
- A8 API credential management — `DONE / HOSTED`
- A9 merchant transaction operations — `DONE / HOSTED`
- A16 dashboard transaction cursor HMAC rotation — `DONE / GREEN`

Remaining product surfaces:

- Dashboard login/session UX and Supabase Auth product configuration — `PENDING`
- KYC/compliance operations UI — `PENDING`
- Payout/refund operational API/UI — `PENDING`

---

# Phase 6 — Hosted checkout / links / conversion

- Hosted Pix checkout — `PENDING`
- Payment links — `PENDING`
- Conversion/analytics surfaces — `PENDING`

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

## Security hardening — `IN_PROGRESS`

Completed foundations:

- ingress/rate limiting;
- machine access-token key rotation;
- dashboard cursor HMAC rotation;
- merchant webhook persisted-secret AES retirement;
- abuse-subject HMAC rotation;
- Fastify request-log compatibility debt.

Remaining:

- final dependency/security review;
- final least-privilege audit;
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
  -> A6 dashboard session authentication                 DONE
  -> A7 webhook endpoint management                      DONE / HOSTED
  -> A8 API credential management                        DONE / HOSTED
  -> A9 merchant transaction operations                  DONE / HOSTED
  -> A16 dashboard cursor HMAC rotation                  DONE / GREEN
  -> broader admin/KYC/payout operations                 PENDING

Parallel production-hardening path:
  -> A12 safe runtime logging/correlation                DONE / GREEN
  -> A13 bounded operational metrics/OpenMetrics         DONE / GREEN
  -> A14 ingress abuse/rate-limit hardening              DONE / GREEN / HOSTED
  -> A15 machine access-token signing-key rotation       DONE / GREEN
  -> A16 dashboard cursor HMAC rotation                  DONE / GREEN
  -> A17 legacy webhook AES secret retirement            DONE / GREEN / HOSTED
  -> A18 abuse-subject HMAC key rotation                 DONE / GREEN / HOSTED
  -> A19 Fastify LogController compatibility             DONE / GREEN
  -> external exporters/alerts/SLOs/tracing              PENDING
  -> security/least-privilege/rotation drills            PENDING
  -> performance/load/capacity                           PENDING
  -> deployment/backup/cutover/rollback                  PENDING
```

## Immediate next action

A19 is fully GREEN. The living functional checklist and readiness checkpoint are the durable feature/readiness surfaces and must remain aligned after every accepted slice.

1. do not wire AkkadPag/AkadPay/FlevoPay adapters to A11 merely because the transport primitive exists;
2. continue exact provider-owned current technical evidence acquisition and require authenticated current sandbox proof before `sandbox_proven`;
3. if provider evidence closes, freeze a dedicated A5→A11 bridge/activation Problem Analysis and continue strict TDD;
4. preserve the checked-in A10 registry at zero outbound authority until an evidence-backed transition is deliberately reviewed;
5. in parallel, proceed only with bounded launch-hardening work that does not obscure the PSP blocker: security/least-privilege review, secret/key rotation drills, measured performance/load, deployment/backup/rollback contracts, or explicitly prioritized merchant product surfaces;
6. do not call AkkadPag, AkadPay or FlevoPay monetarily until exact current-contract, sandbox and activation gates are closed.
