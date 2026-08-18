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

## Foundation and runtime

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

## Machine/API authentication — A1

- [x] `client_credentials` token exchange
- [x] Opaque Public Key + Secret Key credential model
- [x] `scrypt-v1` secret verification
- [x] No plaintext API secret persistence
- [x] HS256 Bearer access tokens
- [x] Exact 900-second token lifetime
- [x] Database-backed bearer revalidation
- [x] Credential revocation and secret-version drift rejection
- [x] Merchant lifecycle enforcement
- [x] Exact-IP allowlist support
- [x] Canonical IPv4/IPv6 handling
- [x] Successful issuance quota: 10/hour after valid credential/secret/IP
- [x] Invalid credential responses remain indistinguishable

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

## Merchant webhook delivery — A4

- [x] Merchant webhook delivery persistence
- [x] Worker-only delivery claim/resolve boundary
- [x] HMAC signing
- [x] Canonical payload serialization
- [x] Endpoint SSRF policy
- [x] Public HTTPS-only endpoint enforcement
- [x] DNS/public-address validation and pinning
- [x] Redirect-safe delivery
- [x] Retry classification and bounded retry schedule
- [x] Retry-After handling where contracted
- [x] Fenced worker lease behavior
- [x] Terminal failure behavior
- [x] Network/timeout ambiguity handled without unsafe retry loops

## Retained PSP conformance — A5

Current public-evidence refresh: `docs/evidence/providers/2026-08-18-current-provider-contract-critical-path-refresh.md`.

- [x] Retained AkkadPag legacy-lineage fixture adapter
- [x] Retained FlevoPay legacy-lineage fixture adapter
- [x] Capability matrix frozen
- [x] Network-free conformance corpus
- [x] No synthesized customer identity
- [x] Ambiguous monetary transport maps to `execution_unknown`
- [x] Unsupported operations fail locally
- [x] All checked-in provider fixture evidence marked fixture-only
- [x] Current AkadPay provider-owned PIX-IN create endpoint/schema captured
- [x] Current AkadPay provider-owned PIX-OUT create + same-key/same-data idempotency semantics captured
- [x] Current AkadPay PIX-OUT webhook replay identifiers captured
- [x] Current FlevoPay provider-owned base API host/capability surface captured
- [x] Current FlevoPay Basic `PUBLIC_KEY:SECRET_KEY` auth evidence captured
- [x] FlevoPay current auth drift from retained historical `X-API-Key` adapter explicitly identified
- [ ] Provider-owned AkkadPag → AkadPay lineage/equivalence established
- [ ] Current AkadPay query/recovery contract complete
- [ ] Current AkadPay webhook cryptographic authentication contract complete
- [ ] Current FlevoPay exact endpoint/request/response contract complete
- [ ] Current FlevoPay idempotency/recovery/webhook contract complete
- [ ] Live AkkadPag/AkadPay contract authority
- [ ] Live FlevoPay contract authority

## Dashboard authorization — A6

- [x] Supabase dashboard session verification
- [x] Current-user online verification
- [x] K4 merchant/environment membership authorization
- [x] Member/admin/owner role context
- [x] Dashboard and machine auth realms remain separate
- [x] Cross-tenant access fails closed
- [x] No service-role/JWT-secret browser authority introduced

## Dashboard webhook endpoint management — A7

- [x] List webhook endpoints
- [x] Get webhook endpoint
- [x] Create webhook endpoint
- [x] Update webhook endpoint
- [x] Disable webhook endpoint
- [x] Enable webhook endpoint
- [x] Rotate signing secret
- [x] Dashboard-only administration namespace
- [x] Idempotent mutation fencing
- [x] CSPRNG signing-secret generation
- [x] RSA-OAEP-SHA256 secret wrapping
- [x] Delivery compatibility across secret rotation
- [x] Plaintext secret disclosure restricted to winning creation/rotation result

## Dashboard API credential management — A8

- [x] List API credentials
- [x] Get API credential
- [x] Create API credential
- [x] Rotate API credential secret
- [x] Revoke API credential
- [x] Environment-specific key prefixes
- [x] Privileged dashboard verifier
- [x] AAL2/step-up requirement for sensitive mutations
- [x] Transactional active-credential limit
- [x] Idempotent create/rotate/revoke
- [x] Generated plaintext secrets excluded from audit/idempotency persistence
- [x] Reads use ordinary dashboard authorization; mutations use privileged authorization

