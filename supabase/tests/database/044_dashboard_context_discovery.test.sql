create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(14);

select has_function(
  'app',
  'list_dashboard_merchant_contexts',
  array['uuid'],
  'A21 context discovery routine exists with exact uuid identity'
);

select is(
  (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.oid = to_regprocedure('app.list_dashboard_merchant_contexts(uuid)')
  ),
  true,
  'A21 context discovery routine is SECURITY DEFINER'
);

select is(
  (
    select p.provolatile
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.oid = to_regprocedure('app.list_dashboard_merchant_contexts(uuid)')
  ),
  's'::"char",
  'A21 context discovery routine is STABLE'
);

select is(
  (
    select array_to_string(p.proconfig, ',')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.oid = to_regprocedure('app.list_dashboard_merchant_contexts(uuid)')
  ),
  'search_path=pg_catalog, app, auth',
  'A21 context discovery routine has explicit safe search_path'
);

select is(
  has_function_privilege(
    'swiftpay_api',
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'list_dashboard_merchant_contexts' and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid'),
    'EXECUTE'
  ),
  true,
  'swiftpay_api can execute A21 context discovery'
);

select is(
  coalesce((
    select
      not has_function_privilege('swiftpay_worker', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not has_function_privilege('public', p.oid, 'EXECUTE')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname = 'list_dashboard_merchant_contexts'
      and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid'
  ), false),
  true,
  'worker and Data API roles have no A21 execute authority'
);

insert into app.merchants (id, name, lifecycle_status) values
  ('21000000-0000-0000-0000-000000000001'::uuid, 'Alpha Store', 'active'),
  ('21000000-0000-0000-0000-000000000002'::uuid, 'Draft Store', 'draft'),
  ('21000000-0000-0000-0000-000000000003'::uuid, 'Suspended Store', 'suspended'),
  ('21000000-0000-0000-0000-000000000004'::uuid, 'Foreign Store', 'active');

insert into auth.users (
  id, aud, role, email, raw_user_meta_data, raw_app_meta_data,
  is_anonymous, deleted_at, created_at, updated_at
) values
  ('21100000-0000-0000-0000-000000000001'::uuid, 'authenticated', 'authenticated', 'a21-owner@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('21100000-0000-0000-0000-000000000002'::uuid, 'authenticated', 'authenticated', 'a21-disabled@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
  ('21100000-0000-0000-0000-000000000003'::uuid, 'authenticated', 'authenticated', null, '{}'::jsonb, '{}'::jsonb, true, null, now(), now()),
  ('21100000-0000-0000-0000-000000000004'::uuid, 'authenticated', 'authenticated', 'a21-deleted@example.test', '{}'::jsonb, '{}'::jsonb, false, now(), now(), now());

insert into app.merchant_members (merchant_id, user_id, role, status) values
  ('21000000-0000-0000-0000-000000000001'::uuid, '21100000-0000-0000-0000-000000000001'::uuid, 'owner', 'active'),
  ('21000000-0000-0000-0000-000000000002'::uuid, '21100000-0000-0000-0000-000000000001'::uuid, 'member', 'active'),
  ('21000000-0000-0000-0000-000000000003'::uuid, '21100000-0000-0000-0000-000000000001'::uuid, 'admin', 'active'),
  ('21000000-0000-0000-0000-000000000004'::uuid, '21100000-0000-0000-0000-000000000002'::uuid, 'owner', 'disabled'),
  ('21000000-0000-0000-0000-000000000001'::uuid, '21100000-0000-0000-0000-000000000003'::uuid, 'owner', 'active'),
  ('21000000-0000-0000-0000-000000000001'::uuid, '21100000-0000-0000-0000-000000000004'::uuid, 'owner', 'active');

create function pg_temp.a21_contexts(p_user uuid)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  execute $query$
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'merchantId', t.merchant_id,
          'merchantName', t.merchant_name,
          'lifecycleStatus', t.lifecycle_status,
          'membershipRole', t.membership_role
        )
        order by lower(t.merchant_name), t.merchant_id
      ),
      '[]'::jsonb
    )
    from app.list_dashboard_merchant_contexts($1) t
  $query$ into result using p_user;
  return result;
exception
  when undefined_function then return '"__MISSING__"'::jsonb;
  when others then return to_jsonb('__ERROR__:' || sqlstate);
end;
$$;

select is(
  pg_temp.a21_contexts('21100000-0000-0000-0000-000000000001'::uuid),
  '[{"merchantId":"21000000-0000-0000-0000-000000000001","merchantName":"Alpha Store","lifecycleStatus":"active","membershipRole":"owner"},{"merchantId":"21000000-0000-0000-0000-000000000002","merchantName":"Draft Store","lifecycleStatus":"draft","membershipRole":"member"},{"merchantId":"21000000-0000-0000-0000-000000000003","merchantName":"Suspended Store","lifecycleStatus":"suspended","membershipRole":"admin"}]'::jsonb,
  'A21 returns exactly the verified users active merchant memberships with canonical lifecycle and roles'
);

select is(
  pg_temp.a21_contexts('21100000-0000-0000-0000-000000000002'::uuid),
  '[]'::jsonb,
  'A21 omits disabled memberships'
);

select is(
  pg_temp.a21_contexts('21100000-0000-0000-0000-000000000003'::uuid),
  to_jsonb('__ERROR__:42501'::text),
  'A21 anonymous auth identity fails closed even with an active membership'
);

select is(
  pg_temp.a21_contexts('21100000-0000-0000-0000-000000000004'::uuid),
  to_jsonb('__ERROR__:42501'::text),
  'A21 deleted auth identity fails closed even with an active membership'
);

select is(
  pg_temp.a21_contexts('21100000-0000-0000-0000-000000000099'::uuid),
  to_jsonb('__ERROR__:42501'::text),
  'A21 unknown auth identity fails closed without membership disclosure'
);

select is((select count(*) from app.payments), 0::bigint, 'A21 context discovery creates no payment state');
select is((select count(*) from app.provider_attempts), 0::bigint, 'A21 context discovery creates no provider-attempt state');
select is((select count(*) from app.ledger_transactions), 0::bigint, 'A21 context discovery creates no ledger state');

select * from finish();
rollback;
