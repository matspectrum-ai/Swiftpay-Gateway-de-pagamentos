create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(3);

select col_not_null(
  'app',
  'webhook_endpoint_secret_versions',
  'wrapping_key_id',
  'A17 every persisted webhook secret version must require an explicit wrapping key id'
);

select ok(
  not exists (
    select 1
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'app'
       and t.relname = 'webhook_endpoint_secret_versions'
       and c.contype = 'c'
       and pg_catalog.pg_get_constraintdef(c.oid) like '%aes-256-gcm-v1%'
  ),
  'A17 persisted webhook secret constraints must contain no AES compatibility branch'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'app'
       and t.relname = 'webhook_endpoint_secret_versions'
       and c.contype = 'c'
       and pg_catalog.pg_get_constraintdef(c.oid) like '%rsa-oaep-sha256-v1%'
  ),
  'A17 RSA-OAEP-SHA256 persisted-secret authority must remain present'
);

select * from finish();
rollback;