create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(31);

-- Schema boundary: Data API roles never receive direct app-schema capability.
select ok(not has_schema_privilege('anon', 'app', 'USAGE'), 'anon cannot use private app schema');
select ok(not has_schema_privilege('authenticated', 'app', 'USAGE'), 'authenticated cannot use private app schema');
select ok(not has_schema_privilege('service_role', 'app', 'USAGE'), 'service_role cannot use private app schema');
select ok(not has_schema_privilege('anon', 'app', 'CREATE'), 'anon cannot create in private app schema');
select ok(not has_schema_privilege('authenticated', 'app', 'CREATE'), 'authenticated cannot create in private app schema');
select ok(not has_schema_privilege('service_role', 'app', 'CREATE'), 'service_role cannot create in private app schema');
select ok(
    not exists (
        select 1
          from pg_catalog.pg_namespace n
          cross join lateral pg_catalog.aclexplode(
              coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
          ) acl
         where n.nspname = 'app'
           and acl.grantee = 0
           and acl.privilege_type in ('USAGE', 'CREATE')
    ),
    'PUBLIC has no capability on private app schema'
);

-- Existing relation ACLs remain fail-closed even independently of schema USAGE.
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app'
           and c.relkind in ('r', 'p', 'v', 'm', 'f')
           and (
               has_table_privilege('anon', c.oid, 'SELECT')
               or has_table_privilege('anon', c.oid, 'INSERT')
               or has_table_privilege('anon', c.oid, 'UPDATE')
               or has_table_privilege('anon', c.oid, 'DELETE')
               or has_table_privilege('anon', c.oid, 'TRUNCATE')
               or has_table_privilege('anon', c.oid, 'REFERENCES')
               or has_table_privilege('anon', c.oid, 'TRIGGER')
           )
    ),
    'anon has no privilege on current app relations'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app'
           and c.relkind in ('r', 'p', 'v', 'm', 'f')
           and (
               has_table_privilege('authenticated', c.oid, 'SELECT')
               or has_table_privilege('authenticated', c.oid, 'INSERT')
               or has_table_privilege('authenticated', c.oid, 'UPDATE')
               or has_table_privilege('authenticated', c.oid, 'DELETE')
               or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
               or has_table_privilege('authenticated', c.oid, 'REFERENCES')
               or has_table_privilege('authenticated', c.oid, 'TRIGGER')
           )
    ),
    'authenticated has no privilege on current app relations'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app'
           and c.relkind in ('r', 'p', 'v', 'm', 'f')
           and (
               has_table_privilege('service_role', c.oid, 'SELECT')
               or has_table_privilege('service_role', c.oid, 'INSERT')
               or has_table_privilege('service_role', c.oid, 'UPDATE')
               or has_table_privilege('service_role', c.oid, 'DELETE')
               or has_table_privilege('service_role', c.oid, 'TRUNCATE')
               or has_table_privilege('service_role', c.oid, 'REFERENCES')
               or has_table_privilege('service_role', c.oid, 'TRIGGER')
           )
    ),
    'service_role has no privilege on current app relations'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          cross join lateral pg_catalog.aclexplode(
              coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
          ) acl
         where n.nspname = 'app'
           and c.relkind in ('r', 'p', 'v', 'm', 'f')
           and acl.grantee = 0
           and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ),
    'PUBLIC has no privilege on current app relations'
);

-- Existing sequence ACLs are also private.
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app'
           and c.relkind = 'S'
           and (
               has_sequence_privilege('anon', c.oid, 'USAGE')
               or has_sequence_privilege('anon', c.oid, 'SELECT')
               or has_sequence_privilege('anon', c.oid, 'UPDATE')
           )
    ),
    'anon has no privilege on current app sequences'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app'
           and c.relkind = 'S'
           and (
               has_sequence_privilege('authenticated', c.oid, 'USAGE')
               or has_sequence_privilege('authenticated', c.oid, 'SELECT')
               or has_sequence_privilege('authenticated', c.oid, 'UPDATE')
           )
    ),
    'authenticated has no privilege on current app sequences'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'app'
           and c.relkind = 'S'
           and (
               has_sequence_privilege('service_role', c.oid, 'USAGE')
               or has_sequence_privilege('service_role', c.oid, 'SELECT')
               or has_sequence_privilege('service_role', c.oid, 'UPDATE')
           )
    ),
    'service_role has no privilege on current app sequences'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          cross join lateral pg_catalog.aclexplode(
              coalesce(c.relacl, pg_catalog.acldefault('S', c.relowner))
          ) acl
         where n.nspname = 'app'
           and c.relkind = 'S'
           and acl.grantee = 0
           and acl.privilege_type in ('USAGE', 'SELECT', 'UPDATE')
    ),
    'PUBLIC has no privilege on current app sequences'
);

