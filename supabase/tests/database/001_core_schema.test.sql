begin;

select plan(18);

select has_schema('swiftpay', 'private SwiftPay schema must exist');
select has_table('swiftpay', 'merchants', 'merchants table must exist');
select has_table('swiftpay', 'payments', 'payments table must exist');
select has_table('swiftpay', 'request_idempotency', 'request idempotency table must exist');
select has_table('swiftpay', 'provider_attempts', 'provider attempts table must exist');
select has_table('swiftpay', 'provider_events', 'provider events table must exist');
select has_table('swiftpay', 'accounts', 'ledger accounts table must exist');
select has_table('swiftpay', 'ledger_transactions', 'ledger transactions table must exist');
select has_table('swiftpay', 'ledger_entries', 'ledger entries table must exist');
select has_table('swiftpay', 'outbox_jobs', 'durable outbox/jobs table must exist');
select has_table('swiftpay', 'api_credentials', 'merchant API credentials table must exist');
select has_table('swiftpay', 'kyc_cases', 'KYC cases table must exist');
select has_table('swiftpay', 'refunds', 'refund resources must exist');
select has_table('swiftpay', 'payouts', 'payout resources must exist');
select has_table('swiftpay', 'webhook_events', 'merchant webhook events must exist');
select has_table('swiftpay', 'webhook_deliveries', 'merchant webhook deliveries must exist');
select has_index('swiftpay', 'request_idempotency', 'request_idempotency_scope_uq', 'idempotency scope must be database-unique');
select has_index('swiftpay', 'provider_attempts', 'provider_attempts_one_unresolved_uq', 'one unresolved provider create attempt per payment must be enforced');

select * from finish();
rollback;
