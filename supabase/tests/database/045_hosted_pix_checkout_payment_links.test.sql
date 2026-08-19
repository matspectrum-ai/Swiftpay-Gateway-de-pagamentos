create extension if not exists pgtap with schema extensions;

begin;
select plan(28);

select has_table('app', 'payment_links', 'A23 payment_links table exists');

select has_function('app', 'list_dashboard_payment_links', array['uuid','uuid','text'],
  'A23 dashboard payment-link list routine exists with exact identity');
select has_function('app', 'create_dashboard_payment_link', array['uuid','uuid','text','text','text','jsonb'],
  'A23 dashboard payment-link create routine exists with exact identity');
select has_function('app', 'disable_dashboard_payment_link', array['uuid','uuid','text','uuid','text','text','jsonb'],
  'A23 dashboard payment-link disable routine exists with exact identity');
select has_function('app', 'get_public_payment_link', array['text'],
  'A23 public payment-link read routine exists with exact identity');
select has_function('app', 'prepare_payment_link_pix_payment', array['text','text','text'],
  'A23 public payment-link Pix prepare routine exists with exact identity');

select is(
  (
    select count(*)
    from unnest(array[
      to_regprocedure('app.list_dashboard_payment_links(uuid,uuid,text)'),
      to_regprocedure('app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)'),
      to_regprocedure('app.disable_dashboard_payment_link(uuid,uuid,text,uuid,text,text,jsonb)'),
      to_regprocedure('app.get_public_payment_link(text)'),
      to_regprocedure('app.prepare_payment_link_pix_payment(text,text,text)')
    ]) as r(oid)
    join pg_proc p on p.oid = r.oid
    where p.prosecdef
  ),
  5::bigint,
  'A23 trusted routines are all SECURITY DEFINER'
);

select is(
  (
    select count(*)
    from unnest(array[
      to_regprocedure('app.list_dashboard_payment_links(uuid,uuid,text)'),
      to_regprocedure('app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)'),
      to_regprocedure('app.disable_dashboard_payment_link(uuid,uuid,text,uuid,text,text,jsonb)'),
      to_regprocedure('app.get_public_payment_link(text)'),
      to_regprocedure('app.prepare_payment_link_pix_payment(text,text,text)')
    ]) as r(oid)
    join pg_proc p on p.oid = r.oid
    where array_to_string(p.proconfig, ',') = 'search_path=""'
  ),
  5::bigint,
  'A23 trusted routines all fix an empty search_path'
);

select is(
  (
    select count(*)
    from unnest(array[
      to_regprocedure('app.list_dashboard_payment_links(uuid,uuid,text)'),
      to_regprocedure('app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)'),
      to_regprocedure('app.disable_dashboard_payment_link(uuid,uuid,text,uuid,text,text,jsonb)'),
      to_regprocedure('app.get_public_payment_link(text)'),
      to_regprocedure('app.prepare_payment_link_pix_payment(text,text,text)')
    ]) as r(oid)
    where r.oid is not null and has_function_privilege('swiftpay_api', r.oid, 'EXECUTE')
  ),
  5::bigint,
  'swiftpay_api alone receives all five A23 routine capabilities'
);

