# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-16

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` is the detailed engineering ledger. Percentages are effort/risk-weighted planning estimates, not raw file or TODO counts.

## Executive status

SwiftPay V2 now proves four distinct layers:

1. a deterministic sandbox Pix lifecycle from machine authentication through accounting and merchant webhook delivery;
2. a network-free executable provider-conformance boundary for AkkadPag and FlevoPay;
3. a server-verified Supabase dashboard-user -> current K3/K4 merchant/environment/role authorization boundary; and
4. a first dashboard-only merchant webhook endpoint management surface with durable idempotency, audit, RSA-wrapped signing-secret history and immutable delivery snapshots.

Current conservative estimate:

- **Core architecture/domain/database/platform foundation:** ~99% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~94% complete.
- **Production-capable Pix V1:** ~57% complete.
- **Weighted V1 engineering completion:** ~71% complete.
- **Broader SwiftPay product vision** including hosted checkout, payment links, richer merchant/admin surfaces, payout operations and broader integrations: ~36–41% complete.

A7 materially improves merchant usability but does not change the primary production blocker: current provider-owned contract/lineage, idempotency/recovery and webhook-auth evidence for the retained PSPs is still insufficient to authorize live money-moving integration.

## Executable deterministic sandbox path

The branch proves:

1. `POST /v1/auth/token` -> 900-second Bearer token;
2. authenticated/idempotent `POST /v1/transactions`;
3. deterministic visibly non-payable Pix emulator output;
4. authenticated `GET /v1/transactions/:id`;
5. trusted worker-side paid evidence with replay/concurrency absorption;
6. exactly one `settlement_paid` double-entry ledger posting;
7. authenticated `GET /v1/balance`;
8. transactional canonical `payment.paid` webhook outbox event;
9. fenced, signed, retryable merchant HTTP webhook delivery;
10. dashboard user authentication and current merchant-role authorization;
11. dashboard-only webhook endpoint lifecycle with create/list/get/update/disable/enable/secret rotation;
12. immutable delivery URL + signing-secret-version snapshots across endpoint edits/rotations.

## Materially complete

### K1–K7 — trusted platform foundation — DONE

Private database boundaries, append-only audit, merchant membership authorization, capability roles, deterministic local fixtures, production-like runtime topology and executable Node.js 24/Fastify API/worker bootstrap are complete.

Key evidence:

- `docs/evidence/supabase/2026-08-15-k2-audit-events.md`
- `docs/evidence/supabase/2026-08-15-k3-dashboard-membership-authorization.md`
- `docs/evidence/supabase/2026-08-15-k4-trusted-runtime-database-boundary.md`
- `docs/evidence/supabase/2026-08-15-k5-local-sandbox-seed-fixtures.md`
- `docs/evidence/supabase/2026-08-15-k6-trusted-runtime-deployment-topology.md`
- `docs/evidence/application/2026-08-15-k7-executable-runtime-bootstrap.md`

### A1 — API credential authentication — DONE

`POST /v1/auth/token`, `scrypt-v1`, exact-IP policy, issuance quota, 900-second HS256 machine tokens and database revalidation are accepted.

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

Credential administration itself remains a pending merchant-product surface.

### A2 — Pix create/get emulator — DONE

Authenticated create/get, required idempotency, durable Payment/ProviderAttempt before execution, atomic attempt claim, deterministic visibly non-payable emulator and explicit uncertainty/rejection semantics are accepted.

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

### A3 — paid transition + ledger + balance — DONE

Worker-only paid evidence, replay-safe ProviderEvent application, exactly one settlement ledger posting, merchant balance and transactional `payment.paid` outbox creation are accepted.

Evidence: `docs/evidence/application/2026-08-15-a3-paid-transition-ledger-balance.md`.

### A4 — merchant webhook delivery runtime — DONE

Durable lease/fencing, HMAC signing, SSRF-safe HTTPS dispatch, one network attempt per durable attempt, retry/backoff/terminal semantics, AES secret compatibility and financial invariance are accepted.

Hosted migrations:

- `20260816034121_merchant_webhook_delivery_runtime_foundation.sql`
- `20260816034224_merchant_webhook_delivery_runtime_behavior.sql`

Evidence: `docs/evidence/application/2026-08-16-a4-merchant-webhook-delivery-runtime.md`.

### A5 — provider conformance fixtures — DONE / FIXTURE-ONLY

Exactly AkkadPag and FlevoPay are retained behind network-free fixture adapters. The package proves request mapping, capability rejection, explicit `execution_unknown`, no transparent monetary retry and fail-closed status/webhook authority behavior.

It does **not** authorize live PSP execution.

Problem Analysis: `docs/design/a5-provider-conformance-problem-analysis.md`.

Spec: `docs/specs/provider-conformance-v0.yaml`.

Evidence: `docs/evidence/application/2026-08-16-a5-provider-conformance-fixtures.md`.

### A6 — dashboard session authentication — DONE

A6 verifies dashboard sessions server-side through Supabase Auth and derives merchant/environment/role authority only from current K3/K4 state. Machine tokens and dashboard users remain separate realms with no fallback.

Problem Analysis: `docs/design/a6-dashboard-session-authentication-problem-analysis.md`.

Spec: `docs/specs/dashboard-session-authentication-v0.yaml`.

Evidence: `docs/evidence/application/2026-08-16-a6-dashboard-session-authentication.md`.

### A7 — merchant webhook endpoint management — DONE / HOSTED

A7 closes the first administrative business surface.

Accepted behavior includes:

- dashboard-only management routes;
- member read / admin mutation authority;
- create/list/get/update/disable/enable/rotate-secret;
- no DELETE in V0;
- URL mutation only while disabled;
- exactly `payment.paid` subscription in V0;
- positive optimistic `revision` fencing;
- durable request idempotency and append-only audit;
- exact completed replay before stale-revision handling;
- one-time `whsec_...` plaintext only on winning create/rotation;
- replay never persists or re-discloses signing plaintext;
- RSA-OAEP-SHA256 wrapping with API public-key authority only and worker private-keyring authority only;
- A4 AES legacy compatibility;
- multi-version secret history with bounded previous-version overlap;
- immutable endpoint URL and secret-version delivery snapshots;
- versioned signature header;
- pending delivery/job terminalization on disable;
- explicit financial-state invariance.

Problem Analysis: `docs/design/a7-merchant-webhook-endpoint-management-problem-analysis.md`.

Spec: `docs/specs/merchant-webhook-endpoint-management-v0.yaml`.

Evidence: `docs/evidence/application/2026-08-16-a7-merchant-webhook-endpoint-management.md`.

Final behavior GREEN:

- head `155472ba299f1e75d33dd6cad430ad61b923a043`;
- Application workflow `31934008876`: **209/209 PASS** plus K7/A1/A2/A3/A4/A6/A7 real-database acceptance;
- Database workflow `31934008886`: pgTAP + deterministic fixtures + runtime topology GREEN.

Hosted A7 migrations:

- `20260816073330_webhook_endpoint_management_foundation.sql`;
- `20260816073500_webhook_endpoint_management_behavior.sql`;
- `20260816073604_webhook_endpoint_management_behavior_fix.sql`.

Hosted audit after deployment:

- `swiftpay_api`: exact **16** routine capabilities;
- `swiftpay_worker`: exact **6** routine capabilities;
- zero direct runtime DML/SELECT on endpoint/secret/idempotency/audit tables;
- API cannot claim/resolve worker delivery; worker cannot administer endpoints;
- private A7 helpers unavailable to runtime roles;
- Security Advisor: **0 lints**.

Performance Advisor remains INFO-only with unindexed-FK/unused-index candidates; optimization remains a dedicated measured slice, not an A7 side quest.

## Weighted V1 estimate

| Workstream | Weight | Estimated completion | Weighted contribution |
|---|---:|---:|---:|
| Product contracts / architecture / reverse engineering | 10% | 99% | 9.9% |
| Database + financial core | 20% | 99% | 19.8% |
| Supabase security/platform foundation | 10% | 99% | 9.9% |
| Trusted backend + public/dashboard API runtime | 15% | 94% | 14.1% |
| Pix provider integrations + recovery | 15% | 50% | 7.5% |
| Worker + merchant webhook runtime | 10% | 90% | 9.0% |
| Merchant/admin product surfaces | 10% | 18% | 1.8% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0.0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment / observability / cutover | 2% | 15% | 0.3% |
| **Total** | **100%** |  | **~72.9% raw / ~71% conservative checkpoint** |

The conservative discount remains justified by unresolved external PSP evidence and several absent merchant/admin product workflows.

## Critical path

```text
K1-K7 trusted foundation                         DONE
  -> A1 machine authentication                   DONE
  -> A2 Pix create/get emulator                  DONE
  -> A3 paid transition + ledger + balance       DONE
  -> A4 merchant webhook delivery runtime        DONE
  -> A5 provider conformance fixtures            DONE
  -> current PSP contract/lineage evidence       EVIDENCE_REQUIRED
       -> live provider transport + recovery     BLOCKED
       -> provider webhook ingress               BLOCKED
  -> production hardening / cutover              PENDING
