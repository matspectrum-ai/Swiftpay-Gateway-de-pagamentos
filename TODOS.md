# SwiftPay V2 — Canonical Work Ledger

Updated: 2026-08-18

This is the durable backlog and handoff ledger for the reconstruction. Repository artifacts are the source of truth. Detailed proof lives in specs, migrations, tests and `docs/evidence/**`; Git history preserves checkpoint chronology.

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
- A1-A16: `DONE` (`A5` remains fixture-only for live-provider authority; A10 is executable default-deny; A11 is strict outbound HTTPS and remains unbound from retained PSP adapters; A12 is safe runtime logging/correlation; A13 is bounded runtime-only metrics/OpenMetrics; A14 is hosted fail-closed ingress abuse limiting; A15 is application-only machine access-token signing-key rotation; A16 is application-only dashboard transaction cursor HMAC rotation)
- A16 Problem Analysis: `docs/design/a16-dashboard-transaction-cursor-hmac-rotation-problem-analysis.md`
- A16 frozen spec: `docs/specs/dashboard-transaction-cursor-hmac-rotation-v0.yaml`
- A16 contract: `docs/contracts/dashboard-transaction-cursor-hmac-rotation-v0.md`
- A16 final evidence: `docs/evidence/application/2026-08-18-a16-dashboard-transaction-cursor-hmac-rotation.md`
- A16 accepted behavioral head: `8f181d6b3b3c7a43309e4e36061cf193d082c259`
- A16 Application workflow: `32130004275` — GREEN, **336/336 application contracts**, including **14/14 A16**; isolated runtime rerun passed K7/A1/A2/A3/A4/A6/A7/A8/A9/A14
- A16 Database workflow: `32130004397` — GREEN, **41 files / 1298 pgTAP assertions** + K5 fixtures + K6 runtime topology
- A16 hosted migrations: **none**
- A16 retained-provider network calls: **0**
- A10 default authorized provider runtime operations after A16: **0**
- A14 hosted migration remains `20260818054252_ingress_abuse_rate_limit_hardening`
- Hosted `swiftpay_api`: exact **24** `app` EXECUTE capabilities
- Hosted `swiftpay_worker`: exact **6** `app` EXECUTE capabilities
- Hosted Security Advisor after A14: **0 lints**
- Hosted Payment rows after A14: **0**
- Hosted ProviderAttempt rows after A14: **0**
- Core architecture/domain/database/platform estimate: ~99%
- First end-to-end Pix sandbox MVP estimate: ~97%
- Production-capable Pix V1 estimate: ~60%
- Weighted V1 engineering estimate: ~75%
- Current external critical blocker: exact current PSP contract/lineage/idempotency/recovery/webhook-auth evidence plus authenticated current sandbox proof for the selected retained contract
- Next highest-value action: provider-owned current contract/lineage evidence and authenticated sandbox proof. Do not bridge A5 retained adapters to A11 until those evidence gates close.

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

A14 later strengthens K7 readiness semantics: a deliberately wrong API database identity is rejected by ingress admission before the readiness DB probe because it lacks the API-only abuse-quota RPC, while liveness remains independent.

---

# Phase 3 — Public API authentication and deterministic Pix lifecycle

## A1 — API credential token exchange and Bearer authentication — `DONE`

Spec: `docs/specs/api-credential-token-exchange-v0.yaml`.
Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

Accepted: `client_credentials`, opaque secret verifier, exact-IP policy, issuance quota, 900-second machine token and DB revalidation. Dashboard credential create/list/get/rotate/revoke administration is supplied by hosted A8 while A1 remains authoritative for machine authentication and token revalidation. A14 adds a separate network-level pre-auth throttle without replacing the A1 successful-issuance quota. A15 later replaces the single signing secret with an explicit bounded `kid` keyring while preserving the A1 public/claim/revalidation contract.

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
- the retained adapters remain network-free; A11 later introduces the only approved Node network boundary in `http-transport.ts`, but does not wire it to A5 adapters.

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
- no provider call, route, database migration or monetary side effect was introduced by A10.

