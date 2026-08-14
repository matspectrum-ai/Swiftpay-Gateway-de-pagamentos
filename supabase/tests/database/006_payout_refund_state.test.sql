create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(30);

-- Slice H starts RED: first-class payout/refund resources and atomic financial
-- boundaries must exist before provider/application execution is introduced.
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

select has_function(
  'app', 'reserve_payout',
  array['uuid','text','text','bigint','bigint','jsonb','text','text','timestamp with time zone'],
  'atomic payout creation plus available-to-blocked reservation boundary must exist'
);
select has_function(
  'app', 'resolve_payout',
  array['uuid','text','uuid','timestamp with time zone'],
  'payout terminal/unknown evidence boundary must exist'
);
select has_function(
  'app', 'reserve_refund',
  array['uuid','uuid','text','bigint','text','text','timestamp with time zone'],
  'atomic refundable-limit check plus refund funding reservation boundary must exist'
);
select has_function(
  'app', 'resolve_refund',
  array['uuid','text','uuid','timestamp with time zone'],
  'refund terminal/unknown evidence boundary must exist'
);

-- Schema-level money/state invariants are part of the RED contract even before
-- full behavioral/concurrency fixtures are added in the GREEN follow-up.
select throws_ok(
  $$insert into app.payouts (
      merchant_id, environment, currency, amount_cents, merchant_fee_cents,
      recipient_amount_cents, state, destination_snapshot, idempotency_key,
      request_fingerprint
    ) values (
      gen_random_uuid(), 'production', 'BRL', 0, 0, 0, 'requested', '{}'::jsonb,
      'bad-zero', 'bad-zero'
    )$$,
  '23514', null,
  'payout amount must be strictly positive'
);

select throws_ok(
  $$insert into app.refunds (
      payment_id, merchant_id, environment, currency, amount_cents, state,
      idempotency_key, request_fingerprint, fee_policy_version
    ) values (
      gen_random_uuid(), gen_random_uuid(), 'production', 'BRL', -1, 'requested',
      'bad-negative', 'bad-negative', 'v1'
    )$$,
  '23514', null,
  'refund amount must be strictly positive'
);

select * from finish();
rollback;
