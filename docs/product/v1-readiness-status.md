# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-16

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` is the detailed engineering ledger. Percentages are planning estimates weighted by engineering effort, integration risk and unresolved operational surface; they are not raw file/TODO counts.

## Executive status

SwiftPay V2 now has an executable trusted API/worker runtime and a complete deterministic sandbox Pix lifecycle through merchant delivery:

1. exchange API credentials for a 900-second Bearer token;
2. create a sandbox Pix Payment through `POST /v1/transactions`;
3. rely on database-backed idempotency across independent API processes;
4. receive deterministic emulator Pix data;
5. query the Payment through `GET /v1/transactions/:id`;
6. apply trusted worker-side paid evidence exactly once;
7. post one balanced `settlement_paid` ledger transaction;
8. query merchant funds through authenticated `GET /v1/balance`;
9. create the canonical `payment.paid` webhook event transactionally;
10. claim, sign, deliver, retry and terminally record merchant HTTP webhook delivery with lease fencing and no financial authority.

A4 closes the missing asynchronous sandbox leg. The critical risk has therefore moved to **provider conformance/live-provider recovery, merchant operational surfaces and production hardening**.

Current conservative estimate:

- **Core architecture/domain/database/platform foundation:** ~99% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~88% complete.
- **Production-capable Pix V1:** ~49% complete.
- **Weighted V1 engineering completion:** ~64% complete.
- **Broader SwiftPay product vision** including hosted checkout, payment links, richer merchant/admin surfaces, broader payout automation and integrations: ~32–37% complete.

The sandbox percentage is not 100% because merchants still lack first-class webhook endpoint management and broader operational surfaces; production readiness remains materially lower because no live PSP has crossed the conformance gate yet.

## Materially complete

### Product / architecture / reconstruction contracts

The repository remains the canonical implementation source and carries PRD, architecture, ADRs, domain/public/provider/ledger/webhook contracts, specs, migrations, tests and evidence.

Target architecture remains a Pix-first TypeScript modular monolith with Fastify trusted API, separate trusted worker, Supabase/PostgreSQL canonical state, provider-agnostic Payment Core, append-oriented financial/audit semantics, durable jobs/webhooks and AkkadPag/FlevoPay retained as initial provider targets behind conformance gates.

### Database / financial foundation

Strongly tested foundations exist for merchant/KYC/provider identity, API credentials, idempotency/provider evidence, Payment/ProviderAttempt, double-entry ledger, durable jobs, merchant webhook persistence/runtime, payout/refund foundations, financial reservations, reconciliation, private KYC storage, append-only audit events, dashboard authorization and trusted runtime roles.

Current canonical database lane after A4:

- **37 pgTAP files / 1272 assertions / PASS**;
- K5 deterministic sandbox fixture lane: PASS;
- K6 runtime-topology / least-privilege lane: PASS.

### K5 / K6 / K7 — trusted executable platform — DONE

The canonical seed remains non-financial. API and worker use separate capability identities. Node.js 24/Fastify API and worker runtimes execute against real production-like database roles in acceptance.

Evidence:

- `docs/evidence/supabase/2026-08-15-k5-local-sandbox-seed-fixtures.md`
- `docs/evidence/supabase/2026-08-15-k6-trusted-runtime-deployment-topology.md`
- `docs/evidence/application/2026-08-15-k7-executable-runtime-bootstrap.md`

### A1 — API credential token authentication — DONE

Accepted boundary includes `POST /v1/auth/token`, canonical `scrypt-v1` verification, 900-second HS256 tokens, exact-IP allowlists, PostgreSQL-atomic issuance quota, current DB Bearer revalidation and immediate invalidation after credential revoke/version rotation.

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

### A2 — authenticated Pix create/get + deterministic emulator — DONE

Accepted behavior includes authenticated create/get, strict ownership/request validation, required idempotency, durable Payment/ProviderAttempt before execution, atomic attempt claim, deterministic visibly non-payable emulator output and safe replay/conflict/unknown/rejection semantics.

Canonical hosted migrations:

- `20260815101512_pix_create_get_emulator_foundation.sql`
- `20260815101609_pix_create_get_emulator_behavior.sql`
- `20260815101641_pix_create_get_emulator_prepare_key_count_fix.sql`
- `20260815101729_pix_create_get_emulator_resolve_coalesce_fix.sql`

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

### A3 — paid transition + ledger + merchant balance — DONE

A3 closes the canonical money-state path: worker-only paid evidence, serialized/replay-safe ProviderEvent application, one `settlement_paid` double-entry posting, pending-liability merchant credit, authenticated `GET /v1/balance`, merchant-safe paid Payment projection and transactional `payment.paid` outbox creation.

Canonical hosted migrations:

- `20260816004515_paid_transition_ledger_balance_foundation.sql`
- `20260816004620_paid_transition_ledger_balance_behavior.sql`

Evidence: `docs/evidence/application/2026-08-15-a3-paid-transition-ledger-balance.md`.

### A4 — merchant webhook delivery runtime — DONE

A4 consumes the durable outbox without weakening financial authority:

- composed Job + WebhookDelivery lease/fencing capability;
- exact worker-only RPC boundary;
- AES-256-GCM signing-secret isolation and version snapshot/rotation handling;
- deterministic canonical JSON + HMAC-SHA256 webhook signature;
- strict HTTPS/DNS/IP/redirect policy and pinned TLS destination;
- one 5-second transport attempt with no hidden retry;
- deterministic retry/backoff/Retry-After policy and eight-attempt ceiling;
- success/retry/terminal/disabled durable state transitions;
- concurrency, retry, disabled-after-fanout and stale-fence real runtime acceptance;
- explicit financial-table invariance and secret-log leakage checks.

Canonical hosted migrations:

- `20260816034121_merchant_webhook_delivery_runtime_foundation.sql`
- `20260816034224_merchant_webhook_delivery_runtime_behavior.sql`

Hosted verification confirms only `swiftpay_worker` can execute the two new privileged routines, the worker function allowlist is exactly six capabilities and Supabase Security Advisor returns zero lints.

Accepted/post-sync CI:

- Application workflow `31924944437`: GREEN, **128/128 application contracts** plus K7/A1/A2/A3/A4 runtime acceptance;
- Database workflow `31924944433`: GREEN, **37 files / 1272 pgTAP assertions**, K5 and K6.

Evidence: `docs/evidence/application/2026-08-16-a4-merchant-webhook-delivery-runtime.md`.

## Weighted V1 workstream estimate

| Workstream | Weight | Estimated completion | Weighted contribution |
|---|---:|---:|---:|
| Product contracts / architecture / reverse engineering | 10% | 97% | 9.7% |
| Database + financial core | 20% | 99% | 19.8% |
| Supabase security/platform foundation | 10% | 99% | 9.9% |
| Trusted backend + public API runtime | 15% | 80% | 12.0% |
| Pix provider integrations + recovery | 15% | 30% | 4.5% |
| Worker + merchant webhook HTTP runtime | 10% | 78% | 7.8% |
| Merchant/admin UI | 10% | 5% | 0.5% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0.0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment / observability / cutover | 2% | 15% | 0.3% |
| **Total** | **100%** |  | **~65% raw weighted / ~64% conservative checkpoint** |

The conservative checkpoint intentionally discounts the raw weighted sum for external-provider uncertainty. A deterministic emulator and robust merchant delivery do not substitute for live PSP conformance.

## Critical path

```text
K5 deterministic sandbox fixture                 DONE
  -> K6 trusted runtime topology                 DONE
  -> K7 executable API/worker runtime            DONE
  -> A1 API credential token authentication      DONE
  -> A2 authenticated Pix create/get + emulator  DONE
  -> A3 paid transition + ledger + balance       DONE
  -> A4 merchant webhook delivery runtime        DONE
  -> A5 provider conformance fixtures            NEXT
  -> AkkadPag/FlevoPay live adapters
  -> provider webhook ingress/recovery
  -> merchant/admin operational surfaces
  -> production hardening / observability / cutover