Final GREEN proof:

- head `0308844c4aedb1d359068becfd29d1f4a234b064`;
- Application workflow `32011311478`: typecheck/build GREEN, **250/250 application contracts PASS**, including **10/10 A10** plus K7/A1-A9 real-database regression acceptance;
- Database workflow `32011311485`: **40 files / 1292 pgTAP assertions PASS**, K5 deterministic fixtures GREEN and K6 runtime topology GREEN;
- hosted Supabase changes: none;
- live PSP calls: none.

A10 closes an internal safety gap; it does **not** close provider contract authority.

## A11 — strict provider HTTP transport — `DONE / GREEN / UNBOUND`

Problem Analysis: `docs/design/a11-strict-provider-http-transport-problem-analysis.md`.
Spec: `docs/specs/strict-provider-http-transport-v0.yaml`.
Contract: `docs/contracts/strict-provider-http-transport-v0.md`.
RED evidence: `docs/evidence/application/2026-08-17-a11-strict-provider-http-transport-red.md`.
Final evidence: `docs/evidence/application/2026-08-17-a11-strict-provider-http-transport.md`.

Accepted boundary:

- `packages/providers/src/http-transport.ts` is the only approved Node network boundary in the provider package;
- construction accepts only the branded runtime-validated A10 registry and internally performs exact subject authorization;
- default A10 registry denies all retained-provider traffic before DNS;
- provider origin/base path comes only from the immutable A10 authorization grant;
- caller absolute URLs, scheme-relative URLs, rooted paths, backslashes, fragments, dot traversal and base-path escapes are rejected before DNS;
- only GET/POST are accepted and GET bodies are rejected;
- routing/hop-by-hop headers, CRLF, oversize path/header/body inputs are rejected before DNS;
- fresh all-address DNS lookup per send; empty/private/reserved/mixed answers fail pre-transmission;
- first validated public address is pinned while approved hostname remains authoritative for SNI/Host;
- certificate verification enabled, TLS minimum 1.2, 5-second request timeout, 16 KiB response-header ceiling and 1 MiB response-body ceiling;
- no proxy routing, transparent decompression, redirect following or retry;
- executor is invoked at most once per send;
- 3xx/408/425/429/5xx are returned once to the caller rather than automatically retried/followed;
- network/timeout/oversize/invalid-UTF8/invalid-status ambiguity is explicit `transmission_unknown`;
- errors are redaction-safe and carry only stable classification fields;
- no provider business-status mapping, Payment/ProviderAttempt mutation, DB state, route or credential ownership was added;
- A5 retained adapters are explicitly **not wired** to A11.

Final GREEN proof:

- behavioral head `7f3b373fe0bdfe32ae9f1924e9e461071abeea6d`;
- Application workflow `32014646148`: typecheck/build GREEN, **265/265 application contracts PASS**, including **15/15 A11** plus K7/A1-A9 real-database regression acceptance;
- Database workflow `32014646143`: **40 files / 1292 pgTAP assertions PASS**, K5 deterministic fixtures GREEN and K6 runtime topology GREEN;
- hosted Supabase changes: none;
- retained-provider calls in tests/CI: none;
- default A10 authorized provider operations: zero.

During GREEN, the prior A5 package-wide “no Node network primitive anywhere” assertion was refined rather than removed: the contract now requires `http-transport.ts` to be the only provider-package network boundary while all retained A5 adapter source remains network-free. No A11 behavior test was weakened.

A11 closes the safe-transport implementation gap but does **not** close provider contract authority or authorize adapter bridging. Readiness remains conservatively unchanged at 99/97/60/75.

## Current-provider contract evidence gate — `EVIDENCE_REQUIRED`

Canonical refreshes:

- `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`
- `docs/evidence/providers/2026-08-18-current-provider-contract-critical-path-refresh.md`

### AkkadPag / AkadPay

