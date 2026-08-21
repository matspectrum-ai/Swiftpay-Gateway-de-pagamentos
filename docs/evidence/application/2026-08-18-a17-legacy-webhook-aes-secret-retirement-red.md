# A17 — Legacy Webhook AES Secret Retirement — CLEAN RED Evidence

Date: 2026-08-18

Status: **CLEAN RED RECORDED**

Implementation authority: **GRANTED for the frozen A17 contract only**

Problem Analysis: `docs/design/a17-legacy-webhook-aes-secret-retirement-problem-analysis.md`
Specification: `docs/specs/legacy-webhook-aes-secret-retirement-v0.yaml`
Contract: `docs/contracts/legacy-webhook-aes-secret-retirement-v0.md`

## RED head

Branch: `agent/foundation-phase-0`
Commit: `9ec9a136c3c7107256e956af4d2ee81e11fbb6c2`

The initial fail-first checkpoint contained one false source-isolation assertion that scanned the pre-A16 config file for A16 symbols. That scanner was corrected without changing production behavior. The clean RED below is the first implementation-authorizing checkpoint.

## Application contracts

GitHub Actions workflow: `Application contracts`
Run: `32132973913`
Job: `application-contracts` (`95697953334`)

Result: **expected failure**

- Typecheck: GREEN
- Build: GREEN
- Application tests: **343 total / 337 PASS / 6 FAIL / 0 skipped / 0 todo**
- All six failures are A17-intended.

Exact A17 RED gaps:

1. worker config still defines/requires `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY` and exposes the legacy AES config field;
2. worker runtime still exposes/passes `webhookEncryptionKey` / `encryptionKey` into delivery composition;
3. `@swiftpay/webhooks` still exports executable persisted-secret AES decrypt authority;
4. explicit `aes-256-gcm-v1` claim material still reaches transport instead of terminating before network;
5. missing ciphertext format still defaults to legacy AES behavior;
6. A4/A7 real-runtime acceptance fixtures still depend on the retired AES environment/runtime path.

The A17 authority-isolation contract for A14/A15/A16/provider boundaries is GREEN.
All unrelated pre-A17 application contracts remain GREEN.

## Real runtime regression gate

Same workflow run: `32132973913`
Job: `runtime-database-acceptance` (`95697953343`)

Result: **GREEN**

The following real-database acceptances all completed successfully on the same RED head:

- K7 runtime database boundary
- A1 token authentication
- A2 Pix runtime
- A3 paid ledger/balance
- A4 merchant webhook runtime
- A6 dashboard authorization
- A7 webhook endpoint management
- A8 API credential management
- A9 merchant transaction operations
- A14 ingress abuse hardening

This proves the RED is not caused by an unrelated runtime regression.

## Database contracts

GitHub Actions workflow: `Database contracts`
Run: `32132973982`

- `sandbox-fixtures` (`95697953707`): GREEN
- `runtime-topology` (`95697953810`): GREEN
- `pgtap` (`95697953847`): expected failure

pgTAP result: **42 files / 1301 assertions, only A17 contract RED**.

The new `042_legacy_webhook_aes_secret_retirement.test.sql` has 3 assertions; exactly 2 fail:

1. `app.webhook_endpoint_secret_versions.wrapping_key_id` is still nullable;
2. the persisted-secret constraint still contains an `aes-256-gcm-v1` compatibility branch.

The RSA format assertion is already GREEN. All previous 41 database contract files remain GREEN.

## TDD decision

The frozen A17 contract now has a clean fail-first checkpoint. Minimal implementation is authorized only for the defined retirement slice:

- remove legacy AES worker/config/runtime authority;
- make RSA private-keyring worker authority mandatory;
- remove executable AES decrypt exports/path from production webhooks code;
- reject AES/missing-format delivery claims before endpoint policy/network;
- migrate A4/A7 production-path fixtures to RSA-wrapped secret history;
- add one forward-only database migration that aborts if any AES persisted secret exists and narrows secret-version rows to RSA-only with non-null wrapping-key IDs;
- preserve all provider, payment, ledger, retry, fencing and merchant webhook HMAC behavior.

No retained-PSP network call, provider activation, Payment mutation expansion or financial authority is authorized by this evidence.