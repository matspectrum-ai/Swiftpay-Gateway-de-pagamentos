# SwiftPay V2 — V1 Functional Checklist

Updated: 2026-09-03 (America/Santarem)

A checked item means an accepted executable/hosted contract exists for that scope. It does **not** mean the equivalent Production/live-provider workflow is authorized. Provider fixtures, credentials and transport primitives grant no PSP monetary authority by themselves.

## Core database / financial domain

- [x] Merchant/environment/domain foundations
- [x] API credential persistence and token-auth state
- [x] Payment idempotency
- [x] ProviderAttempt / provider-event foundations
- [x] Double-entry ledger foundation
- [x] Merchant balance projection
- [x] Durable jobs
- [x] Merchant webhook persistence/delivery state
- [x] Payout/refund database foundations
- [x] Financial reservations
- [x] Internal/provider reconciliation foundations
- [ ] Merchant-usable payout API/UI
- [ ] Merchant-usable refund API/UI

## Supabase / trusted runtime security

- [x] Private `app` schema / Data API boundary
- [x] Append-only audit foundation
- [x] Dashboard membership authorization
- [x] Separate API/worker runtime capability groups
- [x] Deterministic local Sandbox fixtures
- [x] Shared credentialless runtime LOGIN bootstrap outside migration history
- [x] Local K6 reuses shared bootstrap while keeping synthetic loopback-only credentials
- [x] Hosted `swiftpay_api_runtime` / `swiftpay_worker_runtime` LOGIN topology
- [x] Exact runtime capability manifest/attestation
- [x] Hosted capability baseline after A25/A26/A27: **30 API / 6 worker**
- [x] Data API effective `app` EXECUTE: **0**
- [x] Direct runtime `app` ACL entries: **0**
- [x] PostgreSQL 17 creator-admin semantics frozen as `ADMIN TRUE, SET FALSE, INHERIT FALSE`
- [ ] Hosted server-side runtime LOGIN password/bootstrap/rotation contract
- [ ] `main` branch protection with required Application/Database checks

## Machine authentication

- [x] Client credential token exchange
- [x] Secret verifier without plaintext persistence
- [x] Exact IP policy
- [x] Token issuance quota
- [x] 900-second machine token
- [x] Online database revalidation
- [x] Signing-key rotation / `kid`

## Deterministic Pix Sandbox path

- [x] Authenticated create Pix transaction
- [x] Get Pix transaction
- [x] Idempotency conflict/replay semantics
- [x] Deterministic emulator
- [x] `execution_unknown` ambiguity preservation
- [x] Paid transition
- [x] Ledger/balance update
- [x] Merchant `payment.paid` webhook delivery
- [x] Production machine Pix create remains fail-closed without provider authority

## Merchant dashboard

- [x] Supabase Auth login/session refresh/logout
- [x] Merchant/environment context discovery
- [x] Transaction list/detail
- [x] API credential list/create/rotate/revoke
- [x] Webhook endpoint list/create/disable/enable/update/rotate
- [x] One-time credential/webhook secret reveal
- [x] Server-authoritative role/AAL2 enforcement
- [ ] KYC/compliance operations UI
- [ ] Reporting/analytics UI
- [ ] Payout/refund operations UI

## Hosted checkout / Payment Links

### Sandbox database/runtime layer

- [x] Private fixed-amount `payment_links` resource
- [x] Merchant Payment Links management capability
- [x] Anonymous same-origin checkout lookup
- [x] Anonymous Sandbox Pix preparation through trusted API capability
- [x] Dedicated `checkout_request_pre_auth` abuse quota
- [x] A24 persisted quota-CHECK repair hosted
- [x] Separate checkout SPA, visibly Sandbox/non-payable outside emulator
- [x] Hosted DB migrations applied
- [x] A26 JSONB object-arity PostgreSQL runtime repair hosted
- [x] A27 `COALESCE` special-form PostgreSQL runtime repair hosted
- [x] Controlled positive hosted DB E2E using exact `swiftpay_api_runtime`
- [x] Payment Link create/replay and hash-conflict invariants
- [x] Production Payment Link create fail-closed
- [x] Cross-tenant dashboard denial
- [x] Public projection does not leak internal identifiers
- [x] Checkout prepare/replay/conflict invariants
- [x] ProviderAttempt single-winner claim
- [x] Sandbox resolver success to `pending`
- [x] Explicit rollback returns fixture/business state to zero
- [x] Hosted DB E2E performs zero retained-provider I/O, paid transitions and ledger postings

### Sandbox deployed HTTP/browser layer

- [ ] Actual V2 API compute deployed against canonical hosted DB
- [ ] Server-side runtime DB credential injected without browser exposure
- [ ] Fastify HTTP/CORS/TLS/readiness verified on deployed compute
- [ ] Browser Payment Link → checkout → Sandbox Pix E2E
- [ ] HTTP idempotent replay and tenant/security acceptance

### Production

- [ ] Production hosted Pix checkout
- [ ] Production Payment Links
- [ ] Real payable QR/copy-and-paste via activated retained PSP
- [ ] Provider-backed checkout recovery/reconciliation

## Provider conformance / activation

### Existing retained-provider safety

- [x] Retained provider fixture adapters
- [x] Unsupported operations fail locally
- [x] Ambiguous monetary transport maps to `execution_unknown`
- [x] Provider activation registry default-deny
- [x] Strict outbound HTTPS transport primitive
- [x] A5 adapters remain unbound from A11
- [x] Repository defaults authorize zero retained-provider operations

### MagicPay A28 partial contract

