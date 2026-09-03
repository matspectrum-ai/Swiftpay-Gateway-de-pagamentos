create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(6);

select ok(
  to_regprocedure('pg_catalog.coalesce(text,text)') is null,
  'A27 reproduces PostgreSQL runtime with no pg_catalog.coalesce function'
);

select is(
  coalesce(null::text, 'ok'),
  'ok'::text,
  'A27 ordinary COALESCE special form is available'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.prosrc ilike '%pg_catalog.coalesce%'
  ),
  0,
  'A27 app function bodies contain no invalid pg_catalog.coalesce qualification'
);

select ok(
  position(
    'pg_catalog.coalesce' in
    pg_get_functiondef('app._a23_resolve_payment_link_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)'::regprocedure)
  ) = 0,
  'A27 payment-link resolver uses ordinary COALESCE expressions'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and has_function_privilege('swiftpay_api', p.oid, 'EXECUTE')
  ),
  30,
  'A27 preserves exact swiftpay_api capability count'
);

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and has_function_privilege('swiftpay_worker', p.oid, 'EXECUTE')
  ),
  6,
  'A27 preserves exact swiftpay_worker capability count'
);

select * from finish();
rollback;
