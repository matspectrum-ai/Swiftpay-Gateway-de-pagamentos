# K5 — Deterministic Local Sandbox Seed Fixtures Evidence

Date: 2026-08-15

Branch: `agent/foundation-phase-0`

Managed Supabase impact: **none**. K5 is intentionally local-only and is not a migration.

## Scope

K5 provides one deterministic, repeatable local sandbox identity/configuration fixture for upcoming API/worker acceptance tests without contaminating the canonical empty-baseline database-contract suite.

Specification: `docs/specs/local-sandbox-seed-fixtures-v0.yaml`.

## Fixture contents

The fixture creates only:

- synthetic Auth identity `51000000-0000-0000-0000-000000000001` with `local-sandbox-owner@example.test`;
- active merchant `50000000-0000-0000-0000-000000000001`;
- active `owner` merchant membership;
- approved KYC case `52000000-0000-0000-0000-000000000001` using requirement profile `local-sandbox-v1`;
- provider catalog identities for `akkadpag` and `flevopay`.

It deliberately creates no:

- API credential;
- provider account or provider credential;
- KYC document/Storage object;
- Payment/provider attempt/provider event;
- account/ledger transaction;
- payout/refund;
- durable job;
- merchant webhook event;
- reconciliation state;
- operational audit event.

## Local-only loading boundary

Fixture SQL: `supabase/seeds/local-sandbox.sql`.

Loader: `scripts/seed-local-sandbox`.

The loader uses exactly:

`postgresql://postgres:postgres@127.0.0.1:54322/postgres`

There is no environment-variable override, project ref, linked-project fallback or managed database URL. This prevents K5 from becoming an accidental production seeding path.

`supabase/config.toml` continues with automatic database seeding disabled. Loading is explicit.

## TDD evidence

Spec commit: `7f3fdaedc22e60af7939c33bb3dd3114b53a56f1`.

Fixture contract:

- `supabase/tests/fixtures/001_local_sandbox_seed.test.sql`;
- 20 assertions;
- commit `93a6cf561be3155637944652042d56cbd2feac16`.

CI harness isolation:

- canonical database suite explicitly scopes to `supabase/tests/database`;
- fixture suite scopes separately to `supabase/tests/fixtures`;
- harness refactor run #126 preserved the baseline at **29 files / 973 tests / PASS**.

### RED

CI run #128 (`31864160484`):

- canonical `pgtap` job remained GREEN;
- `sandbox-fixtures` failed at the expected missing implementation boundary:
  `bash: scripts/seed-local-sandbox: No such file or directory`;
- fixture assertions did not execute prematurely.

### GREEN

Implementation commit: `458c0048816b34e2226ae3bcf0e972b770731636`.

CI run #129 (`31864302179`):

Canonical database lane:

- job `94962784065`;
- `Files=29, Tests=973`;
- `All tests successful.`;
- `Result: PASS`.

Sandbox fixture lane:

- job `94962784058`;
- fixture loader executed successfully;
- fixture loader executed a second time successfully, proving repeated-load convergence;
- `Files=1, Tests=20`;
- `All tests successful.`;
- `Result: PASS`.

## Security / data notes

- all identities are fixed synthetic UUIDs;
- email uses the reserved example form `example.test`;
- no real PII, public/secret API keys, provider tokens, withdrawal keys, webhook secrets or document material are versioned;
- approved KYC is synthetic test state only;
- provider rows are catalog identity, not executable provider configuration;
- K5 did not change or seed the canonical managed `swiftpay v2` project.

## Conclusion

K5 is `DONE`.

The local environment now has a deterministic merchant/Auth/KYC/provider-catalog fixture suitable for the first executable API/worker acceptance harness, while the canonical 973-test database suite remains seed-free and unchanged.