## Dashboard transaction operations — A9

- [x] Transaction list
- [x] Transaction detail
- [x] Status filter
- [x] Exact `externalId` filter
- [x] RFC3339 time filters
- [x] Bounded page limit
- [x] Keyset pagination
- [x] HMAC-authenticated cursor
- [x] Cursor bound to merchant/environment/filters
- [x] No offset pagination
- [x] Customer/private provider data excluded from merchant projection
- [x] Dashboard transaction namespace remains read-only

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
- [x] TLS certificate validation
- [x] TLS 1.2 minimum
- [x] No redirects
- [x] No automatic retry
- [x] Exact timeout boundary
- [x] Response header/body ceilings
- [x] Fatal UTF-8 decoding
- [x] Safe `pre_transmission` vs `transmission_unknown` classification
- [x] Transport remains unbound from A5 adapters by default

## Structured runtime observability — A12

- [x] Closed-schema structured JSON logging
- [x] Server-owned UUID request correlation
- [x] Caller request ID cannot become authority
- [x] Matched route template logging instead of raw URL
- [x] Secret/PII/internal error content excluded
- [x] Logger sink failure cannot change domain/HTTP outcome
- [x] API and worker use shared safe logging boundary
- [x] Observability package has no hidden network/database exporter authority

## Operational metrics — A13

- [x] Dependency-free metrics package
- [x] HTTP request counter
- [x] HTTP duration histogram
- [x] Readiness outcome metric
- [x] Worker webhook-batch outcome metric
- [x] Frozen low-cardinality labels
- [x] Dynamic IDs/amounts/secrets/raw URLs/SQL/errors/provider payloads excluded
- [x] Deterministic OpenMetrics rendering
- [x] Optional workload-specific metrics ports
- [x] Loopback-only scrape listener
- [x] Metrics failure cannot alter request/domain/worker behavior
- [ ] External metrics collector/backend
- [ ] Operational dashboards
- [ ] Alert rules and SLO policy
- [ ] Distributed tracing

## Trusted ingress and abuse limiting — A14

Current state: **DONE / GREEN / HOSTED**. Final evidence: `docs/evidence/application/2026-08-18-a14-ingress-abuse-rate-limit-hardening.md`.

- [x] Problem Analysis
- [x] Specification frozen
- [x] Contract frozen
- [x] Fail-first RED proof
- [x] `@swiftpay/abuse` package
- [x] Exact trusted-proxy allowlist; no generic `trustProxy: true`
- [x] Canonical client-IP resolution
- [x] HMAC-SHA256 opaque abuse subjects
- [x] Dedicated abuse HMAC authority
- [x] Distributed PostgreSQL fixed-window quota
- [x] Token exchange pre-auth network throttle
- [x] Machine pre-auth network throttle
- [x] Merchant/environment read quota
- [x] Merchant/environment mutation quota
- [x] Dashboard pre-auth network throttle
- [x] Readiness network throttle
- [x] Liveness excluded from limiter dependency
- [x] Deterministic 429 + Retry-After
- [x] Limiter unavailable fails closed with sanitized 503
- [x] Concurrency/rollover/isolation behavior tested
- [x] Opportunistic bounded stale-window pruning
- [x] API-only quota RPC authority
- [x] Final-head application workflow `32103726491`: **306/306** contracts GREEN
- [x] Final-head real-database K7/A1-A9/A14 acceptance GREEN
- [x] Final-head database workflow `32103726496`: **41 files / 1298 assertions**, K5/K6 GREEN
- [x] Evidence-head application workflow `32104297491`: **306/306** + K7/A1-A9/A14 GREEN
- [x] Evidence-head database workflow `32104297387`: **41 files / 1298 assertions** + K5/K6 GREEN
- [x] Legacy API allowlist tests synchronized from 23 to 24 RPCs
- [x] K7 wrong-runtime readiness acceptance synchronized with A14 fail-closed admission
- [x] Hosted migration `20260818054252_ingress_abuse_rate_limit_hardening` applied to canonical `swiftpay v2`
- [x] Hosted API EXECUTE allowlist verified at exactly 24; worker exactly 6
- [x] Hosted public/Data API/service-role/worker A14 function authority denied
- [x] Hosted runtime roles have zero direct A14 table DML/SELECT authority
- [x] Hosted Security Advisor: 0 lints
- [x] Hosted Payment/ProviderAttempt rows remain zero after A14 deploy
- [x] Final A14 evidence committed

