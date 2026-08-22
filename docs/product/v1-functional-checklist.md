# SwiftPay V2 — V1 Functional Checklist

Updated: 2026-08-21 (America/Santarem)

A checked item means an accepted executable/hosted contract exists for that scope. It does **not** mean the equivalent Production/live-provider workflow is authorized. Provider fixtures and transport primitives grant no PSP monetary authority.

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
- [x] Separate API/worker runtime identities
- [x] Deterministic local Sandbox fixtures
- [x] Executable API/worker runtime bootstrap
- [x] Exact runtime capability manifest/attestation
- [x] Hosted capability baseline after A23/A24: **30 API / 6 worker**
- [x] Data API effective `app` EXECUTE: **0** at latest hosted attestation
- [x] Direct trusted-runtime protected-table authority remains capability/RPC-scoped
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

### Sandbox

- [x] Private fixed-amount `payment_links` resource
- [x] Merchant Payment Links management capability
- [x] Anonymous same-origin checkout lookup
- [x] Anonymous Sandbox Pix preparation through trusted API capability
- [x] Dedicated `checkout_request_pre_auth` abuse quota
- [x] A24 persisted quota-CHECK repair hosted
- [x] Separate checkout SPA, visibly Sandbox/non-payable outside emulator
- [x] Hosted DB migrations applied
- [x] Hosted quota smoke: allowed=true / remaining=119 / rollback clean
- [ ] Controlled positive hosted E2E using intended API runtime identity + merchant/emulator fixture

### Production

- [ ] Production hosted Pix checkout
- [ ] Production Payment Links
- [ ] Real payable QR/copy-and-paste via activated retained PSP
- [ ] Provider-backed checkout recovery/reconciliation

Production items stay blocked until retained-provider evidence and A10 activation gates close.

## Provider conformance / activation

- [x] Retained provider fixture adapters
- [x] Unsupported operations fail locally
- [x] Ambiguous monetary transport maps to `execution_unknown`
- [x] Provider activation registry default-deny
- [x] Strict outbound HTTPS transport primitive
- [x] A5 adapters remain unbound from A11
- [x] Repository defaults authorize zero retained-provider operations
- [ ] Provider-owned current AkkadPag/AkadPay lineage/contract evidence
- [ ] Provider-owned current FlevoPay executable contract evidence
- [ ] Authenticated current provider Sandbox proof
- [ ] A5→A11 provider bridge
- [ ] Live provider activation
- [ ] Provider webhook authentication/ingress
- [ ] Provider recovery/reconciliation runtime

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
- [x] Latest database suite: **46 files / 1382 pgTAP assertions PASS**
- [ ] Production-like load/capacity test
- [ ] Measured rate-limit tuning
- [ ] Measured database/index optimization
- [ ] Backup/restore validation
- [ ] Disaster-recovery exercise

## Deployment / launch

- [x] Canonical reconstruction consolidated into `main`
- [x] Canonical hosted Supabase project established
- [x] A23/A24 hosted database migrations applied
- [ ] Production API deployment contract
- [ ] Production worker deployment contract
- [ ] Dashboard/checkout deployment contract for V2 runtime
- [ ] Environment/secrets bootstrap contract
- [ ] Smoke-test contract
- [ ] Cutover plan
- [ ] Rollback/forward-fix policy
- [ ] Incident runbook
- [ ] Backup/restore runbook
- [ ] Production launch sign-off

## Current blockers / next closure

1. **Controlled positive hosted Sandbox E2E** — internal and actionable.
2. **Current retained-PSP contract + authenticated Sandbox evidence** — external critical blocker.
3. **Provider bridge/activation/recovery/webhook** — blocked until #2 closes.
4. **Launch operations** — deploy/cutover/backup/rollback/load/WAF/alerts.
5. **Merchant completeness** — KYC, payout/refund and reporting.

## Safety invariants

- No live retained PSP monetary call without current-contract + authenticated-Sandbox + explicit A10 activation proof.
- Ambiguous monetary execution stays `execution_unknown`; never fabricate definitive failure.
- Browser/dashboard receives no direct database/provider/financial authority.
- Integration secrets remain one-time and non-persistent in browser state.
- A24 changed only the persisted abuse-policy CHECK vocabulary; quota limits and provider/financial authority are unchanged.