Legacy retained evidence proves `api.akkadpag.com/v1`, Basic Auth and `transactions`/`transfers`.

Current public AkadPay technical material now documents a materially different API under `painel.akadpay.com.br/api/...`, including current Pix-IN creation, Pix-OUT creation, same-key/same-data Pix-OUT idempotency semantics and useful webhook replay identifiers. No accepted provider-owned artifact proves that AkadPay is the migration/current contractual lineage of the retained AkkadPag API, that credentials/contracts are interchangeable, or that the AkadPay public contract may authorize `akkadpag-legacy-api-v1`. Exact query/recovery coverage and trusted webhook cryptographic verification also remain incomplete.

Required before retained live activation:

- provider-owned lineage/equivalence or a deliberate provider replacement decision;
- exact current create/query correlation and idempotency/recovery semantics for the selected lineage;
- exact webhook authentication/replay identity;
- current status vocabulary/rate limits;
- authenticated sandbox proof before `sandbox_proven`;
- a separately specified/tested A5→A11 bridge only after those evidence gates close.

### FlevoPay

Legacy retained evidence proves historical `app.flevopay.com.br/api/v1`, `X-API-Key`, Pix create/query and no Pix-out adapter.

Current provider-owned material exposes `api.flevopay.com/v1` and current Basic `PUBLIC_KEY:SECRET_KEY` authentication evidence. This proves material authentication drift from the retained historical `X-API-Key` adapter, not compatibility. The exact executable current create/query/recovery/webhook contract remains incomplete.

Required before retained live activation:

- current provider-owned create/query technical contract or authenticated current sandbox proof;
- authoritative recovery identifier/order and idempotency semantics;
- exact webhook authentication/replay identity;
- current status vocabulary/rate limits;
- exact Pix-out contract before capability reconsideration;
- a separately specified/tested A5→A11 bridge only after those evidence gates close.

## AkkadPag live transport/adapter activation — `BLOCKED ON CURRENT EVIDENCE`

## FlevoPay live transport/adapter activation — `BLOCKED ON CURRENT EVIDENCE`

## Provider webhook ingress — `BLOCKED ON CURRENT EVIDENCE`

## Provider recovery/reconciliation runtime — `BLOCKED ON CURRENT EVIDENCE`

**A5 + A10 + A11 authorize zero live retained-provider operations.**

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

Accepted boundary includes dashboard read/create/rotate/revoke, AAL2 mutation gate, role-sensitive Sandbox/Production authority, CSPRNG credential material, one-time secret disclosure, A1-compatible scrypt verifier, exact-IP policy, optimistic revision, immediate token invalidation, active-credential cap, idempotency/audit and zero direct protected-table authority. A15 acceptance explicitly re-proves A8 token invalidation semantics using the new branded signing authority.

Hosted migrations:

- `20260817061316_api_credential_management_foundation.sql`
- `20260817061346_api_credential_management_create.sql`
- `20260817061415_api_credential_management_behavior.sql`

## A9 — merchant transaction operations — `DONE / HOSTED`

Problem Analysis: `docs/design/a9-merchant-transaction-operations-problem-analysis.md`.
Spec: `docs/specs/merchant-transaction-operations-v0.yaml`.
Contracts: `docs/contracts/merchant-transaction-operations-v0.md`, `docs/contracts/merchant-transaction-operations-database-v0.md`.
Evidence: `docs/evidence/application/2026-08-17-a9-merchant-transaction-operations.md`.

Accepted boundary includes dashboard-only read list/detail, current member authority, canonical Payment statuses, exact filters, HMAC-authenticated keyset cursor, merchant-safe list/detail projections, two trusted read RPCs and zero financial/provider/idempotency/audit/job/webhook/credential side effects. A16 later replaces only the A9 single cursor HMAC secret/token envelope with explicit key-ID-aware rotation while preserving the A9 payload binding and read behavior.

Final GREEN proof:

