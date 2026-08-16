# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-16

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` is the detailed engineering ledger. Percentages are effort/risk-weighted planning estimates, not raw file or TODO counts.

## Executive status

SwiftPay V2 now proves two distinct layers:

1. a complete deterministic sandbox Pix lifecycle from machine authentication through merchant webhook delivery; and
2. a network-free, executable provider-conformance boundary for the retained AkkadPag and FlevoPay integrations.

The deterministic lifecycle currently proves:

1. `POST /v1/auth/token` -> 900-second Bearer token;
2. authenticated/idempotent `POST /v1/transactions`;
3. deterministic visibly non-payable Pix emulator output;
4. authenticated `GET /v1/transactions/:id`;
5. trusted worker-side paid evidence with replay/concurrency absorption;
6. exactly one `settlement_paid` double-entry ledger posting;
7. authenticated `GET /v1/balance`;
8. transactional canonical `payment.paid` webhook outbox event;
9. fenced, signed, retryable merchant HTTP webhook delivery.

A5 additionally proves that provider-specific request mapping, capability rejection, status normalization and monetary uncertainty can live behind a narrow adapter boundary **without any live PSP network transport**.

Current conservative estimate:

- **Core architecture/domain/database/platform foundation:** ~99% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~88% complete.
- **Production-capable Pix V1:** ~54% complete.
- **Weighted V1 engineering completion:** ~67% complete.
- **Broader SwiftPay product vision** including hosted checkout, payment links, richer merchant/admin surfaces, broader payout automation and integrations: ~33–38% complete.

The sandbox percentage does not increase with A5 because merchants still lack first-class webhook endpoint management and broader operational surfaces. Production readiness increases because provider ambiguity/capability semantics are now executable and tested, but remains materially discounted because current PSP lineage, endpoints, idempotency/recovery and webhook-auth contracts are not yet proven.

## Materially complete

### Product / architecture / reconstruction contracts

The repository remains the canonical implementation source and carries PRD, architecture, ADRs, domain/public/provider/ledger/webhook contracts, specs, migrations, tests and evidence.

Target architecture remains a Pix-first TypeScript modular monolith with Fastify trusted API, separate trusted worker, Supabase/PostgreSQL canonical state, provider-agnostic Payment Core, append-oriented financial/audit semantics, durable jobs/webhooks and AkkadPag/FlevoPay as the retained initial provider targets.

### Database / financial foundation

Strongly tested foundations exist for merchant/KYC/provider identity, API credentials, idempotency/provider evidence, Payment/ProviderAttempt, double-entry ledger, durable jobs, merchant webhook persistence/runtime, payout/refund foundations, financial reservations, reconciliation, private KYC storage, append-only audit events, dashboard authorization and trusted runtime roles.

Current canonical database lane:

- **37 pgTAP files / 1272 assertions / PASS**;
- K5 deterministic sandbox fixture lane: PASS;
- K6 runtime-topology / least-privilege lane: PASS.

A5 required no schema change or hosted Supabase mutation.

### K1–K7 — trusted executable platform — DONE

The canonical seed remains non-financial. API and worker use separate capability identities. Node.js 24/Fastify API and worker runtimes execute against real production-like database roles in acceptance.

Key evidence:

- `docs/evidence/supabase/2026-08-15-k5-local-sandbox-seed-fixtures.md`
- `docs/evidence/supabase/2026-08-15-k6-trusted-runtime-deployment-topology.md`
- `docs/evidence/application/2026-08-15-k7-executable-runtime-bootstrap.md`

### A1 — API credential token authentication — DONE

Accepted boundary includes `POST /v1/auth/token`, `scrypt-v1` verification, 900-second HS256 tokens, exact-IP allowlists, PostgreSQL-atomic issuance quota, current-DB Bearer revalidation and immediate invalidation after credential revoke/version rotation.

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

### A2 — authenticated Pix create/get + deterministic emulator — DONE

Accepted behavior includes authenticated create/get, strict ownership/request validation, required idempotency, durable Payment/ProviderAttempt before execution, atomic attempt claim, deterministic visibly non-payable emulator output and safe replay/conflict/unknown/rejection semantics.

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

### A3 — paid transition + ledger + merchant balance — DONE

A3 closes the canonical money-state path: worker-only paid evidence, serialized/replay-safe ProviderEvent application, one `settlement_paid` double-entry posting, pending-liability merchant credit, authenticated `GET /v1/balance`, merchant-safe paid projection and transactional `payment.paid` outbox creation.

Evidence: `docs/evidence/application/2026-08-15-a3-paid-transition-ledger-balance.md`.

### A4 — merchant webhook delivery runtime — DONE

A4 consumes the durable outbox without weakening financial authority:

- composed Job + WebhookDelivery lease/fencing capability;
- exact worker-only RPC boundary;
- AES-256-GCM signing-secret isolation/version rotation handling;
- deterministic compact JSON + HMAC-SHA256 signature;
- strict HTTPS/DNS/IP/redirect policy and pinned TLS destination;
- one transport attempt with no hidden retry;
- deterministic retry/backoff/Retry-After policy and eight-attempt ceiling;
- success/retry/terminal/disabled durable state transitions;
- real concurrency/retry/disabled/stale-fence acceptance;
- explicit financial-table invariance and secret-log leakage checks.

Canonical hosted migrations:

- `20260816034121_merchant_webhook_delivery_runtime_foundation.sql`
- `20260816034224_merchant_webhook_delivery_runtime_behavior.sql`

Evidence: `docs/evidence/application/2026-08-16-a4-merchant-webhook-delivery-runtime.md`.

### A5 — provider conformance fixtures — DONE

Problem Analysis: `docs/design/a5-provider-conformance-problem-analysis.md`.

Spec: `docs/specs/provider-conformance-v0.yaml`.

Evidence: `docs/evidence/application/2026-08-16-a5-provider-conformance-fixtures.md`.

A5 accepts a **fixture-only** provider boundary. It does not enable live provider execution.

Accepted behavior includes:

- exactly two retained providers: AkkadPag and FlevoPay;
- explicit `fixture_only` activation state;
- integer-cent money at the canonical boundary;
- exact historical Basic Auth / `X-API-Key` fixture mapping;
- stable SwiftPay client-reference separation from provider identifiers;
- no synthetic customer identity/contact data;
- unsupported operations rejected before transport;
- one-attempt monetary transport with no transparent retry;
- timeout/reset/malformed 2xx/unproven 4xx/ambiguous 5xx -> `execution_unknown`;
- known historical status normalization;
- unknown status -> `unrecognized_provider_status` rather than fake `pending`/`processing`;
- FlevoPay Pix-out remains unsupported;
- provider webhook authority remains unavailable until exact current verification/replay evidence exists;
- no live Node HTTP/HTTPS/net/TLS/DNS transport in `packages/providers`;
- 23 sanitized synthetic provider fixture artifacts.

Clean TDD evidence:

- RED head `10a7051afee1cdd07105c6f08bfac6a5f143ea35`: build/typecheck green, 132 PASS + exactly 15 expected A5 behavior failures, no module/parser/harness errors;
- GREEN head `3583f57e5090ce89284b7929980d738396aafd58`;
- Application workflow `31927064932`: GREEN, **147/147 application contracts** plus K7/A1/A2/A3/A4 real-runtime acceptance;
- Database workflow `31927064836`: GREEN, pgTAP + K5 + K6.

#### Current provider evidence constraint

A5 separates compatibility evidence from production authority.

For AkkadPag, the retained legacy source proves `api.akkadpag.com/v1`, Basic Auth and the `transactions`/`transfers` resource families. Public AkadPay material discovered in 2026 uses materially different host/routes/credential placement. No accepted provider-owned evidence currently proves those contracts are the same lineage. SwiftPay therefore must not import AkadPay idempotency or webhook semantics into the retained AkkadPag adapter.

For FlevoPay, retained source proves the historical `app.flevopay.com.br/api/v1` + `X-API-Key` create/query behavior. Current public material is insufficient to freeze exact create/query/idempotency/recovery/webhook contracts, and does not justify enabling Pix-out.

The next provider step is therefore an **external current-contract evidence gate**, not more speculative adapter code.

## Weighted V1 workstream estimate

| Workstream | Weight | Estimated completion | Weighted contribution |
|---|---:|---:|---:|
| Product contracts / architecture / reverse engineering | 10% | 98% | 9.8% |
| Database + financial core | 20% | 99% | 19.8% |
| Supabase security/platform foundation | 10% | 99% | 9.9% |
| Trusted backend + public API runtime | 15% | 82% | 12.3% |
| Pix provider integrations + recovery | 15% | 50% | 7.5% |
| Worker + merchant webhook HTTP runtime | 10% | 78% | 7.8% |
| Merchant/admin UI | 10% | 5% | 0.5% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0.0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment / observability / cutover | 2% | 15% | 0.3% |
| **Total** | **100%** |  | **~68.5% raw weighted / ~67% conservative checkpoint** |

The conservative checkpoint discounts the raw weighted sum for unresolved external-provider contract evidence. Fixture conformance is necessary, but it is not a substitute for current authenticated PSP evidence and live recovery acceptance.

## Critical path

```text
K1-K7 trusted foundation                         DONE
  -> A1 machine authentication                   DONE
  -> A2 Pix create/get emulator                  DONE
  -> A3 paid transition + ledger + balance       DONE
  -> A4 merchant webhook delivery runtime        DONE
  -> A5 provider conformance fixtures            DONE
  -> current PSP contract/lineage evidence       EVIDENCE_REQUIRED
  -> live provider transport + recovery          BLOCKED ON EVIDENCE
  -> provider webhook ingress/recovery           BLOCKED ON EVIDENCE
  -> production hardening / cutover              PENDING
