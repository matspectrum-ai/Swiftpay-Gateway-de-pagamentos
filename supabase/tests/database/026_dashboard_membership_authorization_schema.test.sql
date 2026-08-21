create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(15);

-- Existing canonical identity/membership anchor must remain intact.
select ok(
    exists (
        select 1
        from pg_constraint c
        join pg_class child on child.oid = c.conrelid
        join pg_namespace child_ns on child_ns.oid = child.relnamespace
        join pg_class parent on parent.oid = c.confrelid
        join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
        where c.contype = 'f'
          and child_ns.nspname = 'app'
          and child.relname = 'merchant_members'
          and parent_ns.nspname = 'auth'
          and parent.relname = 'users'
          and pg_get_constraintdef(c.oid) like 'FOREIGN KEY (user_id) REFERENCES auth.users(id)%'
    ),
    'merchant membership remains anchored to auth.users.id'
);

select ok(
    exists (
        select 1
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'app'
          and t.relname = 'merchant_members'
          and c.contype = 'p'
          and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (merchant_id, user_id)'
    ),
    'merchant membership identity remains exact merchant plus user'
);

-- Frozen K3 helper contract.
select ok(
    to_regprocedure('app.require_merchant_membership(uuid,uuid,text)') is not null,
    'require_merchant_membership frozen signature exists'
);

select is(
    (
        select pg_get_function_result(p.oid)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
    ),
    'text',
    'membership helper returns the actual role as text'
);

select ok(
    coalesce((
        select p.prosecdef
        from pg_proc p
        where p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
    ), false),
    'membership helper is SECURITY DEFINER'
);

select ok(
    coalesce((
        select 'search_path=pg_catalog, app, auth' = any(p.proconfig)
        from pg_proc p
        where p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
    ), false),
    'membership helper has fixed pg_catalog, app, auth search_path'
);

select ok(
    coalesce((
        select p.provolatile = 's'
        from pg_proc p
        where p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
    ), false),
    'membership helper is STABLE and read-oriented'
);

-- EXECUTE must remain closed until K4 grants a dedicated trusted backend role.
select ok(
    not exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
          and a.privilege_type = 'EXECUTE'
          and a.grantee = 0
    ),
    'PUBLIC cannot execute membership helper'
);

select ok(
    not exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
          and a.privilege_type = 'EXECUTE'
          and a.grantee = (select oid from pg_roles where rolname = 'anon')
    ),
    'anon cannot execute membership helper'
);

select ok(
    not exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
          and a.privilege_type = 'EXECUTE'
          and a.grantee = (select oid from pg_roles where rolname = 'authenticated')
    ),
    'authenticated cannot execute membership helper'
);

select ok(
    not exists (
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
          and a.privilege_type = 'EXECUTE'
          and a.grantee = (select oid from pg_roles where rolname = 'service_role')
    ),
    'service_role cannot execute membership helper'
);

-- K3 must not weaken J1 direct-table/schema denial.
select ok(
    not has_schema_privilege('anon', 'app', 'USAGE'),
    'anon still has no app schema usage'
);
select ok(
    not has_schema_privilege('authenticated', 'app', 'USAGE'),
    'authenticated still has no app schema usage'
);
select ok(
    not has_schema_privilege('service_role', 'app', 'USAGE'),
    'service_role still has no app schema usage'
);
select ok(
    not has_table_privilege('authenticated', 'app.merchant_members', 'SELECT'),
    'authenticated still cannot read merchant membership table directly'
);

select * from finish();
rollback;
