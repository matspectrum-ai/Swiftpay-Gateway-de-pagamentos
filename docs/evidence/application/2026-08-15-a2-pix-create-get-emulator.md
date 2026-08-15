# SwiftPay V2 — A2 Pix create/get emulator acceptance evidence

Date: 2026-08-15

Slice: `pix-create-get-emulator-v0`

Status: **DONE / GREEN**

## Scope accepted

A2 establishes the first authenticated merchant-usable Pix creation/status path in sandbox without calling a live PSP.

Accepted public boundary:

- `POST /v1/transactions`;
- `GET /v1/transactions/:id`;
- A1 Bearer authentication and current database revalidation before the payment operation;
- merchant/environment scoping;
- required `Idempotency-Key` for create;
- deterministic request hashing;
- PostgreSQL-backed idempotency and atomic ProviderAttempt execution claim;
- deterministic `swiftpay_emulator` execution;
- public Payment projection with no provider secret/internal execution token leakage;
- deterministic success/pending, execution-unknown and definitive-rejection semantics;
- sandbox-only creation;
- no ledger, job, merchant-webhook or live-provider side effects.

Canonical specs:

- `docs/specs/pix-create-get-emulator-v0.yaml`;
- `docs/specs/pix-create-get-emulator-fixture-v0.yaml`.

## TDD evidence

The slice was implemented through explicit RED -> GREEN stages.

Database behavior RED reached a clean full run of 48 assertions before implementation, with the A2 routines still fail-closed. The first behavior implementation then exposed two PostgreSQL compatibility defects that were fixed without weakening the contract:

1. `pg_catalog.jsonb_object_length(jsonb)` is not available in the canonical PostgreSQL 17 environment; exact nine-key pricing validation now counts `pg_catalog.jsonb_object_keys`;
2. `COALESCE` is expression syntax, not a schema-qualified function; successful resolution now uses native `coalesce(...)`.

Application RED stages independently covered:

- Pix request primitives/hash/emulator;
- payment service orchestration;
- trusted database adapter;
- protected Fastify routes;
- production runtime composition.

## Database implementation

Canonical hosted Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

A2 migrations are applied remotely and Git filenames are aligned to the actual migration history:

- `20260815101512_pix_create_get_emulator_foundation.sql`;
- `20260815101609_pix_create_get_emulator_behavior.sql`;
- `20260815101641_pix_create_get_emulator_prepare_key_count_fix.sql`;
- `20260815101729_pix_create_get_emulator_resolve_coalesce_fix.sql`.

The foundation adds the frozen Payment pricing/routing snapshots and ProviderAttempt recovery timestamp, plus four narrow trusted routines:

- `app.prepare_api_pix_payment(...)`;
- `app.claim_api_pix_attempt(...)`;
- `app.resolve_api_pix_attempt(...)`;
- `app.get_api_payment(...)`.

Remote verification after migration application confirmed:

- all six A2 columns present;
- exactly four A2 trusted API routines present;
- `swiftpay_api` can execute all four;
- `swiftpay_worker`, `anon`, `authenticated` and `service_role` cannot execute them;
- prepare uses the PostgreSQL-17-compatible `jsonb_object_keys` count;
- resolve contains native `coalesce(...)` and no `pg_catalog.coalesce` reference.

The deterministic emulator provider account remains a **test-only runtime fixture**. It was not added to the canonical K5 seed or canonical hosted data.

## Application implementation

A2 adds a provider-independent payment application package and keeps SQL behind `@swiftpay/db` trusted-routine adapters.

Important properties:

- validation never invents customer data;
- canonical hash uses the frozen ordered vector;
- externalId is independent from idempotency identity;
- application code never directly mutates `app.payments`, `app.provider_attempts` or `app.request_idempotency`;
- production principals fail closed before payment/emulator side effects;
- emulator output is visibly non-payable (`SWIFTPAY_EMULATOR_*`);
- ambiguous execution remains `execution_unknown`/recovery-required rather than being fabricated as failure.

## Final CI evidence

Final pre-version-alignment acceptance runs:

- Application contracts workflow: `31877334094` — GREEN;
- Database contracts workflow: `31877334073` — GREEN.

Application lane:

- frozen pnpm install: PASS;
- TypeScript typecheck: PASS;
- build: PASS;
- **91/91 application contracts: PASS**;
- K7 real runtime database acceptance: PASS;
- A1 real token authentication acceptance: PASS;
- A2 real Pix runtime acceptance: PASS.

Database lane:

- canonical pgTAP: **33 files / 1140 tests / PASS**;
- K5 sandbox fixture contracts: PASS;
- K6 trusted runtime topology: PASS.

The A2 real runtime acceptance starts **two independent API processes** against the same isolated PostgreSQL database, obtains a real Bearer through `/v1/auth/token`, and proves:

- concurrent same-key create race returns `201/202` while converging on one logical Payment;
- exactly one ProviderAttempt executes the emulator;
- replay returns the same completed resource without a second emulator execution;
- same key with a different request returns `409 idempotency_key_reused`;
- owner GET returns the Payment;
- foreign merchant GET returns `404 resource_not_found`;
- production create returns `403 operation_forbidden`;
- ledger transactions, jobs, merchant webhook events and provider events remain unchanged by A2;
- emulator/runtime secrets are absent from API logs.

Runtime marker from CI:

`A2 create race statuses: 201/202`

`SwiftPay A2 real runtime acceptance: OK`

## Closure

A2 is complete. SwiftPay V2 now has an authenticated, durable, process-safe sandbox Pix create/get path with deterministic provider execution.

A2 deliberately does **not** mark a Pix as paid and does not create financial ledger effects. The next critical slice is A3: canonical paid transition -> exactly-once ledger posting -> merchant balance/read model.