- behavioral head `f846a50f2c8afe8f5561a59aebef8574e22ac6d6`;
- Application workflow `32009421604`: **240/240 application contracts PASS** + K7/A1-A9 real-database acceptance;
- Database workflow `32009421592`: **40 files / 1292 pgTAP assertions PASS** + K5/K6.

Hosted migration:

- `20260817081745_merchant_transaction_operations.sql`

Hosted post-A9 audit kept `swiftpay_api` at 23 execute capabilities and worker at 6. A14 later adds exactly one API-only abuse-quota RPC, moving the current hosted API total to 24 while worker remains 6.

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

## A12 — structured runtime logging & correlation — `DONE / GREEN / RUNTIME-ONLY`

Problem Analysis: `docs/design/a12-structured-runtime-logging-correlation-problem-analysis.md`.
Spec: `docs/specs/structured-runtime-logging-correlation-v0.yaml`.
Contract: `docs/contracts/structured-runtime-logging-correlation-v0.md`.
Evidence: `docs/evidence/application/2026-08-17-a12-structured-runtime-logging-correlation.md`.

Accepted: server-owned UUIDv4 request correlation, closed-schema redacted JSONL logging, matched-route-template access events, no raw Error forwarding and no hidden network/database exporter authority. Behavioral proof: Application `32019551464` — **276/276 PASS**; Database `32019551475` — **40 files / 1292 assertions PASS**.

Known compatibility debt remains explicit: Fastify 5.11 emits `FSTDEP023` for the top-level `disableRequestLogging` option; migrate before Fastify 6 in a dedicated compatibility slice.

## A13 — operational metrics & health signals — `DONE / GREEN / RUNTIME-ONLY`

Problem Analysis: `docs/design/a13-operational-metrics-health-signals-problem-analysis.md`.
Spec: `docs/specs/operational-metrics-health-signals-v0.yaml`.
Contract: `docs/contracts/operational-metrics-health-signals-v0.md`.
Evidence: `docs/evidence/application/2026-08-17-a13-operational-metrics-health-signals.md`.

Accepted: dependency-free `@swiftpay/metrics`, closed low-cardinality metric methods, HTTP count/duration, readiness and worker-batch outcomes, deterministic bounded OpenMetrics rendering, optional workload-specific scrape ports and loopback-only `127.0.0.1` listeners. Dynamic IDs, money, PII, raw URLs, SQL, errors, secrets and provider payloads are excluded from labels/output. Telemetry failure cannot change payment/domain/readiness/worker semantics.

Final GREEN proof:

- behavioral head `9393fda1cee8a0ceaf3b215d3efc8063ee5cd390`;
- Application workflow `32094346060`: **288/288 application contracts PASS**, including **12/12 A13**, + K7/A1-A9 real-database acceptance;
- Database workflow `32094346105`: **40 files / 1292 pgTAP assertions PASS**, K5 and K6 GREEN;
- evidence-head workflows `32094504874` / `32094504849`: GREEN;
- hosted Supabase changes: none;
- retained-provider calls: none;
- provider/financial authority changes: none.

Remaining observability work — `PENDING`: external collection/export, alerting, dashboards, SLO policy and distributed tracing. These are not implicit in A13.

## A14 — ingress abuse / rate-limit hardening — `DONE / GREEN / HOSTED`

Problem Analysis: `docs/design/a14-ingress-abuse-rate-limit-hardening-problem-analysis.md`.
Spec: `docs/specs/ingress-abuse-rate-limit-hardening-v0.yaml`.
Contract: `docs/contracts/ingress-abuse-rate-limit-hardening-v0.md`.
Evidence: `docs/evidence/application/2026-08-18-a14-ingress-abuse-rate-limit-hardening.md`.

Accepted: exact trusted-proxy list with no generic `trustProxy`, canonical IPv4/IPv6 origin handling, HMAC-SHA256 opaque limiter subjects, separate network and merchant/environment fixed-window quotas, pre-auth admission before expensive boundaries, mutation admission before Pix/idempotency side effects, protected readiness with independent liveness, deterministic 429/Retry-After, fail-closed sanitized 503, bounded stale-window pruning, API-only RPC authority and zero provider/financial authority.

