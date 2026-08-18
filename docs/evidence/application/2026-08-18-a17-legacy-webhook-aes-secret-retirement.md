# A17 — Legacy Webhook AES Secret Retirement — Final Evidence

Date: 2026-08-18  
State: **DONE / GREEN / HOSTED**

## Scope

A17 retires the pre-A7 AES-256-GCM compatibility authority for persisted merchant webhook signing secrets before production launch. The production path is now RSA-OAEP-SHA256 only, with an explicit persisted wrapping-key ID and exact-key worker unwrap.

A17 does not change the merchant webhook HMAC request-signing protocol, retry/fencing semantics, Payment state, provider state, provider activation authority or retained-PSP network binding.

## TDD lineage

- Problem Analysis: `docs/design/a17-legacy-webhook-aes-secret-retirement-problem-analysis.md`
- Specification: `docs/specs/legacy-webhook-aes-secret-retirement-v0.yaml`
- Contract: `docs/contracts/legacy-webhook-aes-secret-retirement-v0.md`
- Application fail-first contract: `tests/application/059_a17_legacy_webhook_aes_secret_retirement.contract.test.mjs`
- Database fail-first contract: `supabase/tests/database/042_legacy_webhook_aes_secret_retirement.test.sql`
- CLEAN RED evidence: `docs/evidence/application/2026-08-18-a17-legacy-webhook-aes-secret-retirement-red.md`

CLEAN RED was proven before implementation:

- application: 343 total / 337 PASS / 6 A17-intended FAIL;
- all pre-A17 application contracts remained GREEN;
- runtime regression K7/A1/A2/A3/A4/A6/A7/A8/A9/A14 remained GREEN;
- database baseline remained GREEN with the new A17 pgTAP failing only for the missing RSA-only constraints.

## Accepted implementation boundary

### Worker/runtime

- removed `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY`;
- removed `webhookEncryptionKey` runtime authority;
- worker requires the existing validated RSA private-keyring authority;
- no AES fallback and no trial-all private-key decrypt behavior;
- exact persisted wrapping-key ID selects the private key;
- AES or missing-format claims terminalize before endpoint policy/network I/O.

### Webhooks package

Production `@swiftpay/webhooks` no longer exposes persisted-secret AES decrypt authority. The merchant delivery protocol remains unchanged:

- canonical body serialization;
- HMAC-SHA256 request signature;
- exact delivery/event/timestamp headers;
- SSRF/DNS destination policy;
- one transport send per claimed attempt;
- retry/terminal classification and fencing.

### Database

Migration source: `supabase/migrations/20260818090500_legacy_webhook_aes_secret_retirement.sql`.

The migration:

- aborts if any `aes-256-gcm-v1` secret-version row exists;
- does not delete, rewrite, relabel or expire legacy material to bypass the gate;
- requires `wrapping_key_id NOT NULL`;
- permits only `ciphertext_format = 'rsa-oaep-sha256-v1'`;
- requires a valid wrapping-key ID shape;
- requires RSA-OAEP-SHA256 ciphertext shape;
- replaces `app.claim_merchant_webhook_deliveries(text, integer, integer)` without changing its signature or grants;
- removes the historical endpoint-mirror AES fallback from the claim projection;
- explicit usable RSA history remains the only signing-secret unwrap authority.

Historical A4/A7 test fixtures were migrated to RSA history while preserving rotation overlap, retries, concurrency, fencing and exact request-signature behavior.

## Final repository verification

Accepted implementation head: `e7c41e9a416cf454724b8167a5d17c9bf1c19e08`.

### Application workflow

Workflow: `32168309740`

- `application-contracts` job `95813123471`: GREEN;
- frozen dependency install: GREEN;
- typecheck: GREEN;
- build: GREEN;
- **344/344 application contracts PASS**;
- A17 contracts: **7/7 PASS**.

### Real-database runtime acceptance

Workflow: `32168309740`, job `95813123501`: GREEN.

The same isolated PostgreSQL runtime passed:

- K7 runtime database integration;
- A1 token authentication;
- A2 Pix create/get emulator;
- A3 paid/ledger/balance;
- A4 merchant webhook delivery using RSA-only secret history;
- A6 dashboard authorization;
- A7 webhook endpoint management and RSA secret rotation;
- A8 API credential management;
- A9 merchant transaction operations;
- A14 ingress abuse controls.

No runtime acceptance required the retired AES environment variable.

### Database workflow

Workflow: `32168309894`: GREEN.

- K5 sandbox fixtures job `95813124039`: GREEN;
- K6/runtime topology job `95813124066`: GREEN;
- pgTAP job `95813123952`: **Files=42, Tests=1304, Result PASS**.

The A17 pgTAP proves:

- `wrapping_key_id` is NOT NULL;
- no AES branch remains in persisted-secret constraints;
- RSA-OAEP-SHA256 remains authoritative;
- direct AES insertion is rejected;
- null wrapping-key insertion is rejected;
- valid RSA row shape is accepted.

## Hosted canonical Supabase deployment

Canonical project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

### Preflight immediately before migration

- webhook endpoints: **0**;
- webhook secret-version rows: **0**;
- legacy AES secret-version rows: **0**;
- Payments: **0**;
- ProviderAttempts: **0**.

Because AES count was zero, the abortive migration gate permitted deployment.

### Applied migration

Supabase migration history records:

- version: `20260818175935`;
- name: `legacy_webhook_aes_secret_retirement`.

### Postflight

Verified on the hosted canonical project:

- webhook endpoints: **0**;
- webhook secret-version rows: **0**;
- legacy AES rows: **0**;
- Payments: **0**;
- ProviderAttempts: **0**;
- `wrapping_key_id` is NOT NULL;
- persisted format constraint is RSA-OAEP-SHA256 only;
- persisted ciphertext constraint is RSA-OAEP-SHA256 shaped;
- `claim_merchant_webhook_deliveries` remains `SECURITY DEFINER`;
- claim routine remains `VOLATILE`;
- claim routine uses `search_path=''`;
- `swiftpay_worker` can execute the claim routine;
- `swiftpay_api`, `anon`, `authenticated` and `service_role` cannot execute it;
- API and worker have no direct SELECT/INSERT/UPDATE/DELETE authority on `webhook_endpoint_secret_versions`;
- API executable app-function capability count remains **24**;
- worker executable app-function capability count remains **6**;
- Supabase Security Advisor: **0 lints**.

## Provider and financial authority

A17 introduced:

- retained-PSP calls: **0**;
- provider bridge bindings: **0**;
- A10 activation promotions: **0**;
- Payment changes in hosted pre/postflight: **0**;
- ProviderAttempt changes in hosted pre/postflight: **0**.

A10 retained-provider runtime authority therefore remains zero.

## Readiness interpretation

A17 closes a pre-launch cryptographic compatibility risk and reduces secret-authority surface, but it does not close the production Pix critical-path blocker: authoritative current PSP contract evidence plus authenticated sandbox proof, provider webhook/recovery/reconciliation and cutover remain outstanding.

Therefore the conservative readiness checkpoint remains:

- core architecture/domain/database/platform foundation: ~99%;
- first end-to-end Pix sandbox MVP: ~97%;
- weighted V1 engineering completion: ~75%;
- production-capable Pix V1 readiness: ~60%.
