-- SwiftPay V2 A17: retire legacy AES persisted webhook signing-secret authority.
--
-- This migration is intentionally abortive. If any historical AES secret-version
-- row exists, a separately reviewed data-migration plan is required. A17 never
-- deletes, rewrites, expires or relabels such material automatically.

do $$
declare
    v_legacy_aes_count bigint;
begin
    select count(*)
      into v_legacy_aes_count
      from app.webhook_endpoint_secret_versions
     where ciphertext_format = 'aes-256-gcm-v1';

    if v_legacy_aes_count <> 0 then
        raise exception 'A17 migration blocked: legacy AES webhook secret versions exist'
            using errcode = '23514';
    end if;
end
$$;

alter table app.webhook_endpoint_secret_versions
    drop constraint webhook_endpoint_secret_versions_format_ck;

alter table app.webhook_endpoint_secret_versions
    drop constraint webhook_endpoint_secret_versions_wrapping_shape_ck;

alter table app.webhook_endpoint_secret_versions
    alter column wrapping_key_id set not null;

alter table app.webhook_endpoint_secret_versions
    add constraint webhook_endpoint_secret_versions_format_ck
    check (ciphertext_format = 'rsa-oaep-sha256-v1');

alter table app.webhook_endpoint_secret_versions
    add constraint webhook_endpoint_secret_versions_wrapping_shape_ck
    check (
        wrapping_key_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
    );

alter table app.webhook_endpoint_secret_versions
    add constraint webhook_endpoint_secret_versions_rsa_ciphertext_shape_ck
    check (
        secret_ciphertext ~ '^rsa-oaep-sha256-v1\$[A-Za-z0-9_-]+$'
    );
