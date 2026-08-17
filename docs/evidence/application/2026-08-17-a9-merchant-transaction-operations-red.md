# SwiftPay V2 — A9 Merchant Transaction Operations — Clean RED Evidence

Date: 2026-08-17  
Status: **CLEAN RED — IMPLEMENTATION AUTHORIZED NEXT**

## Frozen inputs

- Problem Analysis: `docs/design/a9-merchant-transaction-operations-problem-analysis.md`
- YAML specification: `docs/specs/merchant-transaction-operations-v0.yaml`
- Application/HTTP contract: `docs/contracts/merchant-transaction-operations-v0.md`
- Database contract: `docs/contracts/merchant-transaction-operations-database-v0.md`
- Application fail-first tests: `tests/application/047_a9_merchant_transaction_operations.contract.test.mjs`
- Database fail-first tests: `supabase/tests/database/040_merchant_transaction_operations.test.sql`

No A9 implementation or migration existed at this checkpoint. No A9 migration was applied to the hosted Supabase project.

## Application RED

Workflow: `32005108260`  
Job: `95312863787`

Pre-test gates:

- dependency install: GREEN;
- TypeScript typecheck: GREEN;
- build: GREEN.

Application test result:

```text
tests 236
pass 226
fail 10
```

All pre-A9 application contracts remained GREEN. The only failures were the ten new A9 assertions.

Failure classes were exactly expected missing behavior:

- A9 exported query/cursor/read-service/store factories were absent;
- A9 query validator/cursor codec were absent;
- A9 dashboard transaction store was absent;
- A9 read service was absent and the fail-first harness returned `behavior_not_implemented`;
- A9 dashboard routes were absent and returned 404 instead of the frozen success/error behavior.

There were no parser, TypeScript, build, module-resolution or test-harness failures.

## Database RED

Workflow: `32005108254`  
Job: `95312863819`

All migrations through hosted-equivalent A8 state applied successfully in isolated PostgreSQL before pgTAP.

Database result:

```text
Files=40
Tests=1292
Result: FAIL
```

Files `001` through `039` were GREEN. Only `040_merchant_transaction_operations.test.sql` failed, exactly 4/4 assertions:

1. `app.list_dashboard_transactions` exact signature absent;
2. `app.get_dashboard_transaction` exact signature absent;
3. `payments_dashboard_status_created_idx` absent;
4. `payments_dashboard_external_id_created_idx` absent.

The A9 pgTAP file parsed and executed normally. The failure was structural behavior absence, not SQL/harness failure.

## Regression proof

Application runtime-database acceptance job `95312863871`: **GREEN**.

It re-proved:

- K7 executable runtime;
- A1 real token authentication;
- A2 real Pix runtime;
- A3 paid transition / ledger / balance;
- A4 merchant webhook delivery;
- A6 dashboard authorization;
- A7 webhook endpoint management;
- A8 API credential management.

Database workflow also proved:

- K5 deterministic sandbox fixtures: GREEN;
- K6 runtime topology and role identities: GREEN.

Therefore the fail-first changes did not regress the accepted A1–A8 executable path.

## Contract correction made before RED

During spec/contract review, the original idea of a raw `external_id` composite B-tree index was rejected because A2 never froze a maximum `externalId` length. Such an index could introduce a new write-time failure for an existing valid large reference.

The frozen A9 contract instead uses fixed-width `md5(external_id)` expression coverage plus mandatory exact original-text equality. The digest is only an index discriminator; exact equality remains authoritative, so hash collision cannot change query correctness.

## Authorization to proceed

The A9 specification/contracts are frozen and clean RED is proven. The next permitted step is the smallest implementation required to turn these exact A9 failures GREEN, followed by refactor and isolated real-database acceptance.

Hosted deployment remains forbidden until local/CI GREEN and the A9 post-implementation evidence gates are satisfied.