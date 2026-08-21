# SwiftPay V2 — A4 Merchant Webhook Delivery Runtime Evidence

Date: 2026-08-16
Slice: `merchant-webhook-delivery-runtime-v0`
Status: DONE

## Scope accepted

A4 closes the asynchronous merchant-delivery leg of the deterministic sandbox Pix lifecycle. It consumes the durable webhook outbox created by A3, leases delivery work through a composed Job + WebhookDelivery database capability, produces a deterministic signed HTTP request, classifies outcomes, retries with bounded deterministic backoff, terminalizes unrecoverable/exhausted work and preserves the financial boundary.

A4 is HTTP at-least-once delivery. It does not claim exactly-once network delivery and it does not call a live PSP.

## Canonical specification and contracts

- Problem Analysis: `docs/design/a4-merchant-webhook-delivery-problem-analysis.md`
- Frozen YAML spec: `docs/specs/merchant-webhook-delivery-runtime-v0.yaml`
- Merchant webhook contract: `docs/contracts/merchant-webhooks.md`
- Job/outbox contract: `docs/contracts/outbox-and-jobs.md`
- Database schema contract: `supabase/tests/database/036_merchant_webhook_delivery_runtime_schema.test.sql`
- Database behavior contract: `supabase/tests/database/037_merchant_webhook_delivery_runtime_behavior.test.sql`
- Crypto/signing contracts: `tests/application/022_a4_webhook_crypto_signing.contract.test.mjs`
- Policy/retry contracts: `tests/application/023_a4_webhook_policy_retry.contract.test.mjs`
- Database store contracts: `tests/application/024_a4_webhook_db_store.contract.test.mjs`
- Delivery service contracts: `tests/application/025_a4_webhook_delivery_service.contract.test.mjs`
- Worker wiring contracts: `tests/application/026_a4_worker_wiring.contract.test.mjs`
- Real runtime driver: `tests/application/027_a4_real_runtime_driver.mjs`
- Real runtime acceptance: `tests/application/027_a4_real_runtime_acceptance.sh`

## Accepted invariants

- A3 remains the authority that transactionally creates the canonical `payment.paid` webhook event/delivery/job state.
- HTTP delivery is at-least-once and has no financial authority.
- Job and WebhookDelivery leases are claimed/resolved together with one fencing token; the generic job claim path is not used for merchant webhook delivery.
- A stale or wrong lease token resolves to `false` without mutating the current lease owner state.
- Concurrent workers cannot simultaneously own the same delivery lease.
- Disabled endpoints after fanout terminalize the durable work without incrementing an HTTP attempt or opening a network connection.
- Signing-secret version is snapshotted at fanout. Rotation can use the current ciphertext or the still-valid previous ciphertext only for the snapshotted version.
- Webhook signing secrets are decrypted only in the worker using AES-256-GCM and a dedicated `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY`; the access-token signing key is not a fallback.
- The request body is canonical compact UTF-8 JSON and the HMAC input/header format is deterministic.
- Endpoint policy is HTTPS-only, port 443, no credentials, no fragment, no redirects, DNS-resolved per attempt and fail-closed for prohibited destination addresses; the actual TLS destination is pinned while hostname/SNI verification uses the original host.
- One transport attempt has a 5-second total timeout and no hidden retry.
- 2xx succeeds; selected transient HTTP/network outcomes retry; redirect/policy/secret/payload failures terminalize; attempt 8 is terminal exhaustion.
- Retry delay is deterministic, capped and includes the frozen jitter algorithm; integer `Retry-After` is honored only for 429 within the accepted bound.
- Delivery runtime does not write Payment, Account, LedgerTransaction or LedgerEntry state.
- Signing secret, ciphertext and full signature values are rejected from acceptance logs.

## Canonical hosted Supabase migrations

Applied to project `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`):

- `20260816034121_merchant_webhook_delivery_runtime_foundation.sql`
- `20260816034224_merchant_webhook_delivery_runtime_behavior.sql`

The hosted service assigned those versions during migration application. Git migration filenames were then atomically aligned to the hosted history in commit `ac41a57e64fca69871e0d26bafe05d888b8e3cbd`; the SQL blob contents were unchanged by the rename.

## Hosted verification

Post-apply structural verification confirmed:

