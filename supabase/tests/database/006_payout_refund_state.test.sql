create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(29);

select has_table('app', 'payout_accounts', 'approved payout destinations must persist independently');
select has_table('app', 'payouts', 'payouts must be first-class resources');
select has_table('app', 'payout_attempts', 'provider payout execution identity must persist separately');
select has_table('app', 'refunds', 'refunds must be first-class resources');
select has_table('app', 'refund_attempts', 'provider refund execution identity must persist separately');
select has_column('app', 'payouts', 'merchant_id', 'payout merchant ownership must be explicit');
select has_column('app', 'payouts', 'environment', 'payout environment must be explicit');
select has_column('app', 'payouts', 'amount_cents', 'payout amount must use integer cents');
select has_column('app', 'payouts', 'merchant_fee_cents', 'payout fee snapshot must persist');
select has_column('app', 'payouts', 'recipient_amount_cents', 'recipient amount snapshot must persist');
select has_column('app', 'payouts', 'state', 'payout certainty state must persist');
select has_column('app', 'payouts', 'destination_snapshot', 'immutable payout destination snapshot must persist');
select has_column('app', 'payouts', 'idempotency_key', 'payout request idempotency identity must persist');
select has_column('app', 'payments', 'refund_fee_policy', 'Payment must snapshot the refund fee policy before refunds are enabled');
select has_column('app', 'refunds', 'payment_id', 'refund must reference its paid Payment');
select has_column('app', 'refunds', 'merchant_id', 'refund merchant ownership must be explicit');
select has_column('app', 'refunds', 'environment', 'refund environment must be explicit');
select has_column('app', 'refunds', 'amount_cents', 'refund amount must use integer cents');
select has_column('app', 'refunds', 'state', 'refund certainty state must persist');
select has_column('app', 'refunds', 'idempotency_key', 'refund request idempotency identity must persist');
select has_column('app', 'refunds', 'fee_policy_version', 'refund economics policy snapshot/version must persist');
select has_index('app', 'payouts', 'payouts_request_idempotency_uq', 'payout create idempotency must be database enforced');
select has_index('app', 'refunds', 'refunds_request_idempotency_uq', 'refund create idempotency must be database enforced');
select has_index('app', 'payout_attempts', 'payout_attempts_unresolved_uq', 'one unresolved payout execution attempt must be enforced');
select has_index('app', 'refund_attempts', 'refund_attempts_unresolved_uq', 'one unresolved refund execution attempt must be enforced');
select has_function('app', 'reserve_payout', array['uuid','text','text','bigint','bigint','jsonb','text','text','timestamp with time zone'], 'atomic payout reservation boundary must exist');
select has_function('app', 'resolve_payout', array['uuid','text','uuid','timestamp with time zone'], 'payout evidence resolution boundary must exist');
select has_function('app', 'reserve_refund', array['uuid','uuid','text','bigint','text','text','timestamp with time zone'], 'atomic refund reservation boundary must exist');
select has_function('app', 'resolve_refund', array['uuid','text','uuid','timestamp with time zone'], 'refund evidence resolution boundary must exist');

select * from finish();
rollback;
