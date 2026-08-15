create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(44);

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

-- KYC fences are intentionally command-specific and RESTRICTIVE.
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'buckets'
          and policyname = 'swiftpay_kyc_buckets_select_fence'
          and permissive = 'RESTRICTIVE' and cmd = 'SELECT'
    ),
    'KYC bucket SELECT fence is restrictive'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'buckets'
          and policyname = 'swiftpay_kyc_buckets_insert_fence'
          and permissive = 'RESTRICTIVE' and cmd = 'INSERT'
    ),
    'KYC bucket INSERT fence is restrictive'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'buckets'
          and policyname = 'swiftpay_kyc_buckets_update_fence'
          and permissive = 'RESTRICTIVE' and cmd = 'UPDATE'
    ),
    'KYC bucket UPDATE fence is restrictive'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'buckets'
          and policyname = 'swiftpay_kyc_buckets_delete_fence'
          and permissive = 'RESTRICTIVE' and cmd = 'DELETE'
    ),
    'KYC bucket DELETE fence is restrictive'
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
            'swiftpay_kyc_buckets_select_fence',
            'swiftpay_kyc_buckets_insert_fence',
            'swiftpay_kyc_buckets_update_fence',
            'swiftpay_kyc_buckets_delete_fence',
            'swiftpay_kyc_objects_select_fence',
            'swiftpay_kyc_objects_insert_fence',
            'swiftpay_kyc_objects_update_fence',
            'swiftpay_kyc_objects_delete_fence'
          )
          and roles @> array['anon'::name, 'authenticated'::name]
    ),
    8::bigint,
    'every KYC fence applies to both anon and authenticated roles'
);

-- Every fence must explicitly scope out the KYC bucket. This also covers the
-- DELETE path structurally because current managed Storage rejects direct SQL
-- DELETE through storage.protect_delete(); runtime deletion belongs to the
-- Storage API and must not be emulated by disabling that protection.
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'buckets'
          and policyname = 'swiftpay_kyc_buckets_select_fence'
          and position('kyc-evidence' in coalesce(qual, '')) > 0
    ),
    'bucket SELECT fence is explicitly scoped to KYC'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'buckets'
          and policyname = 'swiftpay_kyc_buckets_insert_fence'
          and position('kyc-evidence' in coalesce(with_check, '')) > 0
    ),
    'bucket INSERT fence is explicitly scoped to KYC'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'buckets'
          and policyname = 'swiftpay_kyc_buckets_update_fence'
          and position('kyc-evidence' in coalesce(qual, '')) > 0
          and position('kyc-evidence' in coalesce(with_check, '')) > 0
    ),
    'bucket UPDATE fence is explicitly scoped to KYC'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'buckets'
          and policyname = 'swiftpay_kyc_buckets_delete_fence'
          and position('kyc-evidence' in coalesce(qual, '')) > 0
    ),
    'bucket DELETE fence is explicitly scoped to KYC'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'swiftpay_kyc_objects_select_fence'
          and position('kyc-evidence' in coalesce(qual, '')) > 0
    ),
    'object SELECT fence is explicitly scoped to KYC'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'swiftpay_kyc_objects_insert_fence'
          and position('kyc-evidence' in coalesce(with_check, '')) > 0
    ),
    'object INSERT fence is explicitly scoped to KYC'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'swiftpay_kyc_objects_update_fence'
          and position('kyc-evidence' in coalesce(qual, '')) > 0
          and position('kyc-evidence' in coalesce(with_check, '')) > 0
    ),
    'object UPDATE fence is explicitly scoped to KYC'
);
select ok(
    exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'swiftpay_kyc_objects_delete_fence'
          and position('kyc-evidence' in coalesce(qual, '')) > 0
    ),
    'object DELETE fence is explicitly scoped to KYC'
);

-- Simulate a future careless feature that adds broad permissive Storage
-- policies. Restrictive KYC fences must still win, while non-KYC rows remain
-- governed by those permissive policies.
create policy __swiftpay_probe_buckets_select
on storage.buckets as permissive for select
to anon, authenticated
using (true);

create policy __swiftpay_probe_buckets_insert
on storage.buckets as permissive for insert
to anon, authenticated
with check (true);

create policy __swiftpay_probe_buckets_update
on storage.buckets as permissive for update
to anon, authenticated
using (true)
with check (true);

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

set local role authenticated;
insert into storage.buckets (id, name, public)
values ('__swiftpay_storage_probe', '__swiftpay_storage_probe', false);
reset role;
select ok(
    exists (select 1 from storage.buckets where id = '__swiftpay_storage_probe'),
    'authenticated broad permissive INSERT works for non-KYC bucket metadata'
);

