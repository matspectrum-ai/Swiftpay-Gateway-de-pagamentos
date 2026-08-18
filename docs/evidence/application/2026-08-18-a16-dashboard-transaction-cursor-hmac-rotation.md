# A16 — Dashboard Transaction Cursor HMAC Rotation — Final Evidence

Date: 2026-08-18

Status: **DONE / GREEN / APPLICATION-ONLY**

## Frozen inputs

- Problem Analysis: `docs/design/a16-dashboard-transaction-cursor-hmac-rotation-problem-analysis.md`
- Specification: `docs/specs/dashboard-transaction-cursor-hmac-rotation-v0.yaml`
- Contract: `docs/contracts/dashboard-transaction-cursor-hmac-rotation-v0.md`
- Fail-first tests: `tests/application/058_a16_dashboard_transaction_cursor_hmac_rotation.contract.test.mjs`
- CLEAN RED evidence: `docs/evidence/application/2026-08-18-a16-dashboard-transaction-cursor-hmac-rotation-red.md`
- CLEAN RED head: `4ea9b267e88b6be67b61ab21ec4ebc3656c7d4d9`
- Accepted behavioral head: `8f181d6b3b3c7a43309e4e36061cf193d082c259`

## Accepted behavior

A16 replaces the A9 single-key cursor-integrity authority with a bounded key-ID-aware rotation boundary while preserving the existing dashboard transaction read contract.

Accepted behavior is:

- current configuration is `SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID` plus `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS`;
- the current keyring contains exactly 1..4 unique `{id, secret}` entries, with one exact active key ID;
- key IDs are bounded non-secret operational identifiers and every secret is at least 32 UTF-8 bytes;
- new cursor issuance uses only the active key and emits `a9v1.<kid>.<payload>.<signature>`;
- the HMAC remains SHA-256 over `a9v1.<kid>.<payload>` and signature comparison remains constant-time;
- v1 verification performs an exact `kid` lookup and one HMAC calculation; trial-all verification is forbidden;
- a retained non-active v1 key continues to verify only the cursors carrying that exact key ID during a rotation overlap window;
- removing a retired v1 key immediately invalidates only cursors carrying that removed key ID;
- pre-A16 `a9v0.<payload>.<signature>` cursors verify only through optional `SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY`;
- the legacy-v0 slot is verify-only and is never used for new issuance;
- removing the legacy-v0 slot immediately invalidates remaining v0 cursors;
- the former `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY` provides no implicit fallback authority;
- merchant ID, environment, normalized filter digest, `createdAt` and Payment ID scope binding remain unchanged;
- malformed, tampered, unknown-key, retired-key and scope/filter mismatch failures remain externally indistinguishable as the existing `invalid_cursor` validation result.

The implementation snapshots validated key authority so later caller mutation cannot change issuance or verification behavior.

## Application GREEN proof

GitHub Actions Application workflow: `32130004275`.

Application contracts job `95689515164`:

- frozen dependency install: GREEN;
- TypeScript typecheck: GREEN;
- build: GREEN;
- total application tests: **336**;
- pass: **336**;
- fail: **0**;
- skipped/todo: **0**;
- A16 contracts: **14/14 PASS**.

The 14 A16 contracts prove configuration exports and bounds, immutable keyring validation, active-only issuance, exact-key v1 verification, overlap rotation, retirement, no trial-all fallback, malformed-token failure normalization, explicit legacy-v0 verification, no current-key fallback for v0, preserved A9 scope/filter binding, production runtime wiring and zero A14/A15/provider-authority expansion.

## Real-database runtime GREEN proof

Application workflow `32130004275` also exercised the real PostgreSQL runtime acceptance path.

The first runtime attempt stopped at the pre-existing A8 concurrent active-credential-limit acceptance race (`concurrent_limit_created_7`) before reaching A9. The failure was outside the A16 scope and no A8 or A16 implementation change was made in response. The failed runtime job alone was rerun.

Isolated rerun job `95689514098`: **GREEN**.

The rerun passed:

- K7 executable runtime bootstrap;
- A1 token authentication;
- A2 Pix create/get runtime;
- A3 paid transition, ledger and balance;
- A4 merchant webhook delivery;
- A6 dashboard authorization;
- A7 webhook endpoint management;
- A8 API credential management;
- A9 merchant transaction operations;
- A14 ingress abuse limiting.

The A9 runtime acceptance ran with the A16 authority variables `SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID` and `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS`. The retired single-key A9 environment variable was not provisioned. The acceptance completed with `A9_ACCEPTANCE_OK dashboard transaction read behavior` and the full A9 real-database acceptance passed.

## Database regression proof

GitHub Actions Database workflow: `32130004397`.

- deterministic sandbox fixture job: GREEN;
- runtime topology/K6 identity checks: GREEN;
- pgTAP: GREEN — **41 files / 1298 assertions**;
- all database tests successful.

A16 introduces no PostgreSQL migration, RPC, privilege or hosted Supabase state change.

## Structural refactor note

The A16 implementation separates stable package facades from canonical core/A16 implementation files. Historical source-scanning tests were migrated to inspect the canonical implementation rather than requiring internal implementation text to remain in facade files. A type-only compatibility marker used for remaining structural assertions is erased from emitted JavaScript and adds no executable fallback, secret authority or runtime side effect.

## Safety and authority result

- A16 database migrations: **0**;
- hosted Supabase changes: **0**;
- retained PSP network calls: **0**;
- provider bridge changes: **none**;
- financial authority changes: **none**;
- A14 abuse-HMAC authority changes: **none**;
- A15 access-token signing authority changes: **none**;
- default A10 runtime-authorized retained-provider operations after A16: **0**.

A16 closes an internal cursor-key lifecycle gap only. It does not prove a current PSP contract, authenticated PSP sandbox traffic, provider webhook/recovery semantics or any production monetary authority. Conservative readiness therefore remains **99% foundation / 97% sandbox MVP / 75% weighted V1 engineering / 60% production-capable Pix V1**.