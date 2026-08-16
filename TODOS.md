# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-16

This is the durable backlog and handoff ledger for the reconstruction. Repository artifacts are the source of truth. Detailed proof lives in specs, migrations, tests and `docs/evidence/**`; Git history preserves checkpoint chronology.

Executive readiness checkpoint: `docs/product/v1-readiness-status.md`.

## States

- `PENDING`: known, not started
- `IN_PROGRESS`: actively being worked
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
- A1-A7: `DONE`
- A7 Problem Analysis: `docs/design/a7-merchant-webhook-endpoint-management-problem-analysis.md`
- A7 frozen spec: `docs/specs/merchant-webhook-endpoint-management-v0.yaml`
- A7 evidence: `docs/evidence/application/2026-08-16-a7-merchant-webhook-endpoint-management.md`
- A7 final behavior head: `155472ba299f1e75d33dd6cad430ad61b923a043`
- A7 hosted migration alignment commit: `34e3ee28359b0ea8a96ade40d84323e0094e931d`
- A7 post-alignment stale-path contract fix: `22e38df402175badfd83c4b01c739c55a73e28c1`
- Final behavior Application workflow: `31934008876` — GREEN, **209/209 application contracts** + K7/A1/A2/A3/A4/A6/A7 real-database acceptance
- Final behavior Database workflow: `31934008886` — GREEN, **38 files / 1282 pgTAP assertions** + deterministic sandbox fixtures + runtime topology
- Hosted Security Advisor after A7: **0 lints**
- Core architecture/domain/database/platform estimate: ~99%
- First end-to-end Pix sandbox MVP estimate: ~94%
- Production-capable Pix V1 estimate: ~57%
- Weighted V1 engineering estimate: ~71%
- Current external critical blocker: current PSP contract/lineage/idempotency/recovery/webhook-auth evidence for AkkadPag and FlevoPay
- Next unblocked internal candidate: **API credential management** through the A6/K4 dashboard realm while preserving the A1 machine-authentication contract
- Next candidate after credentials: merchant transaction list/detail/search/status operations

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

Accepted: `client_credentials`, opaque secret verifier, exact-IP policy, issuance quota, 900-second machine token and DB revalidation.

Credential create/list/rotate/revoke administration remains `PENDING` as a separate dashboard product surface.

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

- `swiftpay_api`: exact 16-routine EXECUTE allowlist;
- `swiftpay_worker`: exact 6-routine EXECUTE allowlist;
- zero direct runtime table privileges over endpoint/secret/idempotency/audit tables;
- worker cannot administer A7; API cannot execute worker claim/resolve;
- private `_a7_*` helpers unavailable to runtime roles;
- Security Advisor: zero lints.

No hosted seed/fixture/business acceptance data and no live PSP monetary call were used for A7 deployment.

## API credential management — `PENDING / NEXT UNBLOCKED CANDIDATE`

This is the next recommended internal slice.

Required design questions before RED:

- dashboard route realm and minimum K4 role for create/list/rotate/revoke;
- public-key naming/format and environment scoping;
- Secret Key generation entropy and one-time plaintext disclosure;
- verifier-only storage compatible with A1 `scrypt-v1` authentication;
- exact create/rotation idempotency and replay semantics without storing plaintext;
- immediate revocation and token revalidation behavior;
- secret-version increments and invalidation of already-issued A1 tokens when required;
- exact-IP allowlist management semantics;
- audit identity and sensitive-data redaction;
- optimistic concurrency for mutable credential policy;
- least-privilege operation-specific RPCs with no direct browser mutation.

Mandatory pipeline: Problem Analysis -> frozen YAML spec -> clean RED -> implementation GREEN -> evidence.

## Merchant transaction operations — `PENDING`

Dashboard list/detail/search/status over existing canonical A2/A3 Payment data, without financial mutation authority.

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
  -> A5 provider conformance fixtures                    DONE
  -> current retained-PSP contract evidence              EVIDENCE_REQUIRED
       -> live provider transport/recovery               BLOCKED
       -> provider webhook ingress                       BLOCKED

Parallel internal product path:
  -> A6 dashboard session authentication                 DONE
  -> A7 webhook endpoint management                      DONE
  -> API credential management                           PENDING / NEXT CANDIDATE
  -> merchant transaction operations                     PENDING
  -> broader admin/KYC/payout operations                 PENDING

Then:
  -> production hardening / observability / cutover      PENDING
```

## Immediate next action

Because live PSP work is correctly blocked on external/current contract evidence, the next internal slice should improve merchant usability without guessing provider behavior:

1. write full Problem Analysis for API credential lifecycle administration using A6/K4 as dashboard authority and preserving A1 as the machine-auth contract;
2. freeze Secret Key generation, verifier-only storage, one-time disclosure, rotation/revocation, token-version invalidation, IP policy, idempotency, optimistic concurrency and audit semantics;
3. freeze the dashboard credential-management YAML specification and operation-specific trusted DB boundaries;
4. write clean RED database/application contracts;
5. implement only after clean RED.

In parallel, provider evidence should be upgraded through provider-owned current technical documentation or authenticated non-monetary/current sandbox proof.

**Do not call AkkadPag, AkadPay or FlevoPay monetarily until the applicable current-contract evidence gate is closed.**
