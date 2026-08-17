# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-17

This is the durable backlog and handoff ledger for the reconstruction. Repository artifacts are the source of truth. Detailed proof lives in specs, migrations, tests and `docs/evidence/**`; Git history preserves checkpoint chronology.

Executive readiness checkpoint: `docs/product/v1-readiness-status.md`.

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
- A1-A10: `DONE` (`A5` remains fixture-only for live-provider authority; A10 makes that authority default-deny and executable)
- A10 Problem Analysis: `docs/design/a10-provider-activation-outbound-safety-problem-analysis.md`
- A10 frozen spec: `docs/specs/provider-activation-outbound-safety-v0.yaml`
- A10 contract: `docs/contracts/provider-activation-outbound-safety-v0.md`
- A10 current-provider evidence refresh: `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`
- A10 RED evidence: `docs/evidence/application/2026-08-17-a10-provider-activation-outbound-safety-red.md`
- A10 final evidence: `docs/evidence/application/2026-08-17-a10-provider-activation-outbound-safety.md`
- A10 GREEN head: `0308844c4aedb1d359068becfd29d1f4a234b064`
- Final A10 Application workflow: `32011311478` — GREEN, **250/250 application contracts** + K7/A1/A2/A3/A4/A6/A7/A8/A9 real-database acceptance
- Final A10 Database workflow: `32011311485` — GREEN, **40 files / 1292 pgTAP assertions** + deterministic sandbox fixtures + runtime topology
- A10 hosted migrations: **none**
- A10 live/network provider calls: **none**
- A10 default authorized provider runtime operations: **0**
- Hosted post-A9 `swiftpay_api`: exact **23** `app` EXECUTE capabilities
- Hosted post-A9 `swiftpay_worker`: exact **6** `app` EXECUTE capabilities
- Hosted Security Advisor after A9: **0 lints**
- Core architecture/domain/database/platform estimate: ~99%
- First end-to-end Pix sandbox MVP estimate: ~97%
- Production-capable Pix V1 estimate: ~60%
- Weighted V1 engineering estimate: ~75%
- Current external critical blocker: exact current PSP contract/lineage/idempotency/recovery/webhook-auth evidence for the retained provider contracts
- Next internal action: begin a new Problem Analysis for a strict live HTTP transport foundation that can consume only an A10 authorization grant; provider evidence acquisition continues in parallel; no live monetary provider call is authorized

## Non-negotiable delivery method

Every new behavior follows this order:

1. Problem Analysis
2. YAML Specification
3. Contracts/interfaces
4. Tests first — RED
5. Minimal implementation — GREEN
6. Refactor without behavior drift
7. Evidence + handoff update

No live PSP integration may bypass deterministic emulator, provider-conformance and A10 activation gates. No merchant/browser surface receives direct financial authority. Ambiguous monetary execution remains explicit `execution_unknown`/recovery state; it is never converted into fabricated definitive failure.

---

# Phase 0 — Reconstruction truth and target architecture

## Product/reverse-engineering baseline — `DONE`

Canonical artifacts establish a Pix-first TypeScript modular monolith with Fastify trusted API, separate worker, Supabase/PostgreSQL canonical state, provider-agnostic Payment Core, append-oriented financial/audit semantics, durable jobs and merchant webhooks. AkkadPag and FlevoPay remain the initial retained provider targets behind current-contract evidence gates.

The repository contains PRD, architecture, ADRs, domain/public/provider/ledger/webhook contracts, specs, tests and evidence sufficient for an implementation agent to work without chat context.

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

Payout/refund merchant-usable application/API/UI execution remains `PENDING`. Live-provider reconciliation remains blocked by current PSP evidence/live behavior.

---

# Phase 2 — Supabase security and trusted runtime foundation

## K1 — private schema / Data API boundary — `DONE`

## K2 — append-only audit events — `DONE`

Evidence: `docs/evidence/supabase/2026-08-15-k2-audit-events.md`.

## K3 — dashboard membership authorization — `DONE`

Evidence: `docs/evidence/supabase/2026-08-15-k3-dashboard-membership-authorization.md`.

## K4 — trusted runtime database boundary — `DONE`

Evidence: `docs/evidence/supabase/2026-08-15-k4-trusted-runtime-database-boundary.md`.

## K5 — deterministic local sandbox fixtures — `DONE`

Canonical seed remains deterministic and non-financial. Acceptance fixtures remain separate and TEST-ONLY.

Evidence: `docs/evidence/supabase/2026-08-15-k5-local-sandbox-seed-fixtures.md`.

## K6 — trusted runtime deployment topology — `DONE`

API and worker identities are separate and capability-scoped; cross-membership and broad table authority are rejected.

Evidence: `docs/evidence/supabase/2026-08-15-k6-trusted-runtime-deployment-topology.md`.

