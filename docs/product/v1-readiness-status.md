# SwiftPay V2 — V1 Readiness Status

Updated: 2026-08-17

This is the executive checkpoint for one question: **how close is SwiftPay V2 to being usable and production-ready?**

`TODOS.md` is the detailed engineering ledger. Percentages are effort/risk-weighted planning estimates, not raw file or TODO counts.

## Executive status

SwiftPay V2 now proves five distinct layers:

1. a deterministic sandbox Pix lifecycle from machine authentication through accounting and merchant webhook delivery;
2. a network-free executable provider-conformance boundary for AkkadPag and FlevoPay;
3. a server-verified Supabase dashboard-user -> current K3/K4 merchant/environment/role authorization boundary;
4. hosted dashboard webhook endpoint administration with durable idempotency/audit and isolated signing-secret history; and
5. hosted dashboard API credential administration with online-validated AAL2 mutation step-up and immediate A1 token invalidation semantics.

Current conservative estimate:

- **Core architecture/domain/database/platform foundation:** ~99% complete.
- **First end-to-end Pix MVP usable in sandbox:** ~96% complete.
- **Production-capable Pix V1:** ~58% complete.
- **Weighted V1 engineering completion:** ~73% complete.
- **Broader SwiftPay product vision** including hosted checkout, payment links, richer merchant/admin surfaces, payout operations and broader integrations: ~39–44% complete.

A8 materially improves merchant usability and operational safety but does not change the primary production blocker: current provider-owned contract/lineage, idempotency/recovery and webhook-auth evidence for retained PSPs remains insufficient to authorize live money-moving integration.

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
12. immutable delivery URL + signing-secret-version snapshots across endpoint edits/rotations;
13. dashboard API credential list/get/create/rotate/revoke;
14. AAL2-only credential mutations with Sandbox admin/owner and Production owner authority;
15. one-time plaintext API Secret Key disclosure with only `scrypt-v1` verifier persistence; and
16. immediate invalidation of old A1 tokens after credential secret rotation or revocation.

## Materially complete

### K1–K7 — trusted platform foundation — DONE

Private database boundaries, append-only audit, merchant membership authorization, capability roles, deterministic local fixtures, production-like runtime topology and executable Node.js 24/Fastify API/worker bootstrap are complete.

### A1 — API credential authentication — DONE

`POST /v1/auth/token`, `scrypt-v1`, exact-IP policy, issuance quota, 900-second HS256 machine tokens and database revalidation are accepted.

Evidence: `docs/evidence/application/2026-08-15-a1-api-credential-token-authentication.md`.

### A2 — Pix create/get emulator — DONE

Authenticated create/get, required idempotency, durable Payment/ProviderAttempt before execution, atomic attempt claim, deterministic visibly non-payable emulator and explicit uncertainty/rejection semantics are accepted.

Evidence: `docs/evidence/application/2026-08-15-a2-pix-create-get-emulator.md`.

### A3 — paid transition + ledger + balance — DONE

Worker-only paid evidence, replay-safe ProviderEvent application, exactly one settlement ledger posting, merchant balance and transactional `payment.paid` outbox creation are accepted.

Evidence: `docs/evidence/application/2026-08-15-a3-paid-transition-ledger-balance.md`.

### A4 — merchant webhook delivery runtime — DONE

Durable lease/fencing, HMAC signing, SSRF-safe HTTPS dispatch, retry/backoff/terminal semantics and financial invariance are accepted.

Evidence: `docs/evidence/application/2026-08-16-a4-merchant-webhook-delivery-runtime.md`.

### A5 — provider conformance fixtures — DONE / FIXTURE-ONLY

Exactly AkkadPag and FlevoPay are retained behind network-free fixture adapters. This does **not** authorize live PSP execution.

Evidence: `docs/evidence/application/2026-08-16-a5-provider-conformance-fixtures.md`.

### A6 — dashboard session authentication — DONE

Dashboard sessions are verified server-side through Supabase Auth and merchant/environment/role authority is derived only from current K3/K4 state. Machine tokens and dashboard users remain separate realms.

Evidence: `docs/evidence/application/2026-08-16-a6-dashboard-session-authentication.md`.

### A7 — merchant webhook endpoint management — DONE / HOSTED

Dashboard-only endpoint create/list/get/update/disable/enable/rotate-secret is accepted with durable idempotency/audit, optimistic revision fencing, RSA-OAEP-SHA256 secret wrapping, immutable delivery snapshots and A4 legacy compatibility.

Evidence: `docs/evidence/application/2026-08-16-a7-merchant-webhook-endpoint-management.md`.

### A8 — API credential management — DONE / HOSTED

A8 closes machine-credential administration through the dashboard realm.

Accepted behavior includes:

- list/get use ordinary A6 session verification and current member authority;
- create/rotate/revoke require online-validated Supabase `aal2` before secret generation or DB mutation;
- Sandbox mutations require current admin/owner; Production requires current owner;
- public/secret material is CSPRNG-generated in trusted API memory;
- plaintext Secret Key is returned only on the winning create/rotation response;
- plaintext Secret Key never enters PostgreSQL, idempotency snapshots, audit or logs;
- persisted secret authority remains A1-compatible `scrypt-v1`;
- completed replay never re-discloses candidate secret material;
- rotate/revoke use positive optimistic `revision` fencing;
- rotation increments `secret_version` and invalidates old bearer tokens at next A1 DB revalidation;
- revocation is terminal and blocks both new exchange and existing bearer tokens at next revalidation;
- exact maximum 10 active credentials per merchant/environment is transactionally enforced;
- API/worker retain zero direct protected-table authority;
- credential administration has zero financial-state mutation authority.

Problem Analysis: `docs/design/a8-api-credential-management-problem-analysis.md`.

Spec: `docs/specs/api-credential-management-v0.yaml`.

Evidence: `docs/evidence/application/2026-08-17-a8-api-credential-management.md`.

Final clean GREEN:

- head `d74624198918aca53a3769334aeb6b8adbba8092`;
- Application workflow `32001023852`: **226/226 PASS**, typecheck/build GREEN, plus K7/A1/A2/A3/A4/A6/A7/A8 real-database acceptance;
- Database workflow `32001023848`: **39 files / 1288 pgTAP assertions PASS**, deterministic fixtures GREEN and runtime topology GREEN.

Hosted migrations:

- `20260817061316_api_credential_management_foundation.sql`;
- `20260817061346_api_credential_management_create.sql`;
- `20260817061415_api_credential_management_behavior.sql`.

Hosted post-deploy audit:

- `swiftpay_api`: exact **21** routine capabilities;
- `swiftpay_worker`: exact **6** routine capabilities;
- all five A8 trusted RPCs present;
- no direct protected-table API/worker privilege;
- private `_a8_*` helpers unavailable to runtimes;
- zero plaintext-like credential-secret leakage in persisted credential/idempotency/audit surfaces;
- Security Advisor: **0 lints**.

Performance Advisor remains INFO-only with existing unindexed-FK/unused-index candidates. Optimization remains a dedicated measured slice.

## Weighted V1 estimate

| Workstream | Weight | Estimated completion | Weighted contribution |
|---|---:|---:|---:|
| Product contracts / architecture / reverse engineering | 10% | 99% | 9.9% |
| Database + financial core | 20% | 99% | 19.8% |
| Supabase security/platform foundation | 10% | 99% | 9.9% |
| Trusted backend + public/dashboard API runtime | 15% | 96% | 14.4% |
| Pix provider integrations + recovery | 15% | 50% | 7.5% |
| Worker + merchant webhook runtime | 10% | 90% | 9.0% |
| Merchant/admin product surfaces | 10% | 30% | 3.0% |
| Hosted checkout / payment links / conversion | 5% | 0% | 0.0% |
| Wallet/payout operational application layer | 3% | 20% | 0.6% |
| Deployment / observability / cutover | 2% | 15% | 0.3% |
| **Total** | **100%** |  | **~74.4% raw / ~73% conservative checkpoint** |

The conservative discount remains justified by unresolved external PSP evidence and absent launch/operations work.

## Critical path

```text
K1-K7 trusted foundation                         DONE
  -> A1 machine authentication                   DONE
  -> A2 Pix create/get emulator                  DONE
  -> A3 paid transition + ledger + balance       DONE
  -> A4 merchant webhook delivery runtime        DONE
  -> A5 provider conformance fixtures            DONE / FIXTURE-ONLY
  -> current PSP contract/lineage evidence       EVIDENCE_REQUIRED
       -> live provider transport + recovery     BLOCKED
       -> provider webhook ingress               BLOCKED
  -> production hardening / cutover              PENDING
```

Parallel internal product path:

```text
K3/K4 dashboard authorization                    DONE
  -> A6 dashboard session authentication         DONE
  -> A7 webhook endpoint management              DONE / HOSTED
  -> A8 API credential management                DONE / HOSTED
  -> A9 merchant transaction operations          PROBLEM_ANALYSIS
  -> broader admin/KYC/payout operations         PENDING
```

## What still blocks a complete sandbox product

The core deterministic payment/accounting/webhook lifecycle, webhook administration and API credential administration are executable. Merchant usability still needs:

- merchant transaction list/detail/search/filter surfaces;
- dashboard login/session UX/product wiring around A6;
- broader KYC/admin operational surfaces;
- payout/refund merchant operations.

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

**SwiftPay V2 has a deterministic sandbox Pix lifecycle through exactly-once accounting and signed/retried merchant webhooks, hosted webhook and API-credential administration, a GREEN fixture-only AkkadPag/FlevoPay adapter boundary, and a GREEN dashboard identity/authorization boundary; weighted V1 engineering is conservatively ~73%, sandbox MVP ~96%, and production-capable Pix V1 ~58%, with current PSP evidence still the main external blocker and merchant transaction/admin/launch workflows the remaining internal gap.**