```

Parallel internal product path:

```text
K3/K4 dashboard authorization                    DONE
  -> A6 dashboard session authentication         DONE
  -> A7 webhook endpoint management              DONE
  -> API credential management                   NEXT CANDIDATE
  -> merchant transaction operations             PENDING
  -> broader admin/KYC/payout operations         PENDING
```

## What still blocks a complete sandbox product

The core deterministic payment/accounting/webhook lifecycle and webhook administration are executable. Merchant usability still needs:

- API credential create/list/rotate/revoke administration;
- merchant transaction list/detail/search/status operations;
- dashboard login/session UX/product wiring around the accepted A6 boundary;
- broader KYC/admin operational surfaces;
- payout/refund merchant operations.

Hosted webhook test/replay controls are not implicitly included in A7 and require a separate frozen contract if desired.

## What still blocks production-capable Pix V1

Production readiness still requires:

- current provider-owned contract/lineage proof or authenticated current sandbox evidence;
- exact current provider endpoints/credential handling;
- authoritative idempotency/recovery semantics after ambiguous monetary execution;
- live AkkadPag/FlevoPay transport only after applicable evidence gates pass;
- live provider webhook verification/replay handling;
- provider credential bootstrap/rotation operations;
- merchant/admin operational surfaces;
- observability, alerting, SLOs and runbooks;
- deployment/cutover/rollback evidence;
- final security and operational acceptance of the money-moving path.

## Current truth in one sentence

**SwiftPay V2 now has a deterministic sandbox Pix lifecycle through exactly-once accounting and signed/retried merchant webhooks, a GREEN fixture-only AkkadPag/FlevoPay adapter boundary, a GREEN dashboard identity/authorization boundary, and a hosted dashboard webhook-management API; weighted V1 engineering is conservatively ~71%, sandbox MVP ~94%, and production-capable Pix V1 ~57%, with current PSP evidence still the main external blocker and credential/transaction/admin workflows the remaining internal usability gap.**