set local role authenticated;
select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('kyc-evidence', '__probe/authenticated-insert')$$,
    '42501',
    null,
    'authenticated cannot insert KYC object metadata under broad permissive INSERT'
);
reset role;

set local role authenticated;
insert into storage.objects (bucket_id, name, metadata)
values ('__swiftpay_storage_probe', '__probe/non-kyc-object', null);
reset role;
select ok(
    exists (
        select 1 from storage.objects
        where bucket_id = '__swiftpay_storage_probe'
          and name = '__probe/non-kyc-object'
    ),
    'authenticated broad permissive INSERT works for non-KYC object metadata'
);

insert into storage.objects (bucket_id, name, metadata)
values ('kyc-evidence', '__probe/kyc-object', null)
on conflict (bucket_id, name) do nothing;

set local role anon;
select is(
    (select count(*) from storage.buckets where id = 'kyc-evidence'),
    0::bigint,
    'anon cannot observe KYC bucket under broad permissive SELECT'
);
select is(
    (select count(*) from storage.buckets where id = '__swiftpay_storage_probe'),
    1::bigint,
    'anon can observe explicitly-permitted non-KYC bucket metadata'
);
select is(
    (select count(*) from storage.objects where bucket_id = 'kyc-evidence'),
    0::bigint,
    'anon cannot observe KYC object metadata under broad permissive SELECT'
);
select is(
    (select count(*) from storage.objects where bucket_id = '__swiftpay_storage_probe'),
    1::bigint,
    'anon can observe explicitly-permitted non-KYC object metadata'
);
reset role;

set local role authenticated;
select is(
    (select count(*) from storage.buckets where id = 'kyc-evidence'),
    0::bigint,
    'authenticated cannot observe KYC bucket under broad permissive SELECT'
);
select is(
    (select count(*) from storage.buckets where id = '__swiftpay_storage_probe'),
    1::bigint,
    'authenticated can observe explicitly-permitted non-KYC bucket metadata'
);
select is(
    (select count(*) from storage.objects where bucket_id = 'kyc-evidence'),
    0::bigint,
    'authenticated cannot observe KYC object metadata under broad permissive SELECT'
);
select is(
    (select count(*) from storage.objects where bucket_id = '__swiftpay_storage_probe'),
    1::bigint,
    'authenticated can observe explicitly-permitted non-KYC object metadata'
);

update storage.buckets
   set public = true
 where id = 'kyc-evidence';
reset role;
select is(
    (select public from storage.buckets where id = 'kyc-evidence'),
    false,
    'authenticated cannot make KYC bucket public under broad permissive UPDATE'
);

set local role authenticated;
update storage.buckets
   set public = true
 where id = '__swiftpay_storage_probe';
reset role;
select is(
    (select public from storage.buckets where id = '__swiftpay_storage_probe'),
    true,
    'authenticated broad permissive UPDATE works for non-KYC bucket metadata'
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
update storage.objects
   set metadata = '{"allowed":true}'::jsonb
 where bucket_id = '__swiftpay_storage_probe'
   and name = '__probe/non-kyc-object';
reset role;
select is(
    (select metadata from storage.objects
      where bucket_id = '__swiftpay_storage_probe'
        and name = '__probe/non-kyc-object'),
    '{"allowed": true}'::jsonb,
    'authenticated broad permissive UPDATE works for non-KYC object metadata'
);

set local role anon;
update storage.buckets
   set public = true
 where id = 'kyc-evidence';
reset role;
select is(
    (select public from storage.buckets where id = 'kyc-evidence'),
    false,
    'anon cannot make KYC bucket public under broad permissive UPDATE'
);

set local role anon;
select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('kyc-evidence', '__probe/anon-insert')$$,
    '42501',
    null,
    'anon cannot insert KYC object metadata under broad permissive INSERT'
);
reset role;

set local role anon;
update storage.objects
   set metadata = '{"anon_tampered":true}'::jsonb
 where bucket_id = 'kyc-evidence'
   and name = '__probe/kyc-object';
reset role;
select ok(
    (select metadata is null
       from storage.objects
      where bucket_id = 'kyc-evidence'
        and name = '__probe/kyc-object'),
    'anon cannot mutate KYC object metadata under broad permissive UPDATE'
);

-- Existing database/API hardening remains intact.
select ok(not has_schema_privilege('anon', 'app', 'USAGE'), 'K1 preserves anon denial on private app schema');
select ok(not has_schema_privilege('authenticated', 'app', 'USAGE'), 'K1 preserves authenticated denial on private app schema');
select ok(not has_schema_privilege('service_role', 'app', 'USAGE'), 'K1 preserves service_role denial on private app schema');

select * from finish();
rollback;