- `app.webhook_deliveries.signing_secret_version` is `integer NOT NULL`;
- `signing_secret_version > 0` and `last_error_code <= 80` constraints exist;
- `app.claim_merchant_webhook_deliveries(text,integer,integer)` is `SECURITY DEFINER`, `VOLATILE`, `search_path=''`;
- `app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)` is `SECURITY DEFINER`, `VOLATILE`, `search_path=''`;
- `public`, `anon`, `authenticated`, `service_role` and `swiftpay_api` cannot execute the two A4 routines;
- only `swiftpay_worker` can execute the two A4 routines;
- the complete `swiftpay_worker` function capability allowlist is exactly six routines: `claim_jobs`, `complete_job`, `reschedule_job`, `apply_sandbox_pix_paid`, `claim_merchant_webhook_deliveries`, `resolve_merchant_webhook_delivery`;
- static inspection of the two new A4 routine definitions finds no references to `app.payments`, `app.accounts`, `app.ledger_transactions` or `app.ledger_entries`;
- the canonical hosted project contained zero webhook deliveries during migration, so the compatibility backfill had no business-row effect.

Supabase Security Advisor after A4 returned **zero lints**.

Supabase Performance Advisor returned only `INFO` notices for pre-existing/general unindexed foreign keys and unused indexes. No security/error-level finding blocks A4. Performance index changes were not opportunistically added because they are outside the frozen A4 behavior and should receive their own measured/spec-driven optimization slice.

## Accepted behavior CI

Pre-hosted/alignment gate on commit `382f4816a39fa3f368f8a22acd383c20675d77d7`:

- Application workflow `31924710654` — GREEN;
- Database workflow `31924710656` — GREEN;
- **128/128 application contracts**;
- **37 pgTAP files / 1272 database assertions / PASS**;
- K5 deterministic sandbox fixture lane GREEN;
- K6 runtime-topology/least-privilege lane GREEN;
- K7, A1, A2, A3 and A4 real runtime acceptance GREEN.

The A2 race acceptance was hardened in the same commit to accept the legitimate observation where an HTTP `202` caller sees the logical Payment already `pending` because the concurrent execution owner completed before serialization. The product contract was not weakened: responses remain 201/202 only, `creating` remains 202 with no Pix material, both callers share one Payment ID, at least one owner returns 201, and exactly one provider execution persists.

## A4 real runtime acceptance

The acceptance runs against one isolated real Supabase/PostgreSQL runtime with production-like API/worker roles and controlled injected endpoint policy/transport at the network boundary.

It proves four phases:

1. **concurrency-success** — one worker owns the delivery, the competing worker claims zero, request/body shape is canonical, HMAC verifies and the snapshotted previous signing-secret version remains usable during rotation;
2. **retry-once** — HTTP 503 classifies as retry and both Job/Delivery return to `pending` with synchronized due time and durable error evidence;
3. **disabled-after-fanout** — disabling the endpoint terminalizes the delivery/job without an HTTP call or attempt increment;
4. **stale-fence** — an expired lease is reclaimed, the stale token cannot resolve it and the current token succeeds.

The harness also snapshots financial-table row counts around A4 and proves no Payment/Account/Ledger side effect, while scanning logs for plaintext signing-secret/ciphertext/signature leakage.

## Post-sync reproducibility gate

After hosted versions were known, repository migration filenames were aligned exactly to hosted history. Full clean-database workflows reran from commit `ac41a57e64fca69871e0d26bafe05d888b8e3cbd`:

- Application workflow `31924944437` — GREEN;
- Database workflow `31924944433` — GREEN;
- application contracts, K7/A1/A2/A3/A4 runtime acceptance, pgTAP, K5 fixtures and K6 topology all GREEN.

This proves a clean database reconstructed exclusively from repository migration history reproduces the hosted A4 schema/behavior after version alignment.

## Explicitly outside A4

Still pending after this slice:

- merchant-facing webhook endpoint CRUD/secret-rotation/test/replay API/UI;
- live PSP request/response conformance;
- AkkadPag/FlevoPay live adapters;
- provider webhook ingress/authentication and provider-side replay handling;
- provider execution-unknown recovery/reconciliation against real PSP behavior;
- production observability/alerts/SLOs/cutover;
- payout/refund application/API/UI execution flows.

## Closure

A4 is accepted as **DONE**. SwiftPay V2 now has a complete deterministic sandbox chain from machine authentication -> idempotent Pix creation -> paid evidence -> exactly-once ledger/balance -> durable merchant event -> signed/retried/fenced HTTP webhook delivery.

The next critical slice is provider conformance. No live AkkadPag/FlevoPay monetary call is permitted until provider-specific fixtures prove request/response mapping, idempotency/recovery certainty, webhook identity/authentication and error semantics behind the stable native Pix provider adapter contract.