## K7 — executable runtime bootstrap — `DONE`

Node.js 24 TypeScript workspace, pinned pnpm, Fastify API, separate worker, liveness/readiness and real role-boundary acceptance are operational.

Evidence: `docs/evidence/application/2026-08-15-k7-executable-runtime-bootstrap.md`.

---

# Phase 3 — Public API authentication and deterministic Pix lifecycle

## A1 — API credential token exchange and Bearer authentication — `DONE`

Spec: `docs/specs/api-credential-token-exchange-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

Accepted: `client_credentials`, opaque secret verifier, exact-IP policy, issuance quota, 900-second machine token and DB revalidation. Dashboard credential create/list/get/rotate/revoke administration is supplied by hosted A8 while A1 remains authoritative for machine authentication and token revalidation.

## A2 — authenticated Pix create/get emulator — `DONE`

Specs:

- `docs/specs/pix-create-get-emulator-v0.yaml`
- `docs/specs/pix-create-get-emulator-fixture-v0.yaml`

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

Accepted: authenticated create/get, strict validation/hashing, required idempotency, durable Payment + ProviderAttempt before execution, atomic attempt claim, deterministic visibly non-payable emulator, safe replay/conflict and production fail-closed behavior.

## A3 — paid transition + ledger + balance — `DONE`

Spec: `docs/specs/paid-transition-ledger-balance-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-15-a3-paid-transition-ledger-balance.md`.

Accepted: worker-only sandbox paid evidence, replay/concurrency absorption, exactly one `settlement_paid` double-entry posting, authenticated balance read and transactional `payment.paid` outbox creation.

## A4 — merchant webhook delivery runtime — `DONE / HOSTED`

Problem Analysis: `docs/design/a4-merchant-webhook-delivery-problem-analysis.md`.
Spec: `docs/specs/merchant-webhook-delivery-runtime-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-16-a4-merchant-webhook-delivery-runtime.md`.

Hosted migrations:

- `20260816034121_merchant_webhook_delivery_runtime_foundation.sql`
- `20260816034224_merchant_webhook_delivery_runtime_behavior.sql`

Accepted: composed Job/WebhookDelivery fencing, worker-only capability, signed HTTP delivery, SSRF-safe destination policy, deterministic retry/terminal semantics, A4 AES secret isolation and zero financial authority.

---

# Phase 4 — PSP conformance and live Pix providers

## A5 — provider conformance fixtures — `DONE / FIXTURE-ONLY`

Problem Analysis: `docs/design/a5-provider-conformance-problem-analysis.md`.
Spec: `docs/specs/provider-conformance-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-16-a5-provider-conformance-fixtures.md`.

Accepted boundary:

- exactly AkkadPag and FlevoPay retained;
- evidence classified `proven_current | proven_legacy | inferred_non_authoritative | unknown`;
- only authoritative current evidence may advance the applicable live-provider gate;
- 23 sanitized deterministic provider fixture artifacts;
- integer-cent money and stable client/provider identifier separation;
- no synthetic customer identity/contact data;
- unsupported capabilities fail before transport;
- monetary transport executes at most once;
- timeout/reset/malformed 2xx/unproven 4xx/ambiguous 5xx -> `execution_unknown`;
- unknown statuses fail closed;
- FlevoPay Pix-out remains unsupported in the retained adapter;
- refunds remain unsupported for both;
- provider webhook authority remains unavailable without exact current verification/replay evidence;
- provider package originally contained no live network transport.

## A10 — provider activation & outbound safety — `DONE / GREEN / NETWORK-FREE`

Problem Analysis: `docs/design/a10-provider-activation-outbound-safety-problem-analysis.md`.
Spec: `docs/specs/provider-activation-outbound-safety-v0.yaml`.
Contract: `docs/contracts/provider-activation-outbound-safety-v0.md`.
Provider evidence refresh: `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`.
RED evidence: `docs/evidence/application/2026-08-17-a10-provider-activation-outbound-safety-red.md`.
Final evidence: `docs/evidence/application/2026-08-17-a10-provider-activation-outbound-safety.md`.

Accepted boundary:

- exact activation subject is provider + operation + environment + contract lineage;
- activation states reuse the A5 vocabulary: `unsupported | fixture_only | current_contract_proven | sandbox_proven | production_enabled`;
- registry is repository-versioned and malformed configuration fails closed;
- evidence-bearing activation states require an exact HTTPS provider origin, lowercase SHA-256 evidence bundle digest and canonical reviewed timestamp;
- exact lineage matching prevents AkadPay-branded material from silently authorizing the retained AkkadPag legacy contract;
- adapter capability, provider credentials, configured URL or a generic environment switch never imply activation;
- `current_contract_proven` alone does not authorize provider runtime traffic;
- Sandbox requires an exact Sandbox record at `sandbox_proven` or `production_enabled`;
- Production requires an exact Production record at `production_enabled`;
- query/recovery/webhook verification authority is operation-specific and not implied by create authority;
- successful authorization returns an immutable in-memory grant with approved origin/evidence context and no credentials/customer/Payment data;
- default registry version `2026-08-17.0` authorizes zero runtime provider operations;
- no Fetch/Undici/HTTP/DNS/socket implementation, provider call, route, database migration or monetary side effect was introduced.

Final GREEN proof:

- head `0308844c4aedb1d359068becfd29d1f4a234b064`;
- Application workflow `32011311478`: typecheck/build GREEN, **250/250 application contracts PASS**, including **10/10 A10** plus K7/A1-A9 real-database regression acceptance;
- Database workflow `32011311485`: **40 files / 1292 pgTAP assertions PASS**, K5 deterministic fixtures GREEN and K6 runtime topology GREEN;
- hosted Supabase changes: none;
- live PSP calls: none.

A10 closes an internal safety gap; it does **not** close provider contract authority. Readiness therefore remains conservatively unchanged at 99/97/60/75.

## Current-provider contract evidence gate — `EVIDENCE_REQUIRED`

Canonical refresh: `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`.

### AkkadPag / AkadPay

Legacy retained evidence proves `api.akkadpag.com/v1`, Basic Auth and `transactions`/`transfers`.

Current public AkadPay technical material now documents a materially different API under `painel.akadpay.com.br/api/...` and useful Pix-out idempotency/replay behavior. No accepted provider-owned artifact proves that AkadPay is the migration/current contractual lineage of the retained AkkadPag API, that credentials/contracts are interchangeable, or that the AkadPay public contract may authorize `akkadpag-legacy-api-v1`. Exact trusted webhook verification also remains unavailable.

Required before retained live activation:

- provider-owned lineage/equivalence or a deliberate provider replacement decision;
- exact current create/query correlation and idempotency/recovery semantics for the selected lineage;
- exact webhook authentication/replay identity;
- current status vocabulary/rate limits;
- authenticated sandbox proof before `sandbox_proven`.

### FlevoPay

Legacy retained evidence proves historical `app.flevopay.com.br/api/v1`, `X-API-Key`, Pix create/query and no Pix-out adapter.

Current provider-owned public material exposes `api.flevopay.com/v1` and advertises Pix/API-key capabilities, but still does not expose the exact executable create/query/recovery/webhook contract needed to activate the retained integration or prove compatibility with the historical host.

Required before retained live activation:

- current provider-owned create/query technical contract or authenticated current sandbox proof;
- authoritative recovery identifier/order and idempotency semantics;
- exact webhook authentication/replay identity;
- current status vocabulary/rate limits;
- exact Pix-out contract before capability reconsideration.

## AkkadPag live transport/adapter activation — `BLOCKED ON CURRENT EVIDENCE`

## FlevoPay live transport/adapter activation — `BLOCKED ON CURRENT EVIDENCE`

## Provider webhook ingress — `BLOCKED ON CURRENT EVIDENCE`

## Provider recovery/reconciliation runtime — `BLOCKED ON CURRENT EVIDENCE`

**A5 + A10 authorize zero real monetary provider operations.**

---

# Phase 5 — Merchant/admin product surfaces

## A6 — dashboard session authentication — `DONE`

Problem Analysis: `docs/design/a6-dashboard-session-authentication-problem-analysis.md`.
Spec: `docs/specs/dashboard-session-authentication-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-16-a6-dashboard-session-authentication.md`.

Accepted: strict dashboard Bearer verification through Supabase Auth, verified user UUID only, current K4 merchant/environment/role authority, no JWT metadata authority, no service-role/JWT-secret authority, no fallback to A1 machine auth and no financial/async side effects.

## A7 — merchant webhook endpoint management — `DONE / HOSTED`

Problem Analysis: `docs/design/a7-merchant-webhook-endpoint-management-problem-analysis.md`.
Spec: `docs/specs/merchant-webhook-endpoint-management-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-16-a7-merchant-webhook-endpoint-management.md`.

Accepted boundary includes dashboard-only member/admin authority, create/list/get/update/disable/enable/rotate-secret, optimistic revision fencing, idempotency/audit, one-time secret disclosure, RSA-OAEP-SHA256 wrapping, immutable delivery snapshots and zero financial authority.

Hosted migrations:

- `20260816073330_webhook_endpoint_management_foundation.sql`
- `20260816073500_webhook_endpoint_management_behavior.sql`
- `20260816073604_webhook_endpoint_management_behavior_fix.sql`

## A8 — API credential management — `DONE / HOSTED`

Problem Analysis: `docs/design/a8-api-credential-management-problem-analysis.md`.
Spec: `docs/specs/api-credential-management-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-17-a8-api-credential-management.md`.

Accepted boundary includes dashboard read/create/rotate/revoke, AAL2 mutation gate, role-sensitive Sandbox/Production authority, CSPRNG credential material, one-time secret disclosure, A1-compatible scrypt verifier, exact-IP policy, optimistic revision, immediate token invalidation, active-credential cap, idempotency/audit and zero direct protected-table authority.

Hosted migrations:

- `20260817061316_api_credential_management_foundation.sql`
- `20260817061346_api_credential_management_create.sql`
- `20260817061415_api_credential_management_behavior.sql`

## A9 — merchant transaction operations — `DONE / HOSTED`

Problem Analysis: `docs/design/a9-merchant-transaction-operations-problem-analysis.md`.
Spec: `docs/specs/merchant-transaction-operations-v0.yaml`.
Contracts: `docs/contracts/merchant-transaction-operations-v0.md`, `docs/contracts/merchant-transaction-operations-database-v0.md`.
Evidence: `docs/evidence/application/2026-08-17-a9-merchant-transaction-operations.md`.

Accepted boundary includes dashboard-only read list/detail, current member authority, canonical Payment statuses, exact filters, HMAC-authenticated keyset cursor, merchant-safe list/detail projections, two trusted read RPCs and zero financial/provider/idempotency/audit/job/webhook/credential side effects.

Final GREEN proof:

- behavioral head `f846a50f2c8afe8f5561a59aebef8574e22ac6d6`;
- Application workflow `32009421604`: **240/240 application contracts PASS** + K7/A1-A9 real-database acceptance;
- Database workflow `32009421592`: **40 files / 1292 pgTAP assertions PASS** + K5/K6.

Hosted migration:

- `20260817081745_merchant_transaction_operations.sql`

Hosted post-deploy audit keeps `swiftpay_api` at 23 execute capabilities, worker at 6, zero audited direct protected-table runtime privileges, zero hosted Payment/ProviderAttempt business rows and Security Advisor at zero lints.

Other merchant/admin work:

- Dashboard login/session UX and Supabase Auth product configuration — `PENDING` (trusted server-side A6 boundary is DONE)
- KYC/compliance operations UI — `PENDING`
- Payout/refund operational API/UI — `PENDING`

---

# Phase 6 — Hosted checkout / links / conversion

- Hosted Pix checkout — `PENDING`
- Payment links — `PENDING`
- Conversion/analytics surfaces — `PENDING`

---

# Phase 7 — Production hardening and launch

## Observability — `PENDING`

Structured redacted logs, auth/Pix/provider/job/webhook/reconciliation metrics, correlation tracing, alerts, dashboards and SLOs.

## Security hardening — `PENDING`

Final secret inventory/rotation, signing-key rotation architecture, dependency/security review, least-privilege audit, abuse/rate-limit review and operational audit review.

## Performance debt — `PENDING`

Supabase Performance Advisor currently reports INFO-level unindexed foreign keys and unused indexes. Address only in a dedicated measured/tested optimization slice.

## Deployment / cutover / rollback — `PENDING`

Production environment contract, migration/cutover plan, forward-fix/rollback policy, provider credential bootstrap, smoke tests, backup/recovery verification and launch runbook.

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
  -> current retained-PSP contract evidence              EVIDENCE_REQUIRED
       -> strict live HTTP transport                     NEXT PROBLEM ANALYSIS
       -> authenticated sandbox proof                    BLOCKED ON EVIDENCE/TRANSPORT
       -> live provider activation                       BLOCKED
       -> provider webhook ingress                       BLOCKED
       -> provider recovery/reconciliation               BLOCKED

Parallel internal product path:
  -> A6 dashboard session authentication                 DONE
  -> A7 webhook endpoint management                      DONE / HOSTED
  -> A8 API credential management                        DONE / HOSTED
  -> A9 merchant transaction operations                  DONE / HOSTED
  -> broader admin/KYC/payout operations                 PENDING

Then:
  -> production hardening / observability / cutover      PENDING
```

## Immediate next action

A10 is fully GREEN and deliberately network-free. The next internal production-oriented behavior must begin at `PROBLEM_ANALYSIS`; no live transport implementation authority exists yet.

1. define a strict HTTP transport foundation whose only provider-origin authority comes from an immutable A10 grant;
2. preserve no-transparent-retry semantics for monetary POSTs and explicit `execution_unknown` behavior after ambiguous transmission;
3. keep current default registry at zero outbound authority, so the transport remains unusable for real retained-provider traffic until evidence is deliberately upgraded;
4. continue provider-owned current technical evidence acquisition in parallel;
5. require authenticated current sandbox proof before any applicable transition to `sandbox_proven`;
6. do not call AkkadPag, AkadPay or FlevoPay monetarily until the exact current-contract, sandbox and activation gates are closed.