- [x] A28 PR #8 canonicalized into `main` as `9f612c5a7592f1b05064e2e4238cc9f60699adf5`
- [x] Final A28 Application workflow `33809654802` GREEN including runtime-database acceptance
- [x] Provider guide proves base URL `https://api.dashboardmagicpay.com/v1`
- [x] Provider guide proves Basic Auth public-key/secret-key roles
- [x] Provider guide proves integer-centavo amounts
- [x] Provider guide proves Pix create request route and camelCase request vocabulary
- [x] Provider guide proves transaction-query route
- [x] Provider guide proves read-only company/balance routes
- [x] Provider guide proves postback 2xx acknowledgement/retry behavior
- [x] Provider guide proves separate `x-withdraw-key` requirement for withdrawal/anticipation
- [x] A28 internal pure Pix request builder
- [x] A28 read-only company/balance client primitives
- [x] A28 module stays outside public provider barrel
- [x] MagicPay remains absent from A10 activation registry
- [x] MagicPay webhook authority remains false
- [ ] Exact Pix create success response schema
- [ ] Exact Pix QR/copy-and-paste field
- [ ] Exact transaction-query response envelope
- [ ] Provider create idempotency semantics
- [ ] Ambiguous-create recovery semantics
- [ ] Provider error certainty contract
- [ ] Sandbox/homologation environment classification
- [ ] Authenticated non-destructive provider proof from working network path
- [ ] MagicPay webhook authentication/replay identity
- [ ] MagicPay explicit rate-limit evidence
- [ ] Live MagicPay adapter + A11 bridge under fail-first tests
- [ ] Deliberate MagicPay A10 activation transition
- [ ] Provider webhook ingress
- [ ] Provider recovery/reconciliation runtime

`externalRef` is not considered idempotency evidence. Supplied real provider credentials remain out-of-repository input only.

## Abuse / security hardening

- [x] Pre-auth token throttle
- [x] Machine pre/post-auth quotas
- [x] Dashboard network quota
- [x] Readiness quota
- [x] Checkout pre-auth quota
- [x] HMAC-pseudonymized abuse subjects
- [x] Active/previous abuse-HMAC rotation continuity
- [x] Merchant webhook RSA secret wrapping
- [x] Legacy persisted-secret AES retirement
- [x] Dashboard cursor HMAC rotation
- [x] Fastify request-log compatibility
- [x] Server-owned request IDs / safe structured logs
- [ ] Final dependency/supply-chain review
- [ ] Production secrets/key rotation drills
- [ ] Production WAF/network policy

## Observability

- [x] Structured redaction-safe runtime logs
- [x] Request correlation
- [x] Bounded low-cardinality API/worker metrics
- [x] Loopback-only opt-in OpenMetrics scrape
- [ ] External metrics collection/export
- [ ] Operational dashboards
- [ ] Alerts / SLO policy
- [ ] Distributed tracing if justified by measured need

## Performance / reliability

- [x] Deterministic database/runtime contract regression
- [x] Real local PostgreSQL acceptance for K7/A14/A18/A1-A9
- [x] Latest database suite: **48 files / 1403 pgTAP assertions PASS**
- [x] A25+A26+A27 final Application and Database workflows GREEN before canonical merge
- [x] A28 final Application workflow GREEN after documentation/readiness closure
- [ ] Production-like load/capacity test
- [ ] Measured rate-limit tuning
- [ ] Measured database/index optimization
- [ ] Backup/restore validation
- [ ] Disaster-recovery exercise

## Deployment / launch

- [x] A25/A26/A27 PR #5 merged into `main` as `8be66916a14126e8e86f4858b32d56d5866a7c9f`
- [x] A28 PR #8 merged into `main` as `9f612c5a7592f1b05064e2e4238cc9f60699adf5`
- [x] Canonical hosted Supabase project established
- [x] A23/A24/A26/A27 hosted database migrations applied
- [x] A25 hosted credentialless runtime LOGIN bootstrap applied
- [ ] Production API deployment contract
- [ ] Production worker deployment contract
- [ ] Dashboard/checkout deployment contract for V2 runtime
- [ ] Environment/secrets bootstrap + rotation contract
- [ ] Deployed HTTP smoke-test contract
- [ ] Cutover plan
- [ ] Rollback/forward-fix policy
- [ ] Incident runbook
- [ ] Backup/restore runbook
- [ ] Production launch sign-off

## Current blockers / next closure

1. **Deployed HTTP runtime E2E** — actual V2 API/checkout and server-side DB runtime credential.
2. **MagicPay exact response/idempotency/recovery + environment evidence** — provider live-integration gate.
3. **Authenticated safe MagicPay proof** from a network path that resolves the provider host.
4. **Provider bridge/activation/recovery/webhook** — blocked until #2/#3 close.
5. **Launch operations** — deploy/cutover/backup/rollback/load/WAF/alerts.
6. **Merchant completeness** — KYC, payout/refund and reporting.

## Safety invariants

- No live retained PSP monetary call without complete executable contract + authenticated-safe-proof + explicit A10 activation proof.
- No withdrawal is used as a provider-discovery probe.
- No MagicPay Pix create is used as a discovery probe while response/idempotency/recovery semantics remain incomplete.
- Ambiguous monetary execution stays `execution_unknown`; never fabricate definitive failure.
- Browser/dashboard receives no direct database/provider/financial authority.
- Provider secrets never enter Git, durable docs, browser state, screenshots or ordinary logs.
- A25 installs no hosted runtime credential; deployment credential bootstrap/rotation remains a separate gate.