-- Existing routines must not inherit callable PUBLIC privileges.
select ok(
    not exists (
        select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app'
           and has_function_privilege('anon', p.oid, 'EXECUTE')
    ),
    'anon cannot execute current app routines'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app'
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ),
    'authenticated cannot execute current app routines'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app'
           and has_function_privilege('service_role', p.oid, 'EXECUTE')
    ),
    'service_role cannot execute current app routines'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          cross join lateral pg_catalog.aclexplode(
              coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) acl
         where n.nspname = 'app'
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
    ),
    'PUBLIC cannot execute current app routines'
);

-- Transactional probes prove default ACLs for future migrations.
create table app.__acl_probe_table (id bigint primary key);
create sequence app.__acl_probe_sequence;
create function app.__acl_probe_function()
returns integer
language sql
set search_path = pg_catalog
as $$ select 1 $$;

select ok(
    not (
        has_table_privilege('anon', 'app.__acl_probe_table', 'SELECT')
        or has_table_privilege('anon', 'app.__acl_probe_table', 'INSERT')
        or has_table_privilege('anon', 'app.__acl_probe_table', 'UPDATE')
        or has_table_privilege('anon', 'app.__acl_probe_table', 'DELETE')
    ),
    'future app table gives anon no inherited DML privileges'
);
select ok(
    not (
        has_table_privilege('authenticated', 'app.__acl_probe_table', 'SELECT')
        or has_table_privilege('authenticated', 'app.__acl_probe_table', 'INSERT')
        or has_table_privilege('authenticated', 'app.__acl_probe_table', 'UPDATE')
        or has_table_privilege('authenticated', 'app.__acl_probe_table', 'DELETE')
    ),
    'future app table gives authenticated no inherited DML privileges'
);
select ok(
    not (
        has_table_privilege('service_role', 'app.__acl_probe_table', 'SELECT')
        or has_table_privilege('service_role', 'app.__acl_probe_table', 'INSERT')
        or has_table_privilege('service_role', 'app.__acl_probe_table', 'UPDATE')
        or has_table_privilege('service_role', 'app.__acl_probe_table', 'DELETE')
    ),
    'future app table gives service_role no inherited DML privileges'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          cross join lateral pg_catalog.aclexplode(
              coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
          ) acl
         where n.nspname = 'app'
           and c.relname = '__acl_probe_table'
           and acl.grantee = 0
           and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ),
    'future app table gives PUBLIC no inherited privileges'
);

select ok(
    not (
        has_sequence_privilege('anon', 'app.__acl_probe_sequence', 'USAGE')
        or has_sequence_privilege('anon', 'app.__acl_probe_sequence', 'SELECT')
        or has_sequence_privilege('anon', 'app.__acl_probe_sequence', 'UPDATE')
    ),
    'future app sequence gives anon no inherited privileges'
);
select ok(
    not (
        has_sequence_privilege('authenticated', 'app.__acl_probe_sequence', 'USAGE')
        or has_sequence_privilege('authenticated', 'app.__acl_probe_sequence', 'SELECT')
        or has_sequence_privilege('authenticated', 'app.__acl_probe_sequence', 'UPDATE')
    ),
    'future app sequence gives authenticated no inherited privileges'
);
select ok(
    not (
        has_sequence_privilege('service_role', 'app.__acl_probe_sequence', 'USAGE')
        or has_sequence_privilege('service_role', 'app.__acl_probe_sequence', 'SELECT')
        or has_sequence_privilege('service_role', 'app.__acl_probe_sequence', 'UPDATE')
    ),
    'future app sequence gives service_role no inherited privileges'
);
select ok(
    not exists (
        select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          cross join lateral pg_catalog.aclexplode(
              coalesce(c.relacl, pg_catalog.acldefault('S', c.relowner))
          ) acl
         where n.nspname = 'app'
           and c.relname = '__acl_probe_sequence'
           and acl.grantee = 0
           and acl.privilege_type in ('USAGE', 'SELECT', 'UPDATE')
    ),
    'future app sequence gives PUBLIC no inherited privileges'
);

select ok(not has_function_privilege('anon', 'app.__acl_probe_function()', 'EXECUTE'), 'future app function gives anon no inherited EXECUTE');
select ok(not has_function_privilege('authenticated', 'app.__acl_probe_function()', 'EXECUTE'), 'future app function gives authenticated no inherited EXECUTE');
select ok(not has_function_privilege('service_role', 'app.__acl_probe_function()', 'EXECUTE'), 'future app function gives service_role no inherited EXECUTE');
select ok(
    not exists (
        select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          cross join lateral pg_catalog.aclexplode(
              coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) acl
         where n.nspname = 'app'
           and p.proname = '__acl_probe_function'
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
    ),
    'future app function gives PUBLIC no inherited EXECUTE'
);

select * from finish();
rollback;
