# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-17

This is the durable backlog and handoff ledger for the reconstruction. Repository artifacts are the source of truth. Detailed proof lives in specs, migrations, tests and `docs/evidence/**`; Git history preserves checkpoint chronology.

Executive readiness checkpoint: `docs/product/v1-readiness-status.md`.

## States

- `PENDING`: known, not started
- `PROBLEM_ANALYSIS`: problem boundary is actively being investigated/frozen; no spec or implementation authority yet
- `IN_PROGRESS`: actively being worked after the applicable planning boundary exists
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
- A1-A8: `DONE` (`A5` remains fixture-only for live-provider authority)
- A8 Problem Analysis: `docs/design/a8-api-credential-management-problem-analysis.md`
- A8 frozen spec: `docs/specs/api-credential-management-v0.yaml`
- A8 evidence: `docs/evidence/application/2026-08-17-a8-api-credential-management.md`
- A8 final clean GREEN head: `d74624198918aca53a3769334aeb6b8adbba8092`
- Final A8 Application workflow: `32001023852` — GREEN, **226/226 application contracts** + K7/A1/A2/A3/A4/A6/A7/A8 real-database acceptance
- Final A8 Database workflow: `32001023848` — GREEN, **39 files / 1288 pgTAP assertions** + deterministic sandbox fixtures + runtime topology
- Hosted A8 migrations: `20260817061316`, `20260817061346`, `20260817061415`
- Hosted post-A8 `swiftpay_api`: exact **21** `app` EXECUTE capabilities
- Hosted post-A8 `swiftpay_worker`: exact **6** `app` EXECUTE capabilities
- Hosted Security Advisor after A8: **0 lints**
- Core architecture/domain/database/platform estimate: ~99%
- First end-to-end Pix sandbox MVP estimate: ~96%
- Production-capable Pix V1 estimate: ~58%
- Weighted V1 engineering estimate: ~73%
- Current external critical blocker: current PSP contract/lineage/idempotency/recovery/webhook-auth evidence for AkkadPag and FlevoPay
- Next unblocked internal slice: **A9 merchant transaction operations** — `PROBLEM_ANALYSIS`

## Non-negotiable delivery method

Every new behavior follows this order:

1. Problem Analysis
2. YAML Specification
3. Contracts/interfaces
4. Tests first — RED
5. Minimal implementation — GREEN
6. Refactor without behavior drift
7. Evidence + handoff update

No live PSP integration may bypass deterministic emulator and provider-conformance gates. No merchant/browser surface receives direct financial authority. Ambiguous monetary execution remains explicit `execution_unknown`/recovery state; it is never converted into fabricated definitive failure.

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

Accepted: `client_credentials`, opaque secret verifier, exact-IP policy, issuance quota, 900-second machine token and DB revalidation. Dashboard credential create/list/get/rotate/revoke administration is now supplied by hosted A8 while A1 remains authoritative for machine authentication and token revalidation.

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
- only `proven_current` may independently unlock production;
- 23 sanitized deterministic provider fixture artifacts;
- integer-cent money and stable client/provider identifier separation;
- no synthetic customer identity/contact data;
- unsupported capabilities fail before transport;
- monetary transport executes at most once;
- timeout/reset/malformed 2xx/unproven 4xx/ambiguous 5xx -> `execution_unknown`;
- unknown statuses fail closed;
- FlevoPay Pix-out remains unsupported;
- refunds remain unsupported for both;
- provider webhook authority remains unavailable without exact current verification/replay evidence;
- provider package contains no live network transport.

## Current-provider contract evidence gate — `EVIDENCE_REQUIRED`

### AkkadPag

Legacy evidence proves `api.akkadpag.com/v1`, Basic Auth and `transactions`/`transfers`. Current public AkadPay material uses materially different host/routes/credential placement. No accepted evidence proves contractual equivalence or migration lineage.

Required before live activation:

- provider-owned current hostname/environment contract;
- explicit AkkadPag/AkadPay lineage/equivalence if applicable;
- current create/query correlation and idempotency/recovery semantics;
- current Pix-out replay/recovery semantics;
- exact webhook authentication/replay identity;
- current status vocabulary/rate limits.

### FlevoPay