Final GREEN proof:

- final behavior/evidence head before handoff-only commits `d12d05016019cf07065da141e0a5d4e7abecc58a`;
- Application workflow `32103726491`: **306/306 application contracts PASS** + K7/A1-A9/A14 real-database acceptance;
- Database workflow `32103726496`: **41 files / 1298 pgTAP assertions PASS** + K5/K6;
- hosted migration `20260818054252_ingress_abuse_rate_limit_hardening`;
- hosted API EXECUTE capabilities: **24**; worker: **6**;
- forbidden A14 public/Data API/service/worker function authority: **0**;
- forbidden direct A14 table privileges for public/Data API/service/runtime roles: **0**;
- Security Advisor: **0 lints**;
- hosted Payment/ProviderAttempt rows after deploy: **0/0**;
- retained-provider calls: **0**.

## A15 — machine access-token signing-key rotation — `DONE / GREEN / APPLICATION-ONLY`

Problem Analysis: `docs/design/a15-machine-access-token-signing-key-rotation-problem-analysis.md`.
Spec: `docs/specs/machine-access-token-signing-key-rotation-v0.yaml`.
Contract: `docs/contracts/machine-access-token-signing-key-rotation-v0.md`.
RED evidence: `docs/evidence/application/2026-08-18-a15-machine-access-token-signing-key-rotation-red.md`.
Final evidence: `docs/evidence/application/2026-08-18-a15-machine-access-token-signing-key-rotation.md`.

Accepted: bounded one-to-four-key HS256 signing authority, exact active `kid`, strict per-`kid` verification with no trial-all fallback, branded immutable authority, explicit verify-only legacy no-`kid` transition slot, exact 900-second A1 token lifetime and claim contract, current PostgreSQL credential revalidation, immediate A8 secret-version/revocation invalidation, redacted configuration failures and no implicit fallback to the old single-key environment variable.

Final GREEN proof:

- accepted implementation head `1ad6fb9b44d89e05d598db81f15c11ef745da6f9`;
- Application workflow `32116297016`: **322/322 application contracts PASS** + K7/A1/A2/A3/A4/A6/A7/A8/A9/A14 real-database acceptance;
- Database workflow `32116297019`: **41 files / 1298 pgTAP assertions PASS** + K5/K6;
- hosted Supabase changes: none;
- retained-provider calls: none;
- provider/financial authority changes: none;
- A10 default authorized provider operations: zero.

A15 intentionally did not rotate the A9 cursor HMAC key, A14 abuse HMAC key, webhook cryptographic authorities, API credential secrets or provider credentials. The independent A9 cursor HMAC rotation was later completed as A16.

## A16 — dashboard transaction cursor HMAC rotation — `DONE / GREEN / APPLICATION-ONLY`

Problem Analysis: `docs/design/a16-dashboard-transaction-cursor-hmac-rotation-problem-analysis.md`.
Spec: `docs/specs/dashboard-transaction-cursor-hmac-rotation-v0.yaml`.
Contract: `docs/contracts/dashboard-transaction-cursor-hmac-rotation-v0.md`.
RED evidence: `docs/evidence/application/2026-08-18-a16-dashboard-transaction-cursor-hmac-rotation-red.md`.
Final evidence: `docs/evidence/application/2026-08-18-a16-dashboard-transaction-cursor-hmac-rotation.md`.

Accepted: bounded one-to-four-key cursor HMAC authority, exact active `kid`, `a9v1.<kid>.<payload>.<signature>` active-only issuance, exact per-`kid` verification with no trial-all fallback, retained non-active v1 overlap keys, explicit verify-only legacy `a9v0` slot, immutable validated key authority, preserved A9 merchant/environment/filter/createdAt/paymentId binding and no implicit fallback to the retired single-key cursor environment variable.

