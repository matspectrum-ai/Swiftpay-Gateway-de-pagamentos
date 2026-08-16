# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-16

This is the durable backlog and handoff ledger for the reconstruction. Repository artifacts are the source of truth. Detailed proof lives in specs, migrations, tests and `docs/evidence/**`; Git history preserves checkpoint chronology.

Executive readiness checkpoint: `docs/product/v1-readiness-status.md`.

## States

- `PENDING`: known, not started
- `IN_PROGRESS`: actively being worked
- `EVIDENCE_REQUIRED`: implementation exists but closure evidence is incomplete
- `BLOCKED`: cannot proceed without an external dependency or unresolved contract
- `DONE`: contract, implementation and required evidence are complete
- `DEFERRED`: intentionally outside the current critical path
- `DROPPED`: explicitly removed from scope
- `SUPERSEDED`: replaced by a later canonical artifact

## Current checkpoint

- Branch: `agent/foundation-phase-0`
- Draft PR: #1 — `foundation: establish SwiftPay V2 reconstruction baseline`
- `main`: intentionally untouched by this workstream
- Canonical hosted Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`)
- A4 hosted migration alignment commit: `ac41a57e64fca69871e0d26bafe05d888b8e3cbd`
- A4 post-sync Application workflow: `31924944437` — GREEN
- A4 post-sync Database workflow: `31924944433` — GREEN
- Canonical database lane: 37 files / 1272 pgTAP tests / PASS
- Application contract lane: 128 tests / PASS
- Real A4 acceptance: concurrency-success / retry-once / disabled-after-fanout / stale-fence — GREEN
- Core architecture/domain/database/platform foundation estimate: ~99%
- Weighted V1 engineering estimate: ~64%
- First end-to-end Pix sandbox MVP estimate: ~88%
- Production-capable Pix V1 estimate: ~49%
- Current critical slice: A5 provider conformance fixtures

## Non-negotiable delivery method

Every new behavior follows this order:

1. Problem Analysis
2. YAML Specification
3. Contracts/interfaces
4. Tests first — RED
5. Minimal implementation — GREEN
6. Refactor without behavior drift
7. Evidence + handoff update

No live PSP integration is allowed to bypass deterministic emulator and provider-conformance gates. No merchant/browser surface receives direct financial authority. Ambiguous monetary execution remains explicit `execution_unknown`/recovery state; it is never converted into a fabricated definitive failure.

---

# Phase 0 — Reconstruction truth and target architecture

## Product/reverse-engineering baseline — `DONE`

Canonical artifacts establish a Pix-first TypeScript modular monolith with Fastify trusted API, separate worker, Supabase/PostgreSQL canonical state, provider-agnostic Payment Core, append-oriented financial/audit semantics, durable jobs and merchant webhooks. AkkadPag and FlevoPay remain the initial retained live-provider targets behind conformance gates.

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

Payout/refund merchant-usable application/API/UI execution remains pending. Live-provider reconciliation remains gated by provider conformance/live evidence.

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

Canonical seed remains deterministic and non-financial. Runtime/API credentials, Payments, Ledger transactions, jobs and merchant webhook events are not pre-seeded; acceptance uses separate TEST-ONLY fixtures.

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

Accepted: `POST /v1/auth/token`, `scrypt-v1`, 900-second HS256 token, exact-IP allowlist, atomic issuance quota, current-DB revalidation, immediate revoke/version invalidation, narrow trusted routines and no financial side effect.

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

Credential create/rotate/revoke management UI/API and signing-key-ring rotation remain `PENDING`.

## A2 — `pix-create-get-emulator-v0` — `DONE`

Specs:

- `docs/specs/pix-create-get-emulator-v0.yaml`
- `docs/specs/pix-create-get-emulator-fixture-v0.yaml`

Accepted: authenticated create/get, Bearer revalidation first, sandbox-only create, strict validation/hashing, required merchant/environment idempotency, durable Payment + ProviderAttempt before execution, atomic attempt claim, deterministic visibly non-payable emulator, pending/unknown/rejection semantics, safe replay/conflict and production fail-closed behavior.

Canonical hosted migrations:

- `20260815101512_pix_create_get_emulator_foundation.sql`
- `20260815101609_pix_create_get_emulator_behavior.sql`
- `20260815101641_pix_create_get_emulator_prepare_key_count_fix.sql`
- `20260815101729_pix_create_get_emulator_resolve_coalesce_fix.sql`

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

## A3 — `paid-transition-ledger-balance-v0` — `DONE`

Spec: `docs/specs/paid-transition-ledger-balance-v0.yaml`.

Accepted: worker-only sandbox paid evidence, serialized Payment transition, immutable ProviderEvent evidence identity, replay/concurrency absorption, exactly one `settlement_paid` double-entry posting, pending-liability merchant credit, authenticated `GET /v1/balance`, merchant-safe paid projection and transactional `payment.paid` outbox creation.

Canonical hosted migrations:

- `20260816004515_paid_transition_ledger_balance_foundation.sql`
- `20260816004620_paid_transition_ledger_balance_behavior.sql`

Evidence: `docs/evidence/application/2026-08-15-a3-paid-transition-ledger-balance.md`.

### A3 gates

- [x] Problem Analysis / frozen YAML
- [x] RED database/application/runtime contracts
- [x] minimal GREEN
- [x] duplicate/concurrent evidence acceptance
- [x] hosted migration synchronization / ACL verification
- [x] clean post-sync reproducibility
- [x] evidence report

## A4 — merchant webhook delivery runtime — `DONE`

Problem Analysis: `docs/design/a4-merchant-webhook-delivery-problem-analysis.md`.

Spec: `docs/specs/merchant-webhook-delivery-runtime-v0.yaml`.

Accepted boundary:

- durable A3 outbox consumption;
- composed Job + WebhookDelivery lease with one fencing token;
- exact `swiftpay_worker` capability boundary and no direct webhook/job DML;
- `signing_secret_version` snapshot at fanout and bounded previous-secret rotation support;
- dedicated AES-256-GCM webhook-secret encryption key;
- deterministic compact JSON and HMAC-SHA256 request signature;
- strict HTTPS/443, DNS/IP/redirect policy and pinned TLS destination;
- one 5-second attempt, no hidden transport retry;
- deterministic retry/backoff/jitter/Retry-After policy;
- eight-attempt ceiling plus success/retry/terminal/disabled durable states;
- safe multi-worker concurrency and stale-fence rejection;
- no Payment/Account/Ledger mutation;
- secret/ciphertext/signature log-leak rejection.

Canonical hosted migrations:

- `20260816034121_merchant_webhook_delivery_runtime_foundation.sql`
- `20260816034224_merchant_webhook_delivery_runtime_behavior.sql`

Accepted post-sync CI:

- Application workflow `31924944437`: GREEN, 128/128 contracts plus K7/A1/A2/A3/A4 real runtime acceptance;
- Database workflow `31924944433`: GREEN, 37 files / 1272 pgTAP assertions, K5 and K6.

Hosted verification:

- A4 claim/resolve routines are `SECURITY DEFINER`, `VOLATILE`, `search_path=''`;
- only `swiftpay_worker` may execute them;
- worker executable function allowlist is exactly six routines;
- no A4 RPC references Payment/Account/Ledger tables;
- Supabase Security Advisor: zero lints;
- Performance Advisor: INFO-only optimization debt, no A4 blocker.

Evidence: `docs/evidence/application/2026-08-16-a4-merchant-webhook-delivery-runtime.md`.

### A4 gates

- [x] inspect persistence/job contracts
- [x] Problem Analysis
- [x] frozen YAML spec
- [x] frozen signing/delivery/retry/security contracts
- [x] RED database contracts
- [x] RED application crypto/policy/store/service/worker contracts
- [x] clean RED gate before implementation
- [x] minimal GREEN implementation
- [x] multi-worker concurrency acceptance
- [x] 503 retry acceptance
- [x] disabled-after-fanout acceptance
- [x] stale-fence acceptance
- [x] secret/redaction and financial-invariance proof
- [x] hosted migration synchronization
- [x] hosted ACL/security verification
- [x] post-sync clean-database CI
- [x] evidence report

---

# Phase 4 — PSP conformance and live Pix providers

## A5 — provider conformance fixtures — `PENDING / NEXT`

No live monetary network call is allowed in A5. The next step is the mandatory planning/TDD pipeline grounded in `docs/contracts/native-pix-provider-adapter.md` and retained provider evidence.

A5 must freeze, per provider and operation:

- source-of-truth provenance/confidence for AkkadPag and FlevoPay;
- auth mechanism and secret placement contract without real credentials in Git;
- capability matrix (`create/query/recover/webhook`, Pix-in first; unsupported remains disabled);
- amount unit and exact integer conversion;
- customer/identity requirements with no synthesized data;
- stable client reference and idempotency level (`native_strong`, `query_recoverable`, `none`);
- create success / definitive rejection / pre-execution failure / `execution_unknown` mapping;
- query/recovery lookup semantics after uncertainty;
- external payment/TxId/reference/event identity uniqueness scopes;
- webhook authentication, event identity and replay semantics;
- status/error taxonomy mapping;
- deterministic sanitized request/response/webhook fixtures;
- common + provider-specific RED conformance tests;
- proof that monetary POSTs have no transparent retry;
- proof that conformance CI performs no live PSP calls.

### A5 gate sequence

- [ ] inventory canonical provider/reverse-engineering evidence
- [ ] separate proven facts from assumptions/unknowns
- [ ] Problem Analysis
- [ ] freeze provider-conformance YAML spec
- [ ] freeze capability/auth/idempotency/recovery matrices
- [ ] add sanitized deterministic fixtures
- [ ] RED common adapter conformance suite
- [ ] RED AkkadPag fixture suite
- [ ] RED FlevoPay fixture suite
- [ ] minimal adapters/translators GREEN against fixtures only
- [ ] recovery/`execution_unknown` tests
- [ ] webhook normalization/authentication fixture tests
- [ ] evidence report

## AkkadPag live adapter — `BLOCKED`

Blocked until the applicable A5 provider conformance suite is GREEN and real credential/bootstrap policy is separately approved.

## FlevoPay live adapter — `BLOCKED`

Blocked until the applicable A5 provider conformance suite is GREEN and real credential/bootstrap policy is separately approved.

## Provider webhook ingress — `PENDING`

Requires provider-specific verification/replay contracts and canonical transition orchestration proven through A5 fixtures first.

## Provider recovery/reconciliation runtime — `PENDING`

Requires live adapter behavior plus timeout/retry ambiguity policy and external evidence.

---

# Phase 5 — Merchant/admin product surfaces

- Merchant authentication/session surface — `PENDING`
- API credential management UI/API — `PENDING`
- Merchant Pix transaction list/detail/search/status UI — `PENDING`
- KYC/compliance operations UI — `PENDING`
- Webhook endpoint management UI/API — `PENDING`
- Payout/refund operational API/UI — `PENDING`

Webhook endpoint management includes create/update/disable, one-time/rotated secret handling, test delivery and replay controls after A4.

---

# Phase 6 — Hosted checkout / links / conversion

- Hosted Pix checkout — `PENDING`
- Payment links — `PENDING`
- Conversion/analytics surfaces — `PENDING`

These remain intentionally behind the core gateway lifecycle.

---

# Phase 7 — Production hardening and launch

## Observability — `PENDING`

Structured redacted logs, auth/Pix/provider/job/webhook/reconciliation metrics, correlation tracing, alerts, dashboards and SLOs.

## Security hardening — `PENDING`

Final secret inventory/rotation, signing-key rotation architecture, dependency/security review, least-privilege audit, abuse/rate-limit review and operational audit review.

## Performance debt — `PENDING`

Supabase Performance Advisor currently reports INFO-level unindexed foreign keys and unused indexes. Do not add/remove indexes opportunistically. Measure query plans/workload and address them in a dedicated tested optimization slice.

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
  -> A5 provider conformance fixtures                    PENDING / NEXT
  -> AkkadPag/FlevoPay live adapters                     BLOCKED ON A5
  -> provider webhook ingress/recovery                   PENDING
  -> merchant/admin operational surfaces                PENDING
  -> production hardening/cutover                        PENDING
```

## Immediate next action

Execute the mandatory planning/TDD pipeline for A5 provider conformance fixtures:

1. inventory all canonical evidence about AkkadPag and FlevoPay;
2. classify each provider fact as proven / inferred / unknown and identify evidence gaps;
3. produce A5 Problem Analysis;
4. freeze the network-free provider-conformance YAML specification and capability matrices;
5. add deterministic sanitized fixtures and RED conformance tests;
6. only then implement the minimal fixture-backed adapter behavior.

**Do not call AkkadPag or FlevoPay live yet.**
