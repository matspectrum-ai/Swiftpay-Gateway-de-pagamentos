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
- A4 hosted migration alignment commit: `ac41a57e64fca69871e0d26bafe05d888b8e3cbd`
- A5 Problem Analysis: `docs/design/a5-provider-conformance-problem-analysis.md`
- A5 frozen spec: `docs/specs/provider-conformance-v0.yaml`
- A5 clean RED head: `10a7051afee1cdd07105c6f08bfac6a5f143ea35`
- A5 GREEN implementation head: `3583f57e5090ce89284b7929980d738396aafd58`
- A5 evidence: `docs/evidence/application/2026-08-16-a5-provider-conformance-fixtures.md`
- A6 pre-analysis prerequisite: `docs/design/webhook-endpoint-management-preanalysis.md`
- A6 Problem Analysis: `docs/design/a6-dashboard-session-authentication-problem-analysis.md`
- A6 frozen spec: `docs/specs/dashboard-session-authentication-v0.yaml`
- A6 clean RED head: `948f5369802dfe682e8c8c0aaeeb8cfa908f3ece`
- A6 final GREEN head: `4ac4e0b53776e55361f90d5589e5f72bcbdce49c`
- A6 evidence: `docs/evidence/application/2026-08-16-a6-dashboard-session-authentication.md`
- A6 GREEN Application workflow: `31928641553` — GREEN, 186/186 contracts + K7/A1/A2/A3/A4/A6 real runtime
- A6 GREEN Database workflow: `31928641539` — GREEN, pgTAP + K5 + K6
- Canonical database lane: 37 files / 1272 pgTAP assertions / PASS
- Core architecture/domain/database/platform foundation estimate: ~99%
- Weighted V1 engineering estimate: ~68%
- First end-to-end Pix sandbox MVP estimate: ~90%
- Production-capable Pix V1 estimate: ~55%
- Current external critical blocker: current PSP contract/lineage evidence for AkkadPag and FlevoPay
- Next unblocked internal candidate: merchant webhook endpoint management API, with signing-secret key custody still requiring a frozen design

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

Payout/refund merchant-usable application/API/UI execution remains pending. Live-provider reconciliation remains gated by current PSP evidence/live behavior.

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

Credential create/rotate/revoke management UI/API and signing-key-ring rotation remain `PENDING`.

## A2 — `pix-create-get-emulator-v0` — `DONE`

Specs:

- `docs/specs/pix-create-get-emulator-v0.yaml`
- `docs/specs/pix-create-get-emulator-fixture-v0.yaml`

Accepted: authenticated create/get, Bearer revalidation first, sandbox-only create, strict validation/hashing, required merchant/environment idempotency, durable Payment + ProviderAttempt before execution, atomic attempt claim, deterministic visibly non-payable emulator, pending/unknown/rejection semantics, safe replay/conflict and production fail-closed behavior.

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

## A3 — `paid-transition-ledger-balance-v0` — `DONE`

Spec: `docs/specs/paid-transition-ledger-balance-v0.yaml`.

Accepted: worker-only sandbox paid evidence, serialized Payment transition, immutable ProviderEvent evidence identity, replay/concurrency absorption, exactly one `settlement_paid` double-entry posting, pending-liability merchant credit, authenticated `GET /v1/balance`, merchant-safe paid projection and transactional `payment.paid` outbox creation.

Evidence: `docs/evidence/application/2026-08-15-a3-paid-transition-ledger-balance.md`.

## A4 — merchant webhook delivery runtime — `DONE`

Problem Analysis: `docs/design/a4-merchant-webhook-delivery-problem-analysis.md`.
Spec: `docs/specs/merchant-webhook-delivery-runtime-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-16-a4-merchant-webhook-delivery-runtime.md`.

Accepted boundary includes composed Job/WebhookDelivery fencing, exact worker-only capability, AES-256-GCM secret isolation, deterministic HMAC signing, SSRF-safe HTTPS destination policy, deterministic retry/attempt ceiling, concurrency/stale-fence acceptance and zero financial authority.

Canonical hosted migrations:

- `20260816034121_merchant_webhook_delivery_runtime_foundation.sql`
- `20260816034224_merchant_webhook_delivery_runtime_behavior.sql`

Hosted Security Advisor: zero lints.

---

# Phase 4 — PSP conformance and live Pix providers