select is(
  (
    select count(*)
    from unnest(array[
      to_regprocedure('app.list_dashboard_payment_links(uuid,uuid,text)'),
      to_regprocedure('app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)'),
      to_regprocedure('app.disable_dashboard_payment_link(uuid,uuid,text,uuid,text,text,jsonb)'),
      to_regprocedure('app.get_public_payment_link(text)'),
      to_regprocedure('app.prepare_payment_link_pix_payment(text,text,text)')
    ]) as r(oid)
    where r.oid is not null
      and not has_function_privilege('swiftpay_worker', r.oid, 'EXECUTE')
      and not has_function_privilege('anon', r.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', r.oid, 'EXECUTE')
      and not has_function_privilege('service_role', r.oid, 'EXECUTE')
      and not has_function_privilege('public', r.oid, 'EXECUTE')
  ),
  5::bigint,
  'worker and Data API/PUBLIC roles receive no A23 routine authority'
);

select ok(
  to_regclass('app.payment_links') is not null
  and not has_table_privilege('swiftpay_api', to_regclass('app.payment_links'), 'SELECT,INSERT,UPDATE,DELETE'),
  'swiftpay_api has no direct payment_links DML'
);
select ok(
  to_regclass('app.payment_links') is not null
  and not has_table_privilege('swiftpay_worker', to_regclass('app.payment_links'), 'SELECT,INSERT,UPDATE,DELETE'),
  'swiftpay_worker has no direct payment_links DML'
);
select ok(
  to_regclass('app.payment_links') is not null
  and not has_table_privilege('anon', to_regclass('app.payment_links'), 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', to_regclass('app.payment_links'), 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', to_regclass('app.payment_links'), 'SELECT,INSERT,UPDATE,DELETE'),
  'Data API roles have no direct payment_links DML'
);

select ok(
  exists (
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='app' and t.relname='payment_links' and c.contype='c'
      and pg_get_constraintdef(c.oid) ilike '%environment%'
      and pg_get_constraintdef(c.oid) ilike '%sandbox%'
  ),
  'A23 payment links are database-constrained to Sandbox'
);
select ok(
  exists (
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='app' and t.relname='payment_links' and c.contype='c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
      and pg_get_constraintdef(c.oid) ilike '%active%'
      and pg_get_constraintdef(c.oid) ilike '%disabled%'
  ),
  'A23 payment-link lifecycle is constrained to active or disabled'
);
select ok(
  exists (
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='app' and t.relname='payment_links' and c.contype='c'
      and pg_get_constraintdef(c.oid) ilike '%amount_cents%> 0%'
  ),
  'A23 payment-link amount is positive'
);
select ok(
  exists (
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='app' and t.relname='payment_links' and c.contype='c'
      and pg_get_constraintdef(c.oid) ilike '%currency%BRL%'
  ),
  'A23 payment-link currency is constrained to BRL'
);
select ok(
  exists (
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='app' and t.relname='payment_links' and c.contype='c'
      and pg_get_constraintdef(c.oid) ilike '%pix_expiration_minutes%>= 5%'
      and pg_get_constraintdef(c.oid) ilike '%pix_expiration_minutes%<= 1440%'
  ),
  'A23 payment-link Pix expiration is bounded 5 through 1440 minutes'
);
select ok(
  exists (
    select 1 from pg_index i join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='app' and t.relname='payment_links' and i.indisunique
      and pg_get_indexdef(i.indexrelid) ilike '%public_token%'
  ),
  'A23 public payment-link token is unique'
);

select ok(
  exists (
    select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='app' and t.relname='payments' and c.contype='c'
      and pg_get_constraintdef(c.oid) ilike '%payment_link%'
  ),
  'canonical Payment source vocabulary already admits payment_link'
);
select ok(to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)') is not null,
  'A23 preserves the A2 machine prepare routine instead of replacing it');

select is(
  (
    select count(*)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and has_function_privilege('swiftpay_api', p.oid, 'EXECUTE')
  ),
  30::bigint,
  'A23 expands swiftpay_api exact EXECUTE count from 25 to 30'
);
select is(
  (
    select count(*)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and has_function_privilege('swiftpay_worker', p.oid, 'EXECUTE')
  ),
  6::bigint,
  'A23 leaves swiftpay_worker exact EXECUTE count at 6'
);

create function pg_temp.a23_payment_link_count()
returns bigint
language plpgsql
as $$
declare v bigint;
begin
  execute 'select count(*) from app.payment_links' into v;
  return v;
exception when undefined_table then return -1;
end;
$$;

select is(pg_temp.a23_payment_link_count(), 0::bigint, 'A23 structural RED begins with no payment-link rows');
select is((select count(*) from app.payments), 0::bigint, 'A23 structural RED creates no Payment state');
select is((select count(*) from app.provider_attempts), 0::bigint, 'A23 structural RED creates no ProviderAttempt state');
select is((select count(*) from app.ledger_transactions), 0::bigint, 'A23 structural RED creates no ledger state');
select is((select count(*) from app.jobs), 0::bigint, 'A23 structural RED creates no job state');

select * from finish();
rollback;
