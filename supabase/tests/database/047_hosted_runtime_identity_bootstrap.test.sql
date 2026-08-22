create extension if not exists pgtap with schema extensions;

begin;
select plan(18);

create function pg_temp.a25_effective_app_execute_count(p_role_name text)
returns bigint
language plpgsql
as $$
declare
  v_role oid;
  v_count bigint;
begin
  select r.oid into v_role from pg_roles r where r.rolname = p_role_name;
  if v_role is null then
    return -1;
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and has_function_privilege(v_role, p.oid, 'EXECUTE');
  return v_count;
end;
$$;

create function pg_temp.a25_has_direct_app_acl(p_role_name text)
returns boolean
language plpgsql
as $$
declare
  v_role oid;
begin
  select r.oid into v_role from pg_roles r where r.rolname = p_role_name;
  if v_role is null then
    return false;
  end if;

  return exists (
    select 1
    from pg_namespace n
    cross join lateral aclexplode(coalesce(n.nspacl, '{}'::aclitem[])) a
    where n.nspname = 'app' and a.grantee = v_role

    union all

    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
    where n.nspname = 'app' and a.grantee = v_role

    union all

    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
    where n.nspname = 'app' and a.grantee = v_role
  );
end;
$$;

select ok(
  exists (select 1 from pg_roles where rolname = 'swiftpay_api_runtime'),
  'A25 creates hosted-safe swiftpay_api_runtime LOGIN identity'
);
select ok(
  exists (select 1 from pg_roles where rolname = 'swiftpay_worker_runtime'),
  'A25 creates hosted-safe swiftpay_worker_runtime LOGIN identity'
);

select ok(
  coalesce((
    select rolcanlogin and rolinherit
      and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls
    from pg_roles where rolname = 'swiftpay_api_runtime'
  ), false),
  'A25 API runtime LOGIN has exact safe role attributes'
);
select ok(
  coalesce((
    select rolcanlogin and rolinherit
      and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls
    from pg_roles where rolname = 'swiftpay_worker_runtime'
  ), false),
  'A25 worker runtime LOGIN has exact safe role attributes'
);

select ok(
  exists (
    select 1
    from pg_auth_members am
    join pg_roles parent on parent.oid = am.roleid
    join pg_roles member on member.oid = am.member
    where parent.rolname = 'swiftpay_api' and member.rolname = 'swiftpay_api_runtime'
  ),
  'A25 API runtime inherits swiftpay_api capability group'
);
select ok(
  exists (
    select 1
    from pg_auth_members am
    join pg_roles parent on parent.oid = am.roleid
    join pg_roles member on member.oid = am.member
    where parent.rolname = 'swiftpay_worker' and member.rolname = 'swiftpay_worker_runtime'
  ),
  'A25 worker runtime inherits swiftpay_worker capability group'
);
select ok(
  not exists (
    select 1
    from pg_auth_members am
    join pg_roles parent on parent.oid = am.roleid
    join pg_roles member on member.oid = am.member
    where parent.rolname = 'swiftpay_worker' and member.rolname = 'swiftpay_api_runtime'
  ),
  'A25 API runtime does not inherit worker capability group'
);
select ok(
  not exists (
    select 1
    from pg_auth_members am
    join pg_roles parent on parent.oid = am.roleid
    join pg_roles member on member.oid = am.member
    where parent.rolname = 'swiftpay_api' and member.rolname = 'swiftpay_worker_runtime'
  ),
  'A25 worker runtime does not inherit API capability group'
);

select is(
  pg_temp.a25_effective_app_execute_count('swiftpay_api_runtime'),
  30::bigint,
  'A25 API runtime inherits exactly the 30 canonical API routines'
);
select is(
  pg_temp.a25_effective_app_execute_count('swiftpay_worker_runtime'),
  6::bigint,
  'A25 worker runtime inherits exactly the 6 canonical worker routines'
);

select ok(
  case when exists (select 1 from pg_roles where rolname = 'swiftpay_api_runtime')
    then has_schema_privilege('swiftpay_api_runtime', 'app', 'USAGE')
    else false end,
  'A25 API runtime inherits app schema USAGE'
);
select ok(
  case when exists (select 1 from pg_roles where rolname = 'swiftpay_worker_runtime')
    then has_schema_privilege('swiftpay_worker_runtime', 'app', 'USAGE')
    else false end,
  'A25 worker runtime inherits app schema USAGE'
);
select ok(
  case when exists (select 1 from pg_roles where rolname = 'swiftpay_api_runtime')
    then not has_schema_privilege('swiftpay_api_runtime', 'app', 'CREATE')
    else false end,
  'A25 API runtime has no app schema CREATE'
);
select ok(
  case when exists (select 1 from pg_roles where rolname = 'swiftpay_worker_runtime')
    then not has_schema_privilege('swiftpay_worker_runtime', 'app', 'CREATE')
    else false end,
  'A25 worker runtime has no app schema CREATE'
);

select ok(
  not pg_temp.a25_has_direct_app_acl('swiftpay_api_runtime'),
  'A25 API runtime receives no direct app object ACL grant'
);
select ok(
  not pg_temp.a25_has_direct_app_acl('swiftpay_worker_runtime'),
  'A25 worker runtime receives no direct app object ACL grant'
);

select ok(
  case when exists (select 1 from pg_roles where rolname = 'swiftpay_api_runtime')
    then not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relkind in ('r','p')
        and has_table_privilege('swiftpay_api_runtime', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    ) else false end,
  'A25 API runtime has no effective direct protected-table DML'
);
select ok(
  case when exists (select 1 from pg_roles where rolname = 'swiftpay_worker_runtime')
    then not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relkind in ('r','p')
        and has_table_privilege('swiftpay_worker_runtime', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
    ) else false end,
  'A25 worker runtime has no effective direct protected-table DML'
);

select * from finish();
rollback;