## A5 — provider conformance fixtures — `DONE`

Problem Analysis: `docs/design/a5-provider-conformance-problem-analysis.md`.
Spec: `docs/specs/provider-conformance-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-16-a5-provider-conformance-fixtures.md`.

A5 is intentionally **fixture-only** and network-free. It does not enable live provider execution.

Accepted boundary:

- exactly AkkadPag and FlevoPay retained;
- provider fact classification: `proven_current | proven_legacy | inferred_non_authoritative | unknown`;
- only `proven_current` may independently unlock production;
- 23 sanitized deterministic provider fixture artifacts;
- explicit fixture-only capability matrix;
- historical Basic Auth / `X-API-Key` request mapping behind injected transport;
- integer-cent canonical money;
- stable client-reference/provider-ID separation;
- no synthetic customer identity/contact data;
- unsupported capabilities fail before transport;
- monetary transport executes at most once;
- timeout/reset/malformed 2xx/unproven 4xx/ambiguous 5xx -> `execution_unknown`;
- known status normalization and unknown status fail-closed;
- FlevoPay Pix-out remains unsupported;
- refund remains unsupported for both;
- provider webhook authority remains unavailable until exact current verification/replay evidence exists;
- no live Node HTTP/HTTPS/net/TLS/DNS transport or native fetch in provider package.

### A5 gate sequence

- [x] inventory canonical provider/reverse-engineering evidence
- [x] separate proven facts from assumptions/unknowns
- [x] Problem Analysis
- [x] freeze provider-conformance YAML spec
- [x] freeze capability/auth/idempotency/recovery matrices
- [x] add sanitized deterministic fixtures
- [x] executable RED scaffold without module/parser/harness failure
- [x] RED common adapter conformance suite
- [x] RED AkkadPag fixture suite
- [x] RED FlevoPay fixture suite
- [x] minimal adapters/translators GREEN against fixtures only
- [x] `execution_unknown` / no-transparent-retry tests
- [x] provider webhook fail-closed authority guard
- [x] fixture provenance/network/security guards
- [x] evidence report

Clean RED:

- head `10a7051afee1cdd07105c6f08bfac6a5f143ea35`;
- Application workflow `31926931467`: typecheck/build PASS, 132 PASS + exactly 15 expected A5 behavior failures;
- no missing module/parser/harness error;
- K7/A1/A2/A3/A4 real-runtime path preserved;
- database lanes preserved.

GREEN:

- head `3583f57e5090ce89284b7929980d738396aafd58`;
- Application workflow `31927064932`: GREEN, 147/147 + K7/A1/A2/A3/A4 real runtime;
- Database workflow `31927064836`: GREEN, pgTAP + K5 + K6.

## Current-provider contract evidence gate — `EVIDENCE_REQUIRED`

This is now the primary external blocker for live PSP work.

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

Legacy evidence proves historical `app.flevopay.com.br/api/v1`, `X-API-Key`, Pix create/query and no Pix-out adapter. Current public material is insufficient to freeze current technical semantics.

Required before live activation:

- current provider-owned create/query technical contract or authenticated sandbox proof;
- authoritative recovery identifier/order;
- current webhook authentication/replay identity;
- current status vocabulary/rate limits;
- exact Pix-out contract before capability reconsideration.

## AkkadPag live transport/adapter activation — `BLOCKED ON CURRENT EVIDENCE`

A5 is GREEN, but that does not authorize real monetary transport.

## FlevoPay live transport/adapter activation — `BLOCKED ON CURRENT EVIDENCE`

A5 is GREEN, but current production/sandbox contract proof remains insufficient.

## Provider webhook ingress — `BLOCKED ON CURRENT EVIDENCE`

Exact provider-specific authentication/replay contracts are required before inbound evidence can be trusted.

## Provider recovery/reconciliation runtime — `BLOCKED ON CURRENT EVIDENCE`

Requires authoritative current query/recovery semantics and subsequently live adapter acceptance.

---

# Phase 5 — Merchant/admin product surfaces

## A6 — dashboard session authentication — `DONE`

Pre-analysis prerequisite: `docs/design/webhook-endpoint-management-preanalysis.md`.
Problem Analysis: `docs/design/a6-dashboard-session-authentication-problem-analysis.md`.
Spec: `docs/specs/dashboard-session-authentication-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-16-a6-dashboard-session-authentication.md`.

