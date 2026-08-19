create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(18);

create temporary table a20_expected_runtime_capabilities (
  role_name text not null,
  signature text not null,
  primary key (role_name, signature)
) on commit drop;

insert into a20_expected_runtime_capabilities (role_name, signature) values
  ('swiftpay_api', 'app.claim_api_pix_attempt(uuid,text,uuid,uuid)'),
  ('swiftpay_api', 'app.consume_api_abuse_quota(text,text,text)'),
  ('swiftpay_api', 'app.consume_api_token_issuance(uuid)'),
  ('swiftpay_api', 'app.create_dashboard_api_credential(uuid,uuid,text,text,text,jsonb)'),
  ('swiftpay_api', 'app.create_dashboard_webhook_endpoint(uuid,uuid,text,text,text,jsonb)'),
  ('swiftpay_api', 'app.disable_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)'),
  ('swiftpay_api', 'app.enable_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)'),
  ('swiftpay_api', 'app.get_api_balance(uuid,text)'),
  ('swiftpay_api', 'app.get_api_credential_auth_state(uuid)'),
  ('swiftpay_api', 'app.get_api_payment(uuid,text,uuid)'),
  ('swiftpay_api', 'app.get_dashboard_api_credential(uuid,uuid,text,uuid)'),
  ('swiftpay_api', 'app.get_dashboard_transaction(uuid,uuid,text,uuid)'),
  ('swiftpay_api', 'app.get_dashboard_webhook_endpoint(uuid,uuid,text,uuid)'),
  ('swiftpay_api', 'app.list_dashboard_api_credentials(uuid,uuid,text)'),
  ('swiftpay_api', 'app.list_dashboard_transactions(uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,integer)'),
  ('swiftpay_api', 'app.list_dashboard_webhook_endpoints(uuid,uuid,text)'),
  ('swiftpay_api', 'app.lookup_api_credential_for_token(text)'),
  ('swiftpay_api', 'app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)'),
  ('swiftpay_api', 'app.require_dashboard_merchant_context(uuid,uuid,text,text)'),
  ('swiftpay_api', 'app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)'),
  ('swiftpay_api', 'app.revoke_dashboard_api_credential(uuid,uuid,text,uuid,text,text,jsonb)'),
  ('swiftpay_api', 'app.rotate_dashboard_api_credential_secret(uuid,uuid,text,uuid,text,text,jsonb)'),
  ('swiftpay_api', 'app.rotate_dashboard_webhook_endpoint_secret(uuid,uuid,text,uuid,text,text,jsonb)'),
  ('swiftpay_api', 'app.update_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)'),
  ('swiftpay_worker', 'app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamp with time zone)'),
  ('swiftpay_worker', 'app.claim_jobs(text,integer,integer)'),
  ('swiftpay_worker', 'app.claim_merchant_webhook_deliveries(text,integer,integer)'),
  ('swiftpay_worker', 'app.complete_job(uuid,uuid)'),
  ('swiftpay_worker', 'app.reschedule_job(uuid,uuid,text,text,integer)'),
  ('swiftpay_worker', 'app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)');

select is(
  (select count(*)::integer from a20_expected_runtime_capabilities where role_name = 'swiftpay_api'),
  24,
  'A20 manifest mirror contains exactly 24 API RPC signatures'
);

select is(
  (select count(*)::integer from a20_expected_runtime_capabilities where role_name = 'swiftpay_worker'),
  6,
  'A20 manifest mirror contains exactly 6 worker RPC signatures'
);

select is(
  coalesce((
    select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and pg_catalog.has_function_privilege('swiftpay_api', p.oid, 'EXECUTE')
  ), '{}'::text),
  (select array_agg(signature order by signature)::text
   from a20_expected_runtime_capabilities
   where role_name = 'swiftpay_api'),
  'A20 API effective EXECUTE set exactly equals the nominal signature allowlist'
);

select is(
  coalesce((
    select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and pg_catalog.has_function_privilege('swiftpay_worker', p.oid, 'EXECUTE')
  ), '{}'::text),
  (select array_agg(signature order by signature)::text
   from a20_expected_runtime_capabilities
   where role_name = 'swiftpay_worker'),
  'A20 worker effective EXECUTE set exactly equals the nominal signature allowlist'
);

