# SwiftPay V2 — V1 Functional Checklist

Status source of truth for implemented product/runtime capabilities and remaining launch work.

This checklist is intentionally conservative. A checked item means the repository has an accepted executable or hosted contract for that capability. A database/domain foundation does **not** imply that its end-user workflow is production-ready. Provider fixtures and transport primitives do **not** authorize live PSP traffic.

Update rule: refresh this file after every accepted implementation slice or when a blocker materially changes.

## Readiness checkpoint

- [x] Core architecture/domain/database/platform foundation: ~99%
- [x] First end-to-end Pix sandbox MVP: ~97%
- [x] Weighted V1 engineering completion: ~75%
- [x] Production-capable Pix V1 readiness: ~60%
- [ ] Remaining weighted V1 engineering: ~25%
- [ ] Remaining production-launch capability/risk closure: ~40%

The remaining production gap is disproportionately concentrated in live PSP contract authority, authenticated sandbox proof, provider webhook/recovery/reconciliation, operational hardening and cutover.

## Foundation and runtime — K1-K7

- [x] TypeScript modular monolith workspace
- [x] Fastify API workload
- [x] Separate worker workload
- [x] Supabase/PostgreSQL canonical persistent state
- [x] Versioned database migrations
- [x] Dedicated `swiftpay_api` capability role
- [x] Dedicated `swiftpay_worker` capability role
- [x] Runtime roles have no direct protected-table DML
- [x] Narrow trusted RPC boundary
- [x] Production-like runtime topology acceptance
- [x] Deterministic sandbox fixtures
- [x] Application contract CI
- [x] pgTAP database contract CI
- [x] Real PostgreSQL runtime acceptance
- [x] `/health/live` liveness
- [x] `/health/ready` database-backed readiness

## Machine/API authentication — A1 + A15

- [x] `client_credentials` token exchange
- [x] Opaque Public Key + Secret Key credential model
- [x] `scrypt-v1` secret verification
- [x] No plaintext API secret persistence
- [x] Exact 900-second machine Bearer lifetime
- [x] Database-backed bearer revalidation
- [x] Credential revocation and secret-version drift rejection
- [x] Merchant lifecycle enforcement
- [x] Exact-IP allowlist support with canonical IPv4/IPv6
- [x] Successful issuance quota: 10/hour after valid credential/secret/IP
- [x] Invalid credential responses remain indistinguishable
- [x] Bounded 1..4 HS256 signing-key authority
- [x] Active `kid` issuance and exact-key verification
- [x] Unknown/retired `kid` fails closed without trial-all
- [x] Explicit verify-only legacy no-`kid` migration slot

## Pix transaction API — A2

- [x] `POST /v1/transactions`
- [x] Bearer machine authentication
- [x] `Idempotency-Key` normalization and request hashing
- [x] Atomic same-key concurrency behavior
- [x] Canonical Payment resource
- [x] Internal ProviderAttempt lifecycle
- [x] Deterministic sandbox Pix emulator
- [x] Emulator Pix is visibly non-payable
- [x] `GET /v1/transactions/:id`
- [x] Merchant/environment tenant isolation
- [x] `execution_unknown` preserved instead of fabricated failure
- [x] Production create remains fail-closed without provider authority

## Paid transition, ledger and balance — A3

- [x] Trusted sandbox paid-evidence command
- [x] Replay/concurrency-safe paid transition
- [x] Exactly one `settlement_paid` posting
- [x] Double-entry ledger foundation
- [x] Merchant balance trusted read
- [x] `GET /v1/balance`
- [x] Merchant/environment-scoped balance
- [x] Transactional `payment.paid` merchant outbox creation
- [x] Machine API cannot directly mark a Payment paid
- [x] Runtime roles cannot directly mutate ledger primitives

## Merchant webhook delivery and secret authority — A4 + A7 + A17

- [x] Merchant webhook delivery persistence
- [x] Worker-only delivery claim/resolve boundary
- [x] HMAC request signing and canonical payload serialization
- [x] Public HTTPS-only endpoint policy with DNS/public-address validation and pinning
- [x] Redirect-safe delivery
- [x] Retry classification and bounded retry schedule
- [x] Retry-After handling where contracted
- [x] Fenced worker lease behavior
- [x] Terminal failure behavior
- [x] Network/timeout ambiguity handled without unsafe retry loops
- [x] Dashboard create/list/get/update/disable/enable/rotate-secret
- [x] Optimistic revision fencing and idempotent mutations
- [x] CSPRNG signing-secret generation
- [x] RSA-OAEP-SHA256 persisted secret wrapping
- [x] Plaintext secret disclosure restricted to winning create/rotation result
- [x] Legacy persisted-secret AES decrypt/config/schema fallback retired
- [x] Persisted webhook secret-version authority is RSA-only

## Retained PSP conformance — A5

Current evidence pack: `docs/evidence/providers/2026-08-18-provider-contract-evidence-acquisition-pack.md`.