A6 makes the K3/K4 dashboard authorization model executable from the trusted API runtime without adding a dashboard business route.

Accepted boundary:

- `/v1/**` machine-token realm remains separate from future `/dashboard/v1/**` Supabase-user realm;
- strict Bearer parsing;
- exactly one server-side Supabase Auth `/auth/v1/user` verification attempt;
- 5-second timeout, no redirects, no hidden retry;
- only verified `userId` becomes identity authority;
- JWT metadata cannot grant merchant/environment/role authority;
- 401/403 becomes invalid session;
- Auth/network/timeout/redirect/rate-limit/malformed success becomes authentication unavailable;
- modern `sb_publishable_...` key only;
- no `service_role`, `sb_secret_...` or Supabase JWT secret in API authority;
- `app.require_dashboard_merchant_context(...)` remains the sole merchant/environment/role boundary;
- current role/status changes are visible on the next check;
- no fallback from dashboard session verification to A1 machine authentication;
- no authorization side effects.

Clean RED:

- head `948f5369802dfe682e8c8c0aaeeb8cfa908f3ece`;
- Application workflow `31928177006`: typecheck/build PASS, 152 existing tests PASS + exactly 34 expected A6 behavior failures;
- runtime reached A6 after K7/A1/A2/A3/A4 and failed only with `behavior_not_implemented:createDashboardAuthorizationService`;
- Database workflow `31928177032`: GREEN.

GREEN:

- final head `4ac4e0b53776e55361f90d5589e5f72bcbdce49c`;
- Application workflow `31928641553`: GREEN, 186/186 + K7/A1/A2/A3/A4/A6 real runtime;
- Database workflow `31928641539`: GREEN, pgTAP + K5 + K6;
- no migration or hosted Supabase schema mutation required.

## Webhook endpoint management API — `PENDING / NEXT UNBLOCKED CANDIDATE`

A4 can already deliver to durable endpoints and A6 now provides the trusted dashboard identity/merchant-authorization prerequisite, but merchants still do not have a first-class management surface.

Existing pre-analysis found one remaining design blocker that must be frozen before RED: the A4 AES webhook-secret encryption key is worker-only. The API must not silently receive that worker key merely to create/rotate endpoint signing secrets.

Candidate boundary to plan next:

- create endpoint;
- list/get merchant-owned endpoints;
- update subscribed event types / URL within the frozen A4 destination policy;
- disable/re-enable endpoint;
- create/rotate signing secret with one-time plaintext return and encrypted-at-rest storage through an explicitly designed key-management boundary;
- strict dashboard merchant/environment ownership through A6/K4;
- audit events and least-privilege trusted DB routines;
- no direct browser table mutation;
- test/replay controls only if separately frozen and safe.

Mandatory pipeline still starts at Problem Analysis; no implementation is authorized yet.

Other merchant/admin work:

- Dashboard login/session UX and Supabase Auth product configuration — `PENDING` (trusted server-side verification boundary A6 is DONE)
- API credential management UI/API — `PENDING`
- Merchant Pix transaction list/detail/search/status UI — `PENDING`
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

Parallel unblocked product path:
  -> A6 dashboard session authentication                 DONE
  -> webhook endpoint management API                     PENDING / NEXT CANDIDATE
  -> merchant transaction/credential operations         PENDING
  -> broader admin/KYC operations                        PENDING

Then:
  -> production hardening / observability / cutover      PENDING
```

## Immediate next action

Because live PSP work is correctly blocked on external/current contract evidence, the next internal slice can advance sandbox usability without guessing provider behavior:

1. promote `docs/design/webhook-endpoint-management-preanalysis.md` into the full Problem Analysis using A6 as the identity prerequisite;
2. freeze the signing-secret generation/encryption/key-custody boundary without giving the generic API the worker-only A4 encryption key by accident;
3. freeze endpoint CRUD/status/subscription/rotation/audit semantics in a management/API YAML specification;
4. write RED database/application contracts;
5. implement only after clean RED.

In parallel, provider evidence should be upgraded through provider-owned current technical documentation or authenticated non-monetary/current sandbox proof.

**Do not call AkkadPag, AkadPay or FlevoPay monetarily until the applicable current-contract evidence gate is closed.**