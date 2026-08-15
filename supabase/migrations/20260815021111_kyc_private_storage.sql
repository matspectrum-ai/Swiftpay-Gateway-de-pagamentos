-- SwiftPay V2 K1: private KYC evidence Storage boundary.
--
-- Runtime object operations remain owned by the managed Storage API. This
-- migration configures one private bucket and fail-closed browser RLS fences;
-- it does not alter managed Storage tables, triggers or helper functions.

insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
) values (
    'kyc-evidence',
    'kyc-evidence',
    false,
    10485760,
    null
);

create policy swiftpay_kyc_buckets_select_fence
on storage.buckets
as restrictive
for select
to anon, authenticated
using (id <> 'kyc-evidence');

create policy swiftpay_kyc_buckets_insert_fence
on storage.buckets
as restrictive
for insert
to anon, authenticated
with check (id <> 'kyc-evidence');

create policy swiftpay_kyc_buckets_update_fence
on storage.buckets
as restrictive
for update
to anon, authenticated
using (id <> 'kyc-evidence')
with check (id <> 'kyc-evidence');

create policy swiftpay_kyc_buckets_delete_fence
on storage.buckets
as restrictive
for delete
to anon, authenticated
using (id <> 'kyc-evidence');

create policy swiftpay_kyc_objects_select_fence
on storage.objects
as restrictive
for select
to anon, authenticated
using (bucket_id <> 'kyc-evidence');

create policy swiftpay_kyc_objects_insert_fence
on storage.objects
as restrictive
for insert
to anon, authenticated
with check (bucket_id <> 'kyc-evidence');

create policy swiftpay_kyc_objects_update_fence
on storage.objects
as restrictive
for update
to anon, authenticated
using (bucket_id <> 'kyc-evidence')
with check (bucket_id <> 'kyc-evidence');

create policy swiftpay_kyc_objects_delete_fence
on storage.objects
as restrictive
for delete
to anon, authenticated
using (bucket_id <> 'kyc-evidence');
