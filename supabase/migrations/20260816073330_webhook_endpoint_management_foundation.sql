-- SwiftPay V2 A7: merchant webhook endpoint management structural foundation.
--
-- This migration adds optimistic concurrency, immutable delivery URL snapshots
-- and durable signing-secret version history. It adds no direct Data API or
-- runtime table authority.

alter table app.webhook_endpoints
    add column revision bigint not null default 1;

alter table app.webhook_endpoints
    add constraint webhook_endpoints_revision_ck
    check (revision > 0);

alter table app.webhook_deliveries
    add column endpoint_url_snapshot text;

update app.webhook_deliveries d
   set endpoint_url_snapshot = e.url
  from app.webhook_endpoints e
 where e.id = d.webhook_endpoint_id;

alter table app.webhook_deliveries
    alter column endpoint_url_snapshot set not null;

alter table app.webhook_deliveries
    add constraint webhook_deliveries_endpoint_url_snapshot_nonempty_ck
    check (pg_catalog.length(pg_catalog.btrim(endpoint_url_snapshot)) > 0);

create table app.webhook_endpoint_secret_versions (
    webhook_endpoint_id uuid not null
        references app.webhook_endpoints(id) on delete restrict,
    secret_version integer not null,
    ciphertext_format text not null,
    wrapping_key_id text,
    secret_ciphertext text not null,
    usable_until timestamptz,
    created_at timestamptz not null default now(),
    primary key (webhook_endpoint_id, secret_version),
    constraint webhook_endpoint_secret_versions_version_ck
        check (secret_version > 0),
    constraint webhook_endpoint_secret_versions_format_ck
        check (ciphertext_format in ('aes-256-gcm-v1', 'rsa-oaep-sha256-v1')),
    constraint webhook_endpoint_secret_versions_ciphertext_nonempty_ck
        check (pg_catalog.length(pg_catalog.btrim(secret_ciphertext)) > 0),
    constraint webhook_endpoint_secret_versions_wrapping_shape_ck
        check (
            (ciphertext_format = 'aes-256-gcm-v1' and wrapping_key_id is null)
            or
            (
                ciphertext_format = 'rsa-oaep-sha256-v1'
                and wrapping_key_id is not null
                and pg_catalog.length(wrapping_key_id) between 1 and 64
                and wrapping_key_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
            )
        )
);

insert into app.webhook_endpoint_secret_versions (
    webhook_endpoint_id,
    secret_version,
    ciphertext_format,
    wrapping_key_id,
    secret_ciphertext,
    usable_until,
    created_at
)
select
    e.id,
    e.secret_version,
    'aes-256-gcm-v1',
    null,
    e.secret_ciphertext,
    null,
    e.created_at
from app.webhook_endpoints e
on conflict (webhook_endpoint_id, secret_version) do nothing;

insert into app.webhook_endpoint_secret_versions (
    webhook_endpoint_id,
    secret_version,
    ciphertext_format,
    wrapping_key_id,
    secret_ciphertext,
    usable_until,
    created_at
)
select
    e.id,
    e.previous_secret_version,
    'aes-256-gcm-v1',
    null,
    e.previous_secret_ciphertext,
    e.previous_secret_expires_at,
    e.updated_at
from app.webhook_endpoints e
where e.previous_secret_version is not null
  and e.previous_secret_ciphertext is not null
  and e.previous_secret_expires_at is not null
on conflict (webhook_endpoint_id, secret_version) do nothing;

create index webhook_endpoint_secret_versions_usable_idx
    on app.webhook_endpoint_secret_versions (
        webhook_endpoint_id,
        usable_until,
        secret_version desc
    );

revoke all on app.webhook_endpoint_secret_versions
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

alter default privileges in schema app revoke all on tables
    from public, anon, authenticated, service_role;
