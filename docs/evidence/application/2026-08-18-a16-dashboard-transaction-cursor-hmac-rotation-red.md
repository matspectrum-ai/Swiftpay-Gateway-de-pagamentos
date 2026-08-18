# A16 — Dashboard Transaction Cursor HMAC Rotation — CLEAN RED Evidence

Date: 2026-08-18

Status: **TDD RED / IMPLEMENTATION AUTHORIZED**

## Frozen inputs

- Problem Analysis: `docs/design/a16-dashboard-transaction-cursor-hmac-rotation-problem-analysis.md`
- Spec: `docs/specs/dashboard-transaction-cursor-hmac-rotation-v0.yaml`
- Contract: `docs/contracts/dashboard-transaction-cursor-hmac-rotation-v0.md`
- Fail-first tests: `tests/application/058_a16_dashboard_transaction_cursor_hmac_rotation.contract.test.mjs`
- RED head: `4ea9b267e88b6be67b61ab21ec4ebc3656c7d4d9`

## Application RED proof

GitHub Actions Application workflow: `32123937524`.

- install with frozen lockfile: GREEN;
- TypeScript typecheck: GREEN;
- build: GREEN;
- application contracts: expected RED;
- total tests: **336**;
- pass: **323**;
- fail: **13**;
- all **322 pre-A16 contracts** remained GREEN;
- one A16 isolation/non-authority test was already satisfied;
- all 13 failures were A16 configuration/keyring/token-format/runtime-wiring capabilities that had not yet been implemented.

The failures were specifically caused by the still-existing single `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY` configuration and `a9v0` single-key codec/runtime wiring. No unrelated A1-A15 behavior failed.

## Runtime regression proof

The `runtime-database-acceptance` job in Application workflow `32123937524` was GREEN:

- K7 runtime bootstrap: PASS;
- A1 token authentication: PASS;
- A2 Pix runtime: PASS;
- A3 paid/ledger/balance: PASS;
- A4 merchant webhook runtime: PASS;
- A6 dashboard authorization: PASS;
- A7 webhook endpoint management: PASS;
- A8 API credential management: PASS;
- A9 merchant transaction operations: PASS;
- A14 ingress abuse acceptance: PASS.

## Database regression proof

GitHub Actions Database workflow: `32123937574`.

- pgTAP: GREEN — **41 files / 1298 assertions**;
- K5 deterministic sandbox fixtures: GREEN;
- K6 runtime topology: GREEN.

A16 introduces no database migration or privilege change.

## Authorization decision

The RED is clean and behaviorally isolated. Minimal A16 implementation is authorized for:

- dashboard cursor HMAC keyring configuration;
- `a9v1.<kid>.<payload>.<signature>` issuance/verification;
- explicit verify-only `a9v0` migration slot;
- API runtime/bootstrap wiring;
- synchronization of historical A9 test/runtime fixtures that are deliberately superseded by the frozen A16 contract.

No database, provider, financial, A14 or A15 authority change is authorized.