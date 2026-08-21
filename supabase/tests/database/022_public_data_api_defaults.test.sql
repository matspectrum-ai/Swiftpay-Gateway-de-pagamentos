create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(18);

-- The optional Supabase RLS-on-create helper may remain installed, but it is
-- infrastructure, not a public RPC endpoint.
select ok(
    to_regprocedure('public.rls_auto_enable()') is null
    or not has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE'),
    'anon cannot execute public.rls_auto_enable when installed'
);
select ok(
    to_regprocedure('public.rls_auto_enable()') is null
    or not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE'),
    'authenticated cannot execute public.rls_auto_enable when installed'
);
select ok(
    to_regprocedure('public.rls_auto_enable()') is null
    or not has_function_privilege('service_role', 'public.rls_auto_enable()', 'EXECUTE'),
    'service_role cannot execute public.rls_auto_enable when installed'
);
select ok(
    to_regprocedure('public.rls_auto_enable()') is null
    or not exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          cross join lateral pg_catalog.aclexplode(
              coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) acl
         where n.nspname = 'public'
           and p.proname = 'rls_auto_enable'
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
    ),
    'PUBLIC cannot execute public.rls_auto_enable when installed'
);
select ok(
    to_regprocedure('public.rls_auto_enable()') is null
    or exists (
        select 1
          from pg_event_trigger e
         where e.evtname = 'ensure_rls'
           and e.evtfoid = to_regprocedure('public.rls_auto_enable()')
           and e.evtenabled <> 'D'
    ),
    'ensure_rls remains enabled when rls_auto_enable is installed'
);

-- Transactional probes test what a future migration would inherit by default.
create table public.__swiftpay_public_acl_probe_table (
    id bigint primary key
);
create sequence public.__swiftpay_public_acl_probe_sequence;
create function public.__swiftpay_public_acl_probe_function()
returns integer
language sql
set search_path = pg_catalog
as $$ select 1 $$;

select ok(
    not (
        has_table_privilege('anon', 'public.__swiftpay_public_acl_probe_table', 'SELECT')
        or has_table_privilege('anon', 'public.__swiftpay_public_acl_probe_table', 'INSERT')
        or has_table_privilege('anon', 'public.__swiftpay_public_acl_probe_table', 'UPDATE')
        or has_table_privilege('anon', 'public.__swiftpay_public_acl_probe_table', 'DELETE')
        or has_table_privilege('anon', 'public.__swiftpay_public_acl_probe_table', 'TRUNCATE')
        or has_table_privilege('anon', 'public.__swiftpay_public_acl_probe_table', 'REFERENCES')
        or has_table_privilege('anon', 'public.__swiftpay_public_acl_probe_table', 'TRIGGER')
    ),
    'future public table gives anon no implicit privileges'
);
select ok(
    not (
        has_table_privilege('authenticated', 'public.__swiftpay_public_acl_probe_table', 'SELECT')
        or has_table_privilege('authenticated', 'public.__swiftpay_public_acl_probe_table', 'INSERT')
        or has_table_privilege('authenticated', 'public.__swiftpay_public_acl_probe_table', 'UPDATE')
        or has_table_privilege('authenticated', 'public.__swiftpay_public_acl_probe_table', 'DELETE')
        or has_table_privilege('authenticated', 'public.__swiftpay_public_acl_probe_table', 'TRUNCATE')
        or has_table_privilege('authenticated', 'public.__swiftpay_public_acl_probe_table', 'REFERENCES')
        or has_table_privilege('authenticated', 'public.__swiftpay_public_acl_probe_table', 'TRIGGER')
    ),
    'future public table gives authenticated no implicit privileges'
);
select ok(
    not (
        has_table_privilege('service_role', 'public.__swiftpay_public_acl_probe_table', 'SELECT')
        or has_table_privilege('service_role', 'public.__swiftpay_public_acl_probe_table', 'INSERT')
        or has_table_privilege('service_role', 'public.__swiftpay_public_acl_probe_table', 'UPDATE')
        or has_table_privilege('service_role', 'public.__swiftpay_public_acl_probe_table', 'DELETE')
        or has_table_privilege('service_role', 'public.__swiftpay_public_acl_probe_table', 'TRUNCATE')
        or has_table_privilege('service_role', 'public.__swiftpay_public_acl_probe_table', 'REFERENCES')
        or has_table_privilege('service_role', 'public.__swiftpay_public_acl_probe_table', 'TRIGGER')
    ),
    'future public table gives service_role no implicit privileges'
);

select ok(
    not (
        has_sequence_privilege('anon', 'public.__swiftpay_public_acl_probe_sequence', 'USAGE')
        or has_sequence_privilege('anon', 'public.__swiftpay_public_acl_probe_sequence', 'SELECT')
        or has_sequence_privilege('anon', 'public.__swiftpay_public_acl_probe_sequence', 'UPDATE')
    ),
    'future public sequence gives anon no implicit privileges'
);
select ok(
    not (
        has_sequence_privilege('authenticated', 'public.__swiftpay_public_acl_probe_sequence', 'USAGE')
        or has_sequence_privilege('authenticated', 'public.__swiftpay_public_acl_probe_sequence', 'SELECT')
        or has_sequence_privilege('authenticated', 'public.__swiftpay_public_acl_probe_sequence', 'UPDATE')
    ),
    'future public sequence gives authenticated no implicit privileges'
);
select ok(
    not (
        has_sequence_privilege('service_role', 'public.__swiftpay_public_acl_probe_sequence', 'USAGE')
        or has_sequence_privilege('service_role', 'public.__swiftpay_public_acl_probe_sequence', 'SELECT')
        or has_sequence_privilege('service_role', 'public.__swiftpay_public_acl_probe_sequence', 'UPDATE')
    ),
    'future public sequence gives service_role no implicit privileges'
);

select ok(
    not has_function_privilege('anon', 'public.__swiftpay_public_acl_probe_function()', 'EXECUTE'),
    'future public function gives anon no implicit EXECUTE'
);
select ok(
    not has_function_privilege('authenticated', 'public.__swiftpay_public_acl_probe_function()', 'EXECUTE'),
    'future public function gives authenticated no implicit EXECUTE'
);
select ok(
    not has_function_privilege('service_role', 'public.__swiftpay_public_acl_probe_function()', 'EXECUTE'),
    'future public function gives service_role no implicit EXECUTE'
);
select ok(
    not exists (
        select 1
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          cross join lateral pg_catalog.aclexplode(
              coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) acl
         where n.nspname = 'public'
           and p.proname = '__swiftpay_public_acl_probe_function'
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
    ),
    'future public function gives PUBLIC no implicit EXECUTE'
);

-- J2 must not weaken the private app boundary established by J1.
select ok(not has_schema_privilege('anon', 'app', 'USAGE'), 'J2 preserves anon denial on app');
select ok(not has_schema_privilege('authenticated', 'app', 'USAGE'), 'J2 preserves authenticated denial on app');
select ok(not has_schema_privilege('service_role', 'app', 'USAGE'), 'J2 preserves service_role denial on app');

select * from finish();
rollback;
