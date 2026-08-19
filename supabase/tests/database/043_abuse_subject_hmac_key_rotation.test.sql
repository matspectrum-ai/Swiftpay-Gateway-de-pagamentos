create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(21);

select has_function(
  'app', 'consume_api_abuse_quota', array['text','text','text'],
  'A18 trusted quota routine must expose active plus optional previous hash parameters'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname = 'consume_api_abuse_quota'
  ),
  1,
  'A18 must keep exactly one canonical quota routine instead of an overload set'
);

select is(
  (
    select p.pronargdefaults::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname = 'consume_api_abuse_quota'
  ),
  1,
  'A18 previous hash parameter must have exactly one trailing default for A14 caller compatibility'
);

select is(
  (
    select count(*)::integer
    from information_schema.routine_privileges
    where routine_schema = 'app'
      and routine_name = 'consume_api_abuse_quota'
      and grantee = 'swiftpay_api'
      and privilege_type = 'EXECUTE'
  ),
  1,
  'A18 swiftpay_api keeps exactly one quota-routine EXECUTE capability'
);

select is(
  (
    select count(*)::integer
    from information_schema.routine_privileges
    where routine_schema = 'app'
      and routine_name = 'consume_api_abuse_quota'
      and grantee in ('PUBLIC','anon','authenticated','service_role','swiftpay_worker')
      and privilege_type = 'EXECUTE'
  ),
  0,
  'A18 quota routine remains unavailable to public/Data API/service-role/worker identities'
);

create temporary table a18_decision (
  allowed boolean not null,
  remaining integer not null,
  retry_after_seconds integer not null
) on commit drop;

-- Backward-compatible A14 two-argument call via the defaulted third argument.
delete from app.api_abuse_windows
where policy = 'token_exchange_pre_auth'
  and subject_hash = repeat('a', 64);

insert into a18_decision
select * from app.consume_api_abuse_quota(
  'token_exchange_pre_auth',
  repeat('a', 64)
);

select is((select allowed from a18_decision), true,
  'A18 keeps old two-argument A14 quota invocations executable');
select is((select remaining from a18_decision), 29,
  'A18 old two-argument invocation preserves the A14 token pre-auth limit');
select is(
  (
    select request_count
    from app.api_abuse_windows
    where policy = 'token_exchange_pre_auth'
      and subject_hash = repeat('a', 64)
  ),
  1,
  'A18 old two-argument invocation persists exactly one logical consume'
);

-- Exhausted old alias plus a missing new alias must remain exhausted.
truncate a18_decision;
delete from app.api_abuse_windows
where policy = 'token_exchange_pre_auth'
  and subject_hash in (repeat('b', 64), repeat('c', 64));

insert into app.api_abuse_windows (
  policy, subject_hash, window_started_at, request_count, updated_at
) values (
  'token_exchange_pre_auth', repeat('b', 64), clock_timestamp(), 30, clock_timestamp()
);

insert into a18_decision
select * from app.consume_api_abuse_quota(
  'token_exchange_pre_auth',
  repeat('c', 64),
  repeat('b', 64)
);

select is((select allowed from a18_decision), false,
  'A18 rotation cannot regain quota when the previous alias is already exhausted');
select is((select remaining from a18_decision), 0,
  'A18 exhausted previous alias exposes zero headroom under the new alias');
select is(
  (
    select min(request_count)
    from app.api_abuse_windows
    where policy = 'token_exchange_pre_auth'
      and subject_hash in (repeat('b', 64), repeat('c', 64))
  ),
  30,
  'A18 denied rotation synchronizes both aliases to the exhausted count'
);
select is(
  (
    select count(distinct window_started_at)::integer
    from app.api_abuse_windows
    where policy = 'token_exchange_pre_auth'
      and subject_hash in (repeat('b', 64), repeat('c', 64))
  ),
  1,
  'A18 denied rotation synchronizes both aliases to one canonical window'
);

-- Partially consumed old alias plus a missing new alias must not regain headroom.
truncate a18_decision;
delete from app.api_abuse_windows
where policy = 'token_exchange_pre_auth'
  and subject_hash in (repeat('d', 64), repeat('e', 64));

insert into app.api_abuse_windows (
  policy, subject_hash, window_started_at, request_count, updated_at
) values (
  'token_exchange_pre_auth', repeat('d', 64), clock_timestamp(), 7, clock_timestamp()
);

insert into a18_decision
select * from app.consume_api_abuse_quota(
  'token_exchange_pre_auth',
  repeat('e', 64),
  repeat('d', 64)
);

select is((select allowed from a18_decision), true,
  'A18 partially consumed previous alias may consume only its next logical unit');
select is((select remaining from a18_decision), 22,
  'A18 partial rotation preserves existing consumed quota instead of resetting it');
select is(
  (
    select min(request_count)
    from app.api_abuse_windows
    where policy = 'token_exchange_pre_auth'
      and subject_hash in (repeat('d', 64), repeat('e', 64))
  ),
  8,
  'A18 partial rotation synchronizes both aliases after exactly one logical consume'
);

-- Asymmetric live aliases converge to latest live start plus maximum live count.
truncate a18_decision;
delete from app.api_abuse_windows
where policy = 'token_exchange_pre_auth'
  and subject_hash in (repeat('f', 64), repeat('0', 64));

insert into app.api_abuse_windows (
  policy, subject_hash, window_started_at, request_count, updated_at
) values
  ('token_exchange_pre_auth', repeat('f', 64), current_timestamp - interval '40 seconds', 5, clock_timestamp()),
  ('token_exchange_pre_auth', repeat('0', 64), current_timestamp - interval '10 seconds', 12, clock_timestamp());

insert into a18_decision
select * from app.consume_api_abuse_quota(
  'token_exchange_pre_auth',
  repeat('f', 64),
  repeat('0', 64)
);

select is((select allowed from a18_decision), true,
  'A18 asymmetric live aliases still allow the next unit when the conservative count is below limit');
select is((select remaining from a18_decision), 17,
  'A18 asymmetric aliases consume from the maximum live count');
select is(
  (
    select min(request_count)
    from app.api_abuse_windows
    where policy = 'token_exchange_pre_auth'
      and subject_hash in (repeat('f', 64), repeat('0', 64))
  ),
  13,
  'A18 asymmetric aliases converge to maximum live count plus one consume'
);
select is(
  (
    select count(distinct window_started_at)::integer
    from app.api_abuse_windows
    where policy = 'token_exchange_pre_auth'
      and subject_hash in (repeat('f', 64), repeat('0', 64))
  ),
  1,
  'A18 asymmetric aliases converge to one latest live window start'
);

select throws_ok(
  $$select * from app.consume_api_abuse_quota('token_exchange_pre_auth', repeat('a', 64), repeat('a', 64))$$,
  'P0001',
  'duplicate abuse quota subjects',
  'A18 rejects duplicate active and previous subject hashes'
);

select throws_ok(
  $$select * from app.consume_api_abuse_quota('token_exchange_pre_auth', upper(repeat('a', 64)), null)$$,
  'P0001',
  'invalid abuse quota subject',
  'A18 rejects non-lowercase subject hashes'
);

select * from finish();
rollback;
