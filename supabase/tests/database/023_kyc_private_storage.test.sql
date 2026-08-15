create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(28);

-- Structural bucket contract. The fixture insert below keeps behavioral RED
-- diagnostic even before the migration creates the bucket.
select ok(
    exists (select 1 from storage.buckets where id = 'kyc-evidence'),
    'dedicated KYC evidence bucket exists'
);

insert into storage.buckets (
    id, name, public, file_size_limit, allowed_mime_types
) values (
    'kyc-evidence', 'kyc-evidence', false, 10485760, null
)
on conflict (id) do nothing;

select is(
    (select public from storage.buckets where id = 'kyc-evidence'),
    false,
    'KYC evidence bucket is private'
);
select is(
    (select file_size_limit from storage.buckets where id = 'kyc-evidence'),
    10485760::bigint,
    'KYC evidence bucket enforces the 10 MiB ceiling'
);
select ok(
    (select allowed_mime_types is null from storage.buckets where id = 'kyc-evidence'),
    'K1 does not invent an unapproved compliance MIME allowlist'
);

select ok(
    (select c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage' and c.relname = 'objects'),
    'storage.objects RLS remains enabled'
);
select ok(
    (select c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage' and c.relname = 'buckets'),
    'storage.buckets RLS remains enabled'
);

-- KYC fences must be restrictive so a future permissive catch-all cannot open
-- this bucket accidentally.
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'buckets'
          and policyname = 'swiftpay_kyc_bucket_browser_fence'
          and permissive = 'RESTRICTIVE' and cmd = 'SELECT'
    ),
    'KYC bucket metadata SELECT fence is restrictive'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'swiftpay_kyc_objects_select_fence'
          and permissive = 'RESTRICTIVE' and cmd = 'SELECT'
    ),
    'KYC object SELECT fence is restrictive'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'swiftpay_kyc_objects_insert_fence'
          and permissive = 'RESTRICTIVE' and cmd = 'INSERT'
    ),
    'KYC object INSERT fence is restrictive'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'swiftpay_kyc_objects_update_fence'
          and permissive = 'RESTRICTIVE' and cmd = 'UPDATE'
    ),
    'KYC object UPDATE fence is restrictive'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'swiftpay_kyc_objects_delete_fence'
          and permissive = 'RESTRICTIVE' and cmd = 'DELETE'
    ),
    'KYC object DELETE fence is restrictive'
);
select is(
    (
        select count(*)::bigint
        from pg_policies
        where schemaname = 'storage'
          and policyname in (
            'swiftpay_kyc_bucket_browser_fence',
            'swiftpay_kyc_objects_select_fence',
            'swiftpay_kyc_objects_insert_fence',
            'swiftpay_kyc_objects_update_fence',
            'swiftpay_kyc_objects_delete_fence'
          )
          and roles @> array['anon'::name, 'authenticated'::name]
    ),
    5::bigint,
    'every KYC fence applies to both anon and authenticated roles'
);

-- Probe a future careless feature that adds broad permissive Storage policies.
-- The KYC restrictive policies must still win for KYC while leaving non-KYC
-- rows to their own authorization contract.
insert into storage.buckets (id, name, public)
values ('__swiftpay_storage_probe', '__swiftpay_storage_probe', false)
on conflict (id) do nothing;

insert into storage.objects (bucket_id, name, metadata)
values
    ('kyc-evidence', '__probe/kyc-object', null),
    ('__swiftpay_storage_probe', '__probe/non-kyc-object', null)
on conflict (bucket_id, name) do nothing;

create policy __swiftpay_probe_buckets_select
on storage.buckets as permissive for select
to anon, authenticated
using (true);

create policy __swiftpay_probe_objects_select
on storage.objects as permissive for select
to anon, authenticated
using (true);

create policy __swiftpay_probe_objects_insert
on storage.objects as permissive for insert
to anon, authenticated
with check (true);

create policy __swiftpay_probe_objects_update
on storage.objects as permissive for update
to anon, authenticated
using (true)
with check (true);

create policy __swiftpay_probe_objects_delete
on storage.objects as permissive for delete
to anon, authenticated
using (true);

set local role anon;
select is(
    (select count(*) from storage.buckets where id = 'kyc-evidence'),
    0::bigint,
    'anon cannot observe KYC bucket even under a broad permissive SELECT policy'
);
select is(
    (select count(*) from storage.buckets where id = '__swiftpay_storage_probe'),
    1::bigint,
    'KYC bucket fence does not globally hide non-KYC buckets'
);
select is(
    (select count(*) from storage.objects where bucket_id = 'kyc-evidence'),
    0::bigint,
    'anon cannot observe KYC object metadata under broad permissive SELECT'
);
select is(
    (select count(*) from storage.objects where bucket_id = '__swiftpay_storage_probe'),
    1::bigint,
    'KYC object fence does not globally hide non-KYC objects'
);
reset role;

set local role authenticated;
select is(
    (select count(*) from storage.buckets where id = 'kyc-evidence'),
    0::bigint,
    'authenticated cannot observe KYC bucket even under broad permissive SELECT'
);
select is(
    (select count(*) from storage.buckets where id = '__swiftpay_storage_probe'),
    1::bigint,
    'authenticated can still reach explicitly-permitted non-KYC bucket metadata'
);
select is(
    (select count(*) from storage.objects where bucket_id = 'kyc-evidence'),
    0::bigint,
    'authenticated cannot observe KYC objects even under broad permissive SELECT'
);
select is(
    (select count(*) from storage.objects where bucket_id = '__swiftpay_storage_probe'),
    1::bigint,
    'authenticated can still reach explicitly-permitted non-KYC object metadata'
);

select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('kyc-evidence', '__probe/authenticated-insert')$$,
    '42501',
    null,
    'authenticated cannot insert KYC object metadata even under broad permissive INSERT'
);

insert into storage.objects (bucket_id, name)
values ('__swiftpay_storage_probe', '__probe/authenticated-insert');
reset role;
select ok(
    exists (
        select 1 from storage.objects
        where bucket_id = '__swiftpay_storage_probe'
          and name = '__probe/authenticated-insert'
    ),
    'authenticated broad permissive INSERT still works for non-KYC probe bucket'
);

set local role authenticated;
update storage.objects
   set metadata = '{"tampered":true}'::jsonb
 where bucket_id = 'kyc-evidence'
   and name = '__probe/kyc-object';
reset role;
select ok(
    (select metadata is null
       from storage.objects
      where bucket_id = 'kyc-evidence'
        and name = '__probe/kyc-object'),
    'authenticated cannot mutate KYC object metadata under broad permissive UPDATE'
);

set local role authenticated;
delete from storage.objects
 where bucket_id = 'kyc-evidence'
   and name = '__probe/kyc-object';
reset role;
select ok(
    exists (
        select 1 from storage.objects
        where bucket_id = 'kyc-evidence'
          and name = '__probe/kyc-object'
    ),
    'authenticated cannot delete KYC object metadata under broad permissive DELETE'
);

-- Existing database/API hardening remains intact.
select ok(not has_schema_privilege('anon', 'app', 'USAGE'), 'K1 preserves anon denial on private app schema');
select ok(not has_schema_privilege('authenticated', 'app', 'USAGE'), 'K1 preserves authenticated denial on private app schema');
select ok(not has_schema_privilege('service_role', 'app', 'USAGE'), 'K1 preserves service_role denial on private app schema');

select * from finish();
rollback;