```

A separate internal product-usability path is not blocked by PSP evidence:

```text
A4 merchant delivery runtime                     DONE
  -> merchant webhook endpoint management API    NEXT UNBLOCKED CANDIDATE
  -> merchant transaction / credential surfaces
  -> broader admin/KYC operations
```

## What still blocks a complete sandbox product

The core deterministic money + webhook lifecycle is correct, but merchant usability still needs:

- webhook endpoint create/update/disable/secret-rotation/test/replay controls;
- merchant transaction operational UI/API surfaces;
- API credential management UI/API;
- broader admin/KYC operational surfaces.

## What still blocks production-capable Pix V1

Production readiness requires:

- current provider-owned contract/lineage proof or authenticated current sandbox evidence for retained PSPs;
- exact current provider endpoints/credential handling;
- authoritative idempotency/recovery semantics after ambiguous monetary execution;
- live AkkadPag/FlevoPay transport only for operations whose evidence gates pass;
- live provider webhook verification/replay handling;
- provider credential/secret bootstrap and rotation operations;
- merchant/admin operational surfaces;
- observability, alerting, SLOs and runbooks;
- deployment/cutover/rollback evidence;
- final security/operational acceptance of the money-moving path.

## Current truth in one sentence

**SwiftPay V2 has a complete deterministic sandbox Pix lifecycle through exactly-once accounting and signed/retried merchant webhooks, plus a GREEN network-free AkkadPag/FlevoPay conformance boundary; weighted V1 engineering is conservatively ~67%, sandbox MVP ~88%, and production-capable Pix V1 ~54%, with current PSP contract evidence now the primary external blocker.**