select ok(pg_catalog.has_schema_privilege('swiftpay_api', 'app', 'USAGE'), 'A20 API capability role retains app USAGE');
select ok(not pg_catalog.has_schema_privilege('swiftpay_api', 'app', 'CREATE'), 'A20 API capability role cannot CREATE in app');
select ok(pg_catalog.has_schema_privilege('swiftpay_worker', 'app', 'USAGE'), 'A20 worker capability role retains app USAGE');
select ok(not pg_catalog.has_schema_privilege('swiftpay_worker', 'app', 'CREATE'), 'A20 worker capability role cannot CREATE in app');

select is(
  coalesce((
    select array_agg(parent.rolname order by parent.rolname)::text
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    join pg_catalog.pg_roles parent on parent.oid = m.roleid
    where member_role.rolname = 'swiftpay_api_runtime'
  ), '{}'::text),
  '{swiftpay_api}'::text,
  'A20 API runtime inherits exactly swiftpay_api'
);

select is(
  coalesce((
    select array_agg(parent.rolname order by parent.rolname)::text
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles member_role on member_role.oid = m.member
    join pg_catalog.pg_roles parent on parent.oid = m.roleid
    where member_role.rolname = 'swiftpay_worker_runtime'
  ), '{}'::text),
  '{swiftpay_worker}'::text,
  'A20 worker runtime inherits exactly swiftpay_worker'
);

select ok(
  coalesce((select not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
            from pg_catalog.pg_roles where rolname = 'swiftpay_api_runtime'), false),
  'A20 API runtime has no privileged role attributes'
);

select ok(
  coalesce((select not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
            from pg_catalog.pg_roles where rolname = 'swiftpay_worker_runtime'), false),
  'A20 worker runtime has no privileged role attributes'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault(case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end, c.relowner))
    ) acl
    join pg_catalog.pg_roles granted_role on granted_role.oid = acl.grantee
    where n.nspname = 'app'
      and granted_role.rolname in ('swiftpay_api', 'swiftpay_worker', 'swiftpay_api_runtime', 'swiftpay_worker_runtime')
  ),
  0,
  'A20 API/worker capability and LOGIN roles have zero direct app relation or sequence ACL entries'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
      and (
        pg_catalog.has_schema_privilege(r.rolname, 'app', 'USAGE')
        or pg_catalog.has_schema_privilege(r.rolname, 'app', 'CREATE')
      )
  ),
  0,
  'A20 Data API roles have no app schema authority'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'app'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and (
        pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')
        or pg_catalog.has_table_privilege('anon', c.oid, 'INSERT')
        or pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE')
        or pg_catalog.has_table_privilege('anon', c.oid, 'DELETE')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE')
        or pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE')
        or pg_catalog.has_table_privilege('service_role', c.oid, 'SELECT')
        or pg_catalog.has_table_privilege('service_role', c.oid, 'INSERT')
        or pg_catalog.has_table_privilege('service_role', c.oid, 'UPDATE')
        or pg_catalog.has_table_privilege('service_role', c.oid, 'DELETE')
      )
  ),
  0,
  'A20 Data API roles have zero effective app table DML authority'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and (
        pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )
      )
  ),
  0,
  'A20 PUBLIC and Data API roles have zero executable app RPC authority'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and (
        pg_catalog.has_function_privilege('swiftpay_api', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('swiftpay_worker', p.oid, 'EXECUTE')
      )
      and not p.prosecdef
  ),
  0,
  'A20 every runtime-executable app routine remains SECURITY DEFINER'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and (
        pg_catalog.has_function_privilege('swiftpay_api', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('swiftpay_worker', p.oid, 'EXECUTE')
      )
      and (
        not exists (
          select 1
          from unnest(coalesce(p.proconfig, '{}'::text[])) config
          where config like 'search_path=%'
        )
        or exists (
          select 1
          from unnest(coalesce(p.proconfig, '{}'::text[])) config
          where config like 'search_path=%'
            and lower(config) ~ '(^|[=,[:space:]])(public|pg_temp|\$user)([,[:space:]]|$)'
        )
      )
  ),
  0,
  'A20 every runtime-executable app routine has an explicit search_path excluding public pg_temp and $user'
);

select is((select count(*)::integer from app.payments), 0, 'A20 attestation creates no Payment state');

select * from finish();
rollback;
