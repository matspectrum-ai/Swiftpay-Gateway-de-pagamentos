# Database contract tests

These pgTAP tests are written before the migrations they specify.

Run with:

```bash
supabase test db
```

The database foundation is implemented incrementally. Each numbered suite is introduced RED and the corresponding migration must make it GREEN without weakening previous contracts.

Current sequence:

1. `001_core_schema.test.sql` — merchant/KYC/provider configuration and core identities;
2. `002_payment_integrity.test.sql` — request idempotency, Payment and ProviderAttempt/Event integrity;
3. `003_ledger.test.sql` — canonical double-entry accounts, source idempotency and atomic cached balances;
4. durable jobs/outbox — next slice, after ledger is green;
5. merchant webhook persistence;
6. payout/refund financial state;
7. reconciliation.

A migration must not pre-implement a later slice merely to make a broader test file green. Financial and async primitives are kept separate so their invariants can be reviewed and proven independently.
