create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(6);

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

insert into app.merchants (id, name, lifecycle_status)
values ('a1700000-0000-4000-8000-000000000010'::uuid, 'A17 pgTAP merchant', 'active');

insert into app.webhook_endpoints (
  id, merchant_id, environment, url, status, secret_ciphertext, secret_version, subscribed_events
) values (
  'a1700000-0000-4000-8000-000000000011'::uuid,
  'a1700000-0000-4000-8000-000000000010'::uuid,
  'sandbox',
  'https://merchant-a17.example.test/webhook',
  'active',
  'rsa-oaep-sha256-v1$QUJD',
  1,
  '["payment.paid"]'::jsonb
);

select throws_ok(
  $$
    insert into app.webhook_endpoint_secret_versions (
      webhook_endpoint_id, secret_version, ciphertext_format, wrapping_key_id, secret_ciphertext
    ) values (
      'a1700000-0000-4000-8000-000000000011'::uuid,
      2,
      'aes-256-gcm-v1',
      'webhook-wrap-a17-v1',
      'aes-256-gcm-v1$historical-only'
    )
  $$,
  '23514',
  'A17 direct AES secret-version insertion must be rejected'
);

select throws_ok(
  $$
    insert into app.webhook_endpoint_secret_versions (
      webhook_endpoint_id, secret_version, ciphertext_format, wrapping_key_id, secret_ciphertext
    ) values (
      'a1700000-0000-4000-8000-000000000011'::uuid,
      3,
      'rsa-oaep-sha256-v1',
      null,
      'rsa-oaep-sha256-v1$QUJD'
    )
  $$,
  '23502',
  'A17 RSA secret-version insertion with null wrapping key id must be rejected'
);

select lives_ok(
  $$
    insert into app.webhook_endpoint_secret_versions (
      webhook_endpoint_id, secret_version, ciphertext_format, wrapping_key_id, secret_ciphertext
    ) values (
      'a1700000-0000-4000-8000-000000000011'::uuid,
      4,
      'rsa-oaep-sha256-v1',
      'webhook-wrap-a17-v1',
      'rsa-oaep-sha256-v1$QUJD'
    )
  $$,
  'A17 valid RSA secret-version row with explicit wrapping key id must be accepted'
);

select * from finish();
rollback;