```

## Next slice: A5 provider conformance fixtures

A5 must remain fixture-first and network-free. It should prove the retained providers against `docs/contracts/native-pix-provider-adapter.md` before any monetary POST can reach a live PSP.

Minimum boundary to freeze before implementation:

1. source-of-truth evidence and confidence level for AkkadPag/FlevoPay request/response/webhook contracts;
2. authentication and credential placement without committing real secrets;
3. exact amount-unit conversion and customer requirements;
4. stable client-reference/idempotency semantics;
5. Pix create success/rejection/ambiguous transport mapping;
6. query/recovery support after `execution_unknown`;
7. provider payment/TxId/event identity uniqueness scope;
8. webhook authentication/replay semantics;
9. canonical status/error taxonomy mapping;
10. deterministic sanitized fixtures and adapter conformance tests;
11. explicit capability matrix — unsupported operations remain disabled;
12. no live network calls in conformance CI.

A5 implementation may not begin until Problem Analysis, frozen YAML specification and RED conformance contracts are versioned.

## What still blocks a complete sandbox product

The core lifecycle now exists, but product usability still needs:

- merchant-facing webhook endpoint create/update/disable/secret-rotation/test/replay controls;
- merchant transaction operational UI;
- API credential management UI/API;
- broader admin/KYC operational surfaces.

These no longer block correctness of the deterministic sandbox money + webhook chain itself.

## What still blocks production-capable Pix V1

Production readiness requires:

- A5 provider contract/conformance fixtures;
- live AkkadPag/FlevoPay adapters behind the stable provider abstraction;
- live provider webhook verification/replay handling;
- timeout/retry/`execution_unknown` recovery policy proven against real PSP behavior;
- provider credential/secret management and rotation operations;
- merchant/admin operational UI;
- observability, alerting, SLOs and runbooks;
- deployment/cutover/rollback evidence;
- final security/operational acceptance of the complete money-moving path.

## Current truth in one sentence

**SwiftPay V2 now has an authenticated, idempotent deterministic sandbox Pix flow through exactly-once paid accounting and signed/retried merchant webhook delivery; weighted V1 engineering is conservatively ~64%, the sandbox MVP is ~88%, and provider conformance is the next critical gate before any live PSP integration.**