Final GREEN proof:

- accepted behavioral head `8f181d6b3b3c7a43309e4e36061cf193d082c259`;
- Application workflow `32130004275`: **336/336 application contracts PASS**, including **14/14 A16**;
- isolated final runtime rerun job `95689514098`: K7/A1/A2/A3/A4/A6/A7/A8/A9/A14 real-database acceptance GREEN; no A8/A16 code change was made for the initial transient A8 concurrency acceptance race;
- Database workflow `32130004397`: **41 files / 1298 pgTAP assertions PASS** + K5/K6;
- hosted Supabase changes: none;
- retained-provider calls: none;
- provider/financial authority changes: none;
- A10 default authorized provider operations: zero.

A16 intentionally does not rotate A14 abuse HMAC, A15 access-token signing authority, webhook cryptographic authorities, API credential secrets or provider credentials.

## Security hardening — `PENDING`

A14 closes ingress/rate limiting, A15 closes machine access-token signing-key rotation and A16 closes dashboard transaction cursor HMAC rotation. Remaining security work includes the other independent cryptographic authorities, dependency/security review, final least-privilege audit, operational audit review and production network/WAF hardening.

## Performance debt — `PENDING`

Supabase Performance Advisor currently reports INFO-level unindexed foreign keys and unused indexes. Address only in a dedicated measured/tested optimization slice. A14 limit tuning also requires production-like traffic measurements rather than arbitrary changes.

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
  -> A11 strict provider HTTP transport                  DONE / GREEN / UNBOUND
  -> current retained-PSP contract evidence              EVIDENCE_REQUIRED
       -> authenticated current sandbox proof            BLOCKED ON EVIDENCE
       -> A5-to-A11 provider bridge                      BLOCKED ON EVIDENCE
       -> live provider activation                       BLOCKED
       -> provider webhook ingress                       BLOCKED
       -> provider recovery/reconciliation               BLOCKED

Parallel internal product path:
  -> A6 dashboard session authentication                 DONE
  -> A7 webhook endpoint management                      DONE / HOSTED
  -> A8 API credential management                        DONE / HOSTED
  -> A9 merchant transaction operations                  DONE / HOSTED
  -> A16 dashboard transaction cursor HMAC rotation      DONE / GREEN
  -> broader admin/KYC/payout operations                 PENDING

Parallel production-hardening path:
  -> A12 safe runtime logging/correlation                DONE / GREEN
  -> A13 bounded operational metrics/OpenMetrics         DONE / GREEN
  -> A14 ingress abuse/rate-limit hardening              DONE / GREEN / HOSTED
  -> A15 machine access-token signing-key rotation       DONE / GREEN
  -> A16 dashboard cursor HMAC rotation                  DONE / GREEN
  -> external exporters/alerts/SLOs/tracing              PENDING
  -> remaining crypto authorities/security review        PENDING
  -> performance/load/capacity                           PENDING
  -> deployment/backup/cutover/rollback                  PENDING
```

## Immediate next action

A16 is fully GREEN and application-only. The living functional checklist remains the durable feature-level status surface and must be updated after every accepted slice.

1. do not wire AkkadPag/AkadPay/FlevoPay adapters to A11 merely because the transport primitive exists;
2. continue exact provider-owned current technical evidence acquisition and require authenticated current sandbox proof before `sandbox_proven`;
3. if provider evidence closes, freeze a dedicated A5→A11 bridge/activation Problem Analysis and continue strict TDD;
4. preserve the checked-in A10 registry at zero outbound authority until an evidence-backed transition is deliberately reviewed;
5. in parallel, only bounded work that does not obscure the PSP blocker should proceed: remaining independent cryptographic-authority rotation, external observability/SLOs, measured performance/load, deployment/backup/rollback runbooks or explicitly prioritized merchant product surfaces;
6. do not call AkkadPag, AkadPay or FlevoPay monetarily until the exact current-contract, sandbox and activation gates are closed.