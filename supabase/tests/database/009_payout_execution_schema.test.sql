create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(9);

select has_column('app', 'payout_attempts', 'request_fingerprint', 'payout attempt must snapshot normalized provider request identity');
select has_column('app', 'payout_attempts', 'provider_status_raw', 'payout attempt must retain normalized raw provider status evidence');
select has_column('app', 'payout_attempts', 'provider_cost_cents', 'payout attempt must persist authoritative provider Pix-out cost when known');
select has_column('app', 'payout_attempts', 'started_at', 'payout attempt execution start must be auditable');
select has_column('app', 'payout_attempts', 'finished_at', 'payout attempt terminal time must be auditable');
select has_column('app', 'payout_attempts', 'last_error_class', 'payout attempt must persist normalized error class');
select has_column('app', 'payout_attempts', 'last_error_code', 'payout attempt must persist normalized error code');

select has_function(
  'app', 'prepare_payout_attempt',
  array['uuid','uuid','uuid','text','text','timestamp with time zone'],
  'provider payout operation identity must be prepared durably before execution'
);
select has_function(
  'app', 'claim_payout_attempt',
  array['uuid','timestamp with time zone','timestamp with time zone'],
  'prepared payout attempt must have an explicit one-time execution claim boundary'
);

select * from finish();
rollback;
