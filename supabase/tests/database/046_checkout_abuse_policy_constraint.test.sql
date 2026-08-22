create extension if not exists pgtap with schema extensions;

begin;
select plan(14);

create function pg_temp.a24_policy_insert_succeeds(p_policy text, p_hash text)
returns boolean
language plpgsql
as $$
begin
  insert into app.api_abuse_windows(policy, subject_hash, window_started_at, request_count, updated_at)
  values (p_policy, p_hash, pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp());
  return true;
exception when check_violation then
  return false;
end;
$$;

select ok(pg_temp.a24_policy_insert_succeeds('token_exchange_pre_auth', repeat('a', 64)),
  'A24 preserves token_exchange_pre_auth in the quota table vocabulary');
select ok(pg_temp.a24_policy_insert_succeeds('machine_request_pre_auth', repeat('b', 64)),
  'A24 preserves machine_request_pre_auth in the quota table vocabulary');
select ok(pg_temp.a24_policy_insert_succeeds('machine_read', repeat('c', 64)),
  'A24 preserves machine_read in the quota table vocabulary');
select ok(pg_temp.a24_policy_insert_succeeds('machine_mutation', repeat('d', 64)),
  'A24 preserves machine_mutation in the quota table vocabulary');
select ok(pg_temp.a24_policy_insert_succeeds('dashboard_request_pre_auth', repeat('e', 64)),
  'A24 preserves dashboard_request_pre_auth in the quota table vocabulary');
select ok(pg_temp.a24_policy_insert_succeeds('checkout_request_pre_auth', repeat('f', 64)),
  'A24 adds checkout_request_pre_auth to the quota table vocabulary');
select ok(pg_temp.a24_policy_insert_succeeds('readiness_probe', repeat('0', 64)),
  'A24 preserves readiness_probe in the quota table vocabulary');
select ok(not pg_temp.a24_policy_insert_succeeds('not_a_swiftpay_policy', repeat('1', 64)),
  'A24 keeps unknown quota policy values rejected by the table CHECK');

create function pg_temp.a24_checkout_quota_call_succeeds()
returns boolean
language plpgsql
as $$
begin
  perform * from app.consume_api_abuse_quota('checkout_request_pre_auth', repeat('2', 64), null);
  return true;
exception when others then
  return false;
end;
$$;

select ok(pg_temp.a24_checkout_quota_call_succeeds(),
  'A24 checkout_request_pre_auth executes through the real quota routine');
select is(
  (select count(*) from app.api_abuse_windows where policy='checkout_request_pre_auth' and subject_hash=repeat('2', 64)),
  1::bigint,
  'A24 first checkout quota call materializes exactly one canonical row'
);
select is(
  (select request_count from app.api_abuse_windows where policy='checkout_request_pre_auth' and subject_hash=repeat('2', 64)),
  1,
  'A24 first checkout quota call consumes exactly one request'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and has_function_privilege('swiftpay_api', p.oid, 'EXECUTE')),
  30::bigint,
  'A24 does not change the post-A23 swiftpay_api capability count'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app' and has_function_privilege('swiftpay_worker', p.oid, 'EXECUTE')),
  6::bigint,
  'A24 does not change the swiftpay_worker capability count'
);
select ok(
  (select count(*) from app.payments) = 0
  and (select count(*) from app.provider_attempts) = 0
  and (select count(*) from app.ledger_transactions) = 0,
  'A24 quota constraint acceptance creates no financial/provider state'
);

select * from finish();
rollback;
