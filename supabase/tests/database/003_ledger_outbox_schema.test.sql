create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(23);

-- Ledger and durable-work tables must exist before financial posting code is written.
select has_table('app', 'accounts', 'canonical ledger accounts table must exist');
select has_table('app', 'ledger_transactions', 'ledger transaction headers must exist');
select has_table('app', 'ledger_entries', 'immutable ledger entries must exist');
select has_table('app', 'outbox_jobs', 'durable PostgreSQL jobs/outbox table must exist');

-- Financial/source identity must be database-enforced.
select has_index('app', 'accounts', 'accounts_identity_uq', 'account identity must be unique, including platform/null scope');
select has_index('app', 'ledger_transactions', 'ledger_transactions_source_uq', 'one posting per canonical financial source identity');
select has_index('app', 'outbox_jobs', 'outbox_jobs_dedupe_uq', 'one durable job per logical dedupe identity');

-- Accounts explicitly separate ownership from provider location and cache an integer-cent balance.
select has_column('app', 'accounts', 'scope_type', 'account scope type must be explicit');
select has_column('app', 'accounts', 'scope_id', 'account scope identity must be explicit');
select has_column('app', 'accounts', 'account_type', 'account semantic type must be explicit');
select has_column('app', 'accounts', 'category', 'asset/liability/revenue/expense category must be explicit');
select has_column('app', 'accounts', 'normal_side', 'debit/credit natural side must be explicit');
select has_column('app', 'accounts', 'balance_cents', 'cached account balance must use integer centavos');

-- Ledger source identity is not inferred from amount or mutable status.
select has_column('app', 'ledger_transactions', 'source_type', 'ledger source type must exist');
select has_column('app', 'ledger_transactions', 'source_id', 'ledger source id must exist');
select has_column('app', 'ledger_transactions', 'posting_type', 'ledger posting type must exist');
select has_column('app', 'ledger_entries', 'direction', 'ledger entry debit/credit direction must exist');
select has_column('app', 'ledger_entries', 'amount_cents', 'ledger entry amount must use integer centavos');

-- Durable work exposes explicit claim/retry state instead of hidden framework retry.
select has_column('app', 'outbox_jobs', 'dedupe_key', 'outbox logical dedupe key must exist');
select has_column('app', 'outbox_jobs', 'state', 'outbox state must exist');
select has_column('app', 'outbox_jobs', 'attempt_count', 'outbox attempt accounting must exist');
select has_column('app', 'outbox_jobs', 'lease_token', 'outbox lease ownership token must exist');
select has_column('app', 'outbox_jobs', 'lease_expires_at', 'outbox lease expiry must exist');

select * from finish();
rollback;
