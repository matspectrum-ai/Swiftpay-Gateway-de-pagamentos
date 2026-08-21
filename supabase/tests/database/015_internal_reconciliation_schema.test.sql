create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(27);

select has_view('app', 'reconciliation_account_cache', 'internal reconciliation must rebuild every account cache from ledger entries');
select has_column('app', 'reconciliation_account_cache', 'account_id', 'account cache reconciliation identifies the canonical account');
select has_column('app', 'reconciliation_account_cache', 'environment', 'account cache reconciliation preserves environment');
select has_column('app', 'reconciliation_account_cache', 'account_type', 'account cache reconciliation preserves canonical account type');
select has_column('app', 'reconciliation_account_cache', 'cached_balance_cents', 'account cache reconciliation exposes cached balance');
select has_column('app', 'reconciliation_account_cache', 'rebuilt_balance_cents', 'account cache reconciliation exposes ledger-rebuilt balance');
select has_column('app', 'reconciliation_account_cache', 'delta_cents', 'account cache reconciliation exposes signed cache delta');
select has_column('app', 'reconciliation_account_cache', 'is_consistent', 'account cache reconciliation exposes parity result');

select has_view('app', 'reconciliation_expected_postings', 'canonical payout/refund state must rebuild required ledger source identities');
select has_column('app', 'reconciliation_expected_postings', 'environment', 'expected posting preserves environment');
select has_column('app', 'reconciliation_expected_postings', 'source_type', 'expected posting identifies canonical source type');
select has_column('app', 'reconciliation_expected_postings', 'source_id', 'expected posting identifies canonical source resource');
select has_column('app', 'reconciliation_expected_postings', 'posting_type', 'expected posting identifies required posting type');
select has_column('app', 'reconciliation_expected_postings', 'resource_state', 'expected posting preserves canonical resource state');

select has_view('app', 'reconciliation_refund_projection', 'Payment refunded projection must be rebuilt from completed first-class Refund resources');
select has_column('app', 'reconciliation_refund_projection', 'payment_id', 'refund projection identifies Payment');
select has_column('app', 'reconciliation_refund_projection', 'cached_refunded_amount_cents', 'refund projection exposes Payment cached aggregate');
select has_column('app', 'reconciliation_refund_projection', 'rebuilt_refunded_amount_cents', 'refund projection exposes completed Refund aggregate');
select has_column('app', 'reconciliation_refund_projection', 'delta_cents', 'refund projection exposes signed aggregate drift');
select has_column('app', 'reconciliation_refund_projection', 'is_consistent', 'refund projection exposes parity result');

select has_view('app', 'internal_reconciliation_findings', 'internal reconciliation must expose deterministic read-only findings');
select has_column('app', 'internal_reconciliation_findings', 'environment', 'finding preserves environment');
select has_column('app', 'internal_reconciliation_findings', 'discrepancy_type', 'finding classifies discrepancy');
select has_column('app', 'internal_reconciliation_findings', 'stable_key', 'finding exposes deterministic logical identity');
select has_column('app', 'internal_reconciliation_findings', 'resource_type', 'finding identifies canonical resource type when applicable');
select has_column('app', 'internal_reconciliation_findings', 'resource_id', 'finding identifies canonical resource id when applicable');
select has_column('app', 'internal_reconciliation_findings', 'detail', 'finding exposes non-secret operational detail');

select * from finish();
rollback;