- [x] Retained AkkadPag legacy-lineage fixture adapter
- [x] Retained FlevoPay legacy-lineage fixture adapter
- [x] Capability matrix frozen
- [x] Network-free deterministic conformance corpus
- [x] No synthesized customer identity
- [x] Ambiguous monetary transport maps to `execution_unknown`
- [x] Unsupported operations fail locally
- [x] Checked-in provider fixture evidence remains fixture-only
- [x] Current AkadPay PIX-IN/PIX-OUT public material partially captured
- [x] Current AkadPay PIX-OUT idempotency/replay identifiers partially captured
- [x] Current FlevoPay Basic `PUBLIC_KEY:SECRET_KEY` authentication evidence captured
- [x] FlevoPay authentication drift from retained historical adapter identified
- [ ] Provider-owned AkkadPag → AkadPay lineage/equivalence established
- [ ] Current AkadPay query/recovery contract complete
- [ ] Current AkadPay webhook cryptographic authentication contract complete
- [ ] Current FlevoPay exact create/query/recovery/idempotency/webhook contract complete
- [ ] Live AkkadPag/AkadPay contract authority
- [ ] Live FlevoPay contract authority

## Dashboard authorization and operations — A6-A9 + A16 + A21

- [x] Supabase dashboard session verification
- [x] Current-user online verification
- [x] Merchant/environment membership authorization
- [x] Member/admin/owner role context
- [x] Dashboard and machine auth realms remain separate
- [x] Cross-tenant access fails closed
- [x] No service-role/JWT-secret browser authority introduced
- [x] API credential list/get/create/rotate/revoke
- [x] AAL2/step-up requirement for credential mutations
- [x] Transactional active-credential cap
- [x] Dashboard transaction list/detail
- [x] Status/externalId/RFC3339 filters
- [x] Bounded keyset pagination
- [x] `a9v1.<kid>.<payload>.<signature>` cursor authority
- [x] Exact per-`kid` cursor verification with no trial-all
- [x] Explicit verify-only legacy `a9v0` compatibility
- [x] Customer/private provider data excluded from merchant projection
- [x] Dashboard transaction namespace remains read-only
- [x] Merchant React/Vite web application foundation
- [x] Supabase Auth login/logout/session refresh UX
- [x] Trusted merchant-context discovery
- [x] Merchant and Sandbox/Production context selector
- [x] Transaction list and detail UI
- [x] Explicit loading/empty/error/session-expired states
- [x] Browser uses Supabase Auth + SwiftPay API only; no direct private-schema/provider authority
- [x] Hosted context-discovery RPC with API-only EXECUTE authority

## Provider activation authority — A10

- [x] Explicit provider/operation/environment/lineage activation registry
- [x] Default-deny registry
- [x] Exact tuple authorization
- [x] Evidence digest and reviewed-at binding
- [x] `current_contract_proven` alone cannot authorize traffic
- [x] Sandbox traffic requires `sandbox_proven` or stronger
- [x] Production traffic requires `production_enabled`
- [x] Unknown/duplicate/malformed registry fails closed
- [x] Default retained-provider live authority remains zero

## Strict provider HTTP transport — A11

- [x] A10-authorized transport construction
- [x] Destination derived only from authorized grant
- [x] Relative-path confinement
- [x] GET/POST-only transport surface
- [x] Reserved/routing header rejection
- [x] Request size ceilings
- [x] Fresh DNS resolution per request
- [x] Private/reserved/mixed DNS rejection
- [x] Pinned destination IP with original Host/SNI
- [x] TLS certificate validation and TLS 1.2 minimum
- [x] No redirects
- [x] No automatic retry
- [x] Exact timeout boundary
- [x] Response header/body ceilings
- [x] Fatal UTF-8 decoding
- [x] Safe `pre_transmission` vs `transmission_unknown` classification
- [x] Transport remains unbound from A5 adapters by default

## Structured runtime observability — A12 + A13 + A19

- [x] Closed-schema structured JSON logging
- [x] Server-owned UUID request correlation
- [x] Caller request ID cannot become authority
- [x] Matched route template logging instead of raw URL
- [x] Secret/PII/internal error content excluded
- [x] Logger sink failure cannot change domain/HTTP outcome
- [x] API and worker use shared safe logging boundary
- [x] Observability package has no hidden network/database exporter authority
- [x] Dependency-free metrics package
- [x] HTTP request counter and duration histogram
- [x] Readiness outcome metric
- [x] Worker webhook-batch outcome metric
- [x] Frozen low-cardinality labels
- [x] Deterministic OpenMetrics rendering
- [x] Optional workload-specific loopback-only metrics ports
- [x] Metrics failure cannot alter request/domain/worker behavior
- [x] Fastify top-level `disableRequestLogging` deprecation retired through stock `LogController`
- [x] `FSTDEP023` absent from isolated A19 `buildApp()` acceptance
- [ ] External metrics collector/backend
- [ ] Operational dashboards
- [ ] Alert rules and SLO policy
- [ ] Distributed tracing if justified

## Trusted ingress and abuse limiting — A14 + A18

Current hosted evidence:

- A14: `docs/evidence/application/2026-08-18-a14-ingress-abuse-rate-limit-hardening.md`
- A18: `docs/evidence/application/2026-08-19-a18-abuse-subject-hmac-key-rotation.md`