Legacy evidence proves historical `app.flevopay.com.br/api/v1`, `X-API-Key`, Pix create/query and no Pix-out adapter. Current public material remains insufficient to freeze current technical semantics.

Required before live activation:

- current provider-owned create/query technical contract or authenticated sandbox proof;
- authoritative recovery identifier/order;
- current webhook authentication/replay identity;
- current status vocabulary/rate limits;
- exact Pix-out contract before capability reconsideration.

## AkkadPag live transport/adapter activation — `BLOCKED ON CURRENT EVIDENCE`

## FlevoPay live transport/adapter activation — `BLOCKED ON CURRENT EVIDENCE`

## Provider webhook ingress — `BLOCKED ON CURRENT EVIDENCE`

## Provider recovery/reconciliation runtime — `BLOCKED ON CURRENT EVIDENCE`

**A5 being GREEN does not authorize real monetary transport.**

---

# Phase 5 — Merchant/admin product surfaces

## A6 — dashboard session authentication — `DONE`

Pre-analysis prerequisite: `docs/design/webhook-endpoint-management-preanalysis.md`.
Problem Analysis: `docs/design/a6-dashboard-session-authentication-problem-analysis.md`.
Spec: `docs/specs/dashboard-session-authentication-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-16-a6-dashboard-session-authentication.md`.

Accepted: strict dashboard Bearer verification through Supabase Auth, verified user UUID only, current K4 merchant/environment/role authority, no JWT metadata authority, no service-role/JWT-secret authority, no fallback to A1 machine auth and no financial/async side effects.

## A7 — merchant webhook endpoint management — `DONE / HOSTED`

Problem Analysis: `docs/design/a7-merchant-webhook-endpoint-management-problem-analysis.md`.
Spec: `docs/specs/merchant-webhook-endpoint-management-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-16-a7-merchant-webhook-endpoint-management.md`.

Accepted boundary:

- dashboard-only routes;
- member read / admin mutation authority;
- create/list/get/update/disable/enable/rotate-secret;
- no DELETE in V0;
- URL mutation only while disabled;
- exactly `payment.paid` subscription in V0;
- positive optimistic `revision` fencing;
- durable request idempotency with completed replay evaluated before stale-revision rejection;
- append-only audit exactly once per winning successful mutation;
- one-time `whsec_...` plaintext on winning create/rotation only;
- plaintext never stored in DB/idempotency/audit/jobs/logs and never re-disclosed on replay;
- RSA-OAEP-SHA256 wrapping: API public-key encrypt authority only, worker private-keyring decrypt authority only;
- A4 AES legacy delivery compatibility;
- durable multi-version secret history with bounded overlap;
- immutable delivery URL and signing-secret-version snapshots;
- `X-SwiftPay-Signature-Version` from immutable delivery state;
- disabling terminalizes pending not-yet-leased work without HTTP;
- financial table counts invariant across the real A7 lifecycle acceptance.

Hosted migrations:

- `20260816073330_webhook_endpoint_management_foundation.sql`
- `20260816073500_webhook_endpoint_management_behavior.sql`
- `20260816073604_webhook_endpoint_management_behavior_fix.sql`

Hosted post-deploy audit:

- `swiftpay_api`: exact 16-routine EXECUTE allowlist at A7 checkpoint;
- `swiftpay_worker`: exact 6-routine EXECUTE allowlist;
- zero direct runtime table privileges over endpoint/secret/idempotency/audit tables;
- worker cannot administer A7; API cannot execute worker claim/resolve;
- private `_a7_*` helpers unavailable to runtime roles;
- Security Advisor: zero lints.

No hosted seed/fixture/business acceptance data and no live PSP monetary call were used for A7 deployment.

## A8 — API credential management — `DONE / HOSTED`

Problem Analysis: `docs/design/a8-api-credential-management-problem-analysis.md`.
Spec: `docs/specs/api-credential-management-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-17-a8-api-credential-management.md`.

Accepted boundary:

- dashboard list/get/create/rotate-secret/revoke routes only;
- reads use ordinary A6 online session verification and current member authority;
- mutations require online-validated `aal2` before secret generation or DB mutation;
- Sandbox mutation authority is current admin/owner; Production is current owner only;
- CSPRNG public/secret credential material generated in trusted API memory;
- plaintext Secret Key disclosed only once on winning create/rotation;
- only A1-compatible `scrypt-v1` verifier persists;
- completed replay never re-discloses candidate secret;
- exact-IP allowlist semantics retained and CIDR/wildcard rejected;
- positive `revision` optimistic concurrency;
- rotation increments `secret_version`; revocation is terminal;
- A1 bearer revalidation immediately rejects old secret-version/revoked credentials;
- transactional maximum 10 active credentials per merchant/environment;
- durable idempotency and audit exactly once for winning mutations;
- no direct protected-table runtime authority and no financial side effects.

Hosted migrations:

- `20260817061316_api_credential_management_foundation.sql`
- `20260817061346_api_credential_management_create.sql`
- `20260817061415_api_credential_management_behavior.sql`

Final clean GREEN:

- head `d74624198918aca53a3769334aeb6b8adbba8092`;
- Application workflow `32001023852`: **226/226 PASS** + K7/A1/A2/A3/A4/A6/A7/A8 real-database acceptance;
- Database workflow `32001023848`: **39 files / 1288 pgTAP assertions PASS** + K5 fixtures + K6 topology.

Hosted post-deploy audit:

- `swiftpay_api`: exact **21** `app` EXECUTE capabilities;
- `swiftpay_worker`: exact **6** `app` EXECUTE capabilities;
- all five A8 trusted RPCs present;
- private `_a8_*` helpers unavailable to both runtimes;
- no direct API/worker access over credential/token-window/idempotency/audit protected tables;
- zero plaintext-like secret leakage in persisted credential/idempotency/audit surfaces;
- Security Advisor: **0 lints**.

Performance Advisor remains INFO-only with existing unindexed-FK/unused-index candidates. No speculative performance DDL was added as part of A8.

## A9 — merchant transaction operations — `PROBLEM_ANALYSIS`

Goal: add dashboard read-only list/detail/search/filter/status visibility over canonical A2/A3 Payment state without introducing financial mutation authority, provider-specific leakage or direct browser/Data API access.

Problem Analysis will freeze at minimum:

- dashboard route realm and A6/K4 authorization;
- member read authority versus any stricter role requirement;
- exact merchant/environment scoping and foreign-resource indistinguishability;
- canonical transaction projection derived from Payment, not provider payloads;
- stable cursor pagination and deterministic ordering;
- allowed filters/search fields and bounds;
- mapping of internal collection/provider states to merchant-visible status without fabricating certainty;
- treatment of `creating`/`execution_unknown` and provider recovery state;
- customer/metadata privacy and field redaction;
- amount/fee/net/refund visibility;
- list/detail consistency under concurrent state transitions;
- trusted read-only RPC boundary and least-privilege capability impact;
- zero mutation/audit/job/webhook/provider/ledger side effects from reads.

No YAML spec, test, migration or implementation is authorized until the A9 Problem Analysis is frozen.

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
  -> current retained-PSP contract evidence              EVIDENCE_REQUIRED
       -> live provider transport/recovery               BLOCKED
       -> provider webhook ingress                       BLOCKED

Parallel internal product path:
  -> A6 dashboard session authentication                 DONE
  -> A7 webhook endpoint management                      DONE / HOSTED
  -> A8 API credential management                       DONE / HOSTED
  -> A9 merchant transaction operations                 PROBLEM_ANALYSIS
  -> broader admin/KYC/payout operations                 PENDING

Then:
  -> production hardening / observability / cutover      PENDING
```

## Immediate next action

Because live PSP work is correctly blocked on external/current contract evidence, the next internal slice improves merchant visibility without guessing provider behavior:

1. freeze the A9 Problem Analysis for dashboard transaction list/detail/search/filter/status over canonical Payment state;
2. explicitly freeze pagination, ordering, status semantics, privacy/redaction and `execution_unknown` visibility;
3. only then create the A9 YAML specification;
4. only after the spec, freeze TypeScript/store/HTTP contracts;
5. only after contracts, write clean RED database/application tests;
6. implement minimally only after clean RED.

In parallel, provider evidence should be upgraded through provider-owned current technical documentation or authenticated non-monetary/current sandbox proof.

**Do not call AkkadPag, AkadPay or FlevoPay monetarily until the applicable current-contract evidence gate is closed.**
