# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-16

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` is the detailed engineering ledger. Percentages are effort/risk-weighted planning estimates, not raw file or TODO counts.

## Executive status

SwiftPay V2 now proves three distinct layers:

1. a complete deterministic sandbox Pix lifecycle from machine authentication through merchant webhook delivery;
2. a network-free, executable provider-conformance boundary for the retained AkkadPag and FlevoPay integrations; and
3. a reusable dashboard user-session authentication/merchant-authorization boundary for future administrative surfaces.

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

A6 additionally proves that a future dashboard request can use a server-confirmed Supabase Auth user identity and current K3/K4 merchant membership/role truth without granting machine API tokens administrative authority or introducing `service_role`/Supabase secret/JWT-secret access into the API.

Current conservative estimate:

- **Core architecture/domain/database/platform foundation:** ~99% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~90% complete.
- **Production-capable Pix V1:** ~55% complete.
- **Weighted V1 engineering completion:** ~68% complete.
- **Broader SwiftPay product vision** including hosted checkout, payment links, richer merchant/admin surfaces, broader payout automation and integrations: ~34–39% complete.

A6 improves the sandbox/product foundation because merchant-administration surfaces now have a safe identity/authorization boundary. It does not complete those surfaces: webhook endpoint management, API credential administration, transaction operations and broader KYC/admin UX are still absent. Production readiness remains materially discounted because current PSP lineage, endpoints, idempotency/recovery and webhook-auth contracts are not yet proven.

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

A5 and A6 required no schema change or hosted Supabase mutation.

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

### A6 — dashboard session authentication — DONE

Problem Analysis: `docs/design/a6-dashboard-session-authentication-problem-analysis.md`.

Spec: `docs/specs/dashboard-session-authentication-v0.yaml`.

Evidence: `docs/evidence/application/2026-08-16-a6-dashboard-session-authentication.md`.

A6 closes the reusable trusted identity/authorization boundary for future merchant-administration routes while deliberately adding no business endpoint of its own.

Accepted behavior includes:

- strict Supabase user-session Bearer parsing;
- one server-side Auth verification request to `/auth/v1/user`;
- 5-second timeout, redirects disabled and no transparent retry;
- only a verified UUID `userId` becomes identity authority;
- JWT user/app metadata never grants merchant/environment/role authority;
- 401/403 -> invalid session, while upstream/network/timeout/malformed success -> authentication unavailable;
- `SWIFTPAY_SUPABASE_URL` must be an HTTPS origin;
- `SWIFTPAY_SUPABASE_PUBLISHABLE_KEY` must be a modern `sb_publishable_...` key;
- no `service_role`, `sb_secret_...` or Supabase JWT secret enters the API boundary;
- K4 `app.require_dashboard_merchant_context(...)` remains the sole merchant/environment/role authority;
- current membership/role disablement takes effect on the next authorization check;
- dashboard tokens never fall back to the A1 machine-token verifier;
- A1 machine tokens never become dashboard administrative identity;
- no audit, payment, ledger, job or webhook side effects from authorization checks.

Clean TDD evidence:

- RED head `948f5369802dfe682e8c8c0aaeeb8cfa908f3ece`: typecheck/build PASS, 152 existing tests PASS + exactly 34 expected A6 behavior failures, no parser/module/harness error;
- final GREEN head `4ac4e0b53776e55361f90d5589e5f72bcbdce49c`;
- Application workflow `31928641553`: GREEN, **186/186 application contracts** plus K7/A1/A2/A3/A4/A6 real-database acceptance;
- Database workflow `31928641539`: GREEN, pgTAP + K5 + K6.

A6 adds no migration and required no hosted Supabase schema mutation.

## Weighted V1 workstream estimate

| Workstream | Weight | Estimated completion | Weighted contribution |
|---|---:|---:|---:|
| Product contracts / architecture / reverse engineering | 10% | 98% | 9.8% |
| Database + financial core | 20% | 99% | 19.8% |
| Supabase security/platform foundation | 10% | 99% | 9.9% |
| Trusted backend + public/dashboard API runtime | 15% | 87% | 13.1% |
| Pix provider integrations + recovery | 15% | 50% | 7.5% |
| Worker + merchant webhook HTTP runtime | 10% | 78% | 7.8% |
| Merchant/admin UI | 10% | 5% | 0.5% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0.0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment / observability / cutover | 2% | 15% | 0.3% |
| **Total** | **100%** |  | **~69.3% raw weighted / ~68% conservative checkpoint** |

The conservative checkpoint discounts the raw weighted sum for unresolved external-provider contract evidence and missing merchant/admin business surfaces. A reusable authorization boundary is necessary, but it is not equivalent to having the dashboard/product workflows themselves.

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
K3/K4 dashboard membership/database boundary     DONE
  -> A6 dashboard session authentication         DONE
  -> merchant webhook endpoint management API    NEXT UNBLOCKED CANDIDATE
  -> merchant transaction / credential surfaces
  -> broader admin/KYC operations
```

## What still blocks a complete sandbox product

The core deterministic money + webhook lifecycle is correct and dashboard identity is now executable, but merchant usability still needs:

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

**SwiftPay V2 has a complete deterministic sandbox Pix lifecycle through exactly-once accounting and signed/retried merchant webhooks, a GREEN network-free AkkadPag/FlevoPay conformance boundary, and a GREEN Supabase-user-to-K4 dashboard authorization boundary; weighted V1 engineering is conservatively ~68%, sandbox MVP ~90%, and production-capable Pix V1 ~55%, with current PSP contract evidence the primary external blocker and merchant/admin business surfaces the primary internal usability gap.**