- [x] Exact trusted-proxy allowlist; no generic `trustProxy: true`
- [x] Canonical client-IP resolution
- [x] HMAC-SHA256 opaque abuse subjects
- [x] Dedicated abuse HMAC authority
- [x] Distributed PostgreSQL fixed-window quota
- [x] Token-exchange and machine pre-auth network throttles
- [x] Merchant/environment read and mutation quotas
- [x] Dashboard pre-auth and readiness throttles
- [x] Liveness excluded from limiter dependency
- [x] Deterministic 429 + Retry-After
- [x] Limiter unavailable fails closed with sanitized 503
- [x] Concurrency/rollover/isolation behavior tested
- [x] Bounded stale-window pruning
- [x] API-only quota RPC authority
- [x] One active + at most one previous abuse HMAC continuity key
- [x] One atomic DB decision across active/previous pseudonyms
- [x] Legacy A14 two-argument RPC compatibility through defaulted A18 third argument
- [x] Reversed alias concurrency acceptance
- [x] Mixed A14/A18 replica-call concurrency acceptance
- [x] Canonical active/previous alias insert ordering prevents reversed-rotation deadlock before row locking
- [x] Hosted A18 migration applied
- [x] Hosted API/worker `app` EXECUTE counts are exactly 25/6 after the A21 read-only context-discovery addition
- [x] Hosted Security Advisor remains 0 lints
- [x] Hosted smoke rollback leaves no limiter/payment/provider-attempt fixture state

## Existing foundations not yet full product workflows

- [x] KYC private-storage foundation
- [x] Audit-event foundation
- [x] Payout/refund state foundations
- [x] Financial reservation foundations
- [x] Payout attempt claim/resolution foundations
- [x] Refund resolution foundations
- [x] Internal reconciliation foundations
- [x] Reconciliation operations foundations
- [x] Provider reconciliation evidence foundations
- [ ] KYC merchant/admin UX and review workflow production-ready
- [ ] Payout merchant/admin operational API/UX production-ready
- [ ] Refund merchant/admin operational API/UX production-ready
- [ ] Live provider-driven reconciliation loop production-ready

## Critical path to real Pix money movement

- [ ] Accepted current provider-owned technical contract for AkkadPag/AkadPay lineage
- [ ] Accepted current provider-owned technical contract for FlevoPay lineage
- [ ] Exact current authentication semantics proven for selected executable contract
- [ ] Exact current create/query/recovery semantics proven
- [ ] Exact current provider idempotency semantics proven for monetary create paths
- [ ] Exact current webhook/authentication semantics proven
- [ ] Authenticated current PSP sandbox acceptance
- [ ] Applicable A10 tuples promoted to `sandbox_proven`
- [ ] Separately specified A5 → A11 runtime bridge
- [ ] Provider webhook ingress/authentication and replay protection
- [ ] Ambiguous-execution recovery
- [ ] Provider reconciliation against authoritative PSP state
- [ ] Controlled production activation acceptance
- [ ] Applicable A10 tuples promoted deliberately to `production_enabled`
- [ ] Production monetary smoke/canary and rollback proof

## Production operations and hardening backlog

- [x] A14 distributed ingress/rate-limit protocol
- [x] A15 access-token signing-key rotation
- [x] A16 dashboard cursor HMAC rotation
- [x] A17 legacy webhook AES retirement
- [x] A18 abuse-subject HMAC rotation protocol
- [x] A19 Fastify request-logging compatibility migration
- [ ] External metrics collection/export
- [ ] Production dashboards and alerting
- [ ] SLI/SLO policy
- [ ] Provider/reconciliation divergence alerts
- [ ] Load and capacity testing
- [ ] A14 limit tuning from measured traffic
- [ ] Secret/key rotation runbooks and drills
- [ ] Dependency/security final review
- [ ] Least-privilege final review
- [ ] Operational audit review
- [ ] Backup/restore drill
- [ ] Disaster-recovery drill
- [ ] Deployment runbook
- [ ] Rollback runbook
- [ ] Incident-response/on-call runbook
- [ ] Production network/WAF hardening

## Product/merchant experience backlog

- [ ] Merchant/admin KYC experience
- [ ] Payout operations experience
- [ ] Refund operations experience
- [x] Dashboard login/session UX and Supabase Auth browser integration
- [ ] Dashboard API credential administration UI
- [ ] Dashboard webhook endpoint administration UI
- [ ] Hosted Pix checkout
- [ ] Payment Links
- [ ] Broader reporting/analytics
- [ ] Settlement/payout merchant experience
- [ ] Broader administration/operations UI

## Non-negotiable safety gates

- [x] `main` remains untouched while reconstruction PR is draft
- [x] A5 retained providers remain fixture-only by default
- [x] A10 default live provider authority is zero
- [x] A11 existence alone grants no PSP authority
- [x] Ambiguous monetary execution is never fabricated into definitive failure
- [ ] No live retained-provider call until current-contract + authenticated sandbox + activation gates are satisfied