## Machine access-token signing-key rotation — A15

Current state: **TDD_RED / IMPLEMENTATION AUTHORIZED**. RED evidence: `docs/evidence/application/2026-08-18-a15-machine-access-token-signing-key-rotation-red.md`.

- [x] Problem Analysis frozen
- [x] Specification frozen
- [x] Contract frozen
- [x] Fail-first tests committed
- [x] CLEAN RED Application run `32107998211`: 322 total, **307 pass / 15 fail**, with all 306 pre-A15 contracts GREEN
- [x] K7/A1-A9/A14 real-database regression acceptance GREEN on RED head
- [x] Database run `32107998170`: K5/K6 + **41 files / 1298 assertions** GREEN
- [ ] Validated branded signing authority implemented
- [ ] Required active `kid` + bounded 1..4 keyring config implemented
- [ ] New tokens emit exact HS256 + active `kid`
- [ ] Known `kid` verifies using exactly one selected key
- [ ] Unknown/malformed `kid` fails closed without fallback/trial-all
- [ ] Explicit verify-only legacy no-`kid` migration slot implemented
- [ ] No-`kid` tokens fail after legacy slot removal
- [ ] HS256/issuer/audience/900s/zero-tolerance/A1 claims preserved
- [ ] A1 database bearer revalidation and A8 revocation semantics preserved
- [ ] Old single-key runtime variable has no implicit fallback
- [ ] Final 322/322 application contracts GREEN
- [ ] Final K7/A1-A9/A14 real-database acceptance GREEN
- [ ] Final K5/K6/41 files/1298 assertions GREEN
- [ ] Final A15 evidence committed

A15 intentionally excludes A9 cursor HMAC rotation, A14 abuse HMAC rotation, webhook cryptographic authorities, API credential secrets and provider credentials.

## Existing domain/database foundations not yet full product workflows

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

These items are the primary production blocker and must remain ahead of optional product expansion.

- [ ] Accepted current provider-owned technical contract for AkkadPag/AkadPay lineage
- [ ] Accepted current provider-owned technical contract for FlevoPay lineage
- [ ] Exact current authentication semantics proven for the selected executable contract
- [ ] Exact current create/query/recovery semantics proven
- [ ] Exact current provider idempotency semantics proven for all monetary create paths
- [ ] Exact current webhook/authentication semantics proven
- [ ] Authenticated current PSP sandbox acceptance
- [ ] Applicable A10 tuples promoted to `sandbox_proven`
- [ ] Separately specified A5 → A11 runtime bridge
- [ ] Provider webhook ingress/authentication
- [ ] Provider webhook replay protection
- [ ] Ambiguous-execution recovery
- [ ] Provider reconciliation against authoritative PSP state
- [ ] Controlled production activation acceptance
- [ ] Applicable A10 tuples promoted deliberately to `production_enabled`
- [ ] Production monetary smoke/canary and rollback proof

## Production operations and hardening backlog

- [ ] External metrics collection/export
- [ ] Production dashboards and alerting
- [ ] SLI/SLO policy
- [ ] Provider/reconciliation divergence alerts
- [ ] Load and capacity testing
- [ ] A14 limit tuning from measured traffic
- [ ] Secret/key rotation runbooks and drills
- [ ] Dependency/security final review
- [ ] Least-privilege final review
- [ ] Backup/restore drill
- [ ] Disaster-recovery drill
- [ ] Deployment runbook
- [ ] Rollback runbook
- [ ] Incident-response/on-call runbook
- [ ] Production network/WAF hardening
- [ ] Fastify request-logging deprecation migration before Fastify 6

## Product/merchant experience backlog

- [ ] Merchant/admin KYC experience
- [ ] Payout operations experience
- [ ] Refund operations experience
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
