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

-- Replace the A7 claim routine without changing its signature or grants. A17
-- removes the former current/previous endpoint-mirror fallback that labelled
-- missing history as legacy AES. Only explicit RSA history can now authorize
-- signing-secret unwrap; absent or unusable history is returned as unavailable.
create or replace function app.claim_merchant_webhook_deliveries(
    p_worker_id text,
    p_limit integer,
    p_lease_seconds integer
)
returns setof jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_worker_id text;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_candidate record;
    v_lease_token uuid;
    v_lease_expires_at timestamptz;
    v_attempt_number integer;
    v_secret_ciphertext text;
    v_ciphertext_format text;
    v_wrapping_key_id text;
begin
    v_worker_id := pg_catalog.btrim(p_worker_id);
    if v_worker_id is null
       or pg_catalog.length(v_worker_id) = 0
       or pg_catalog.length(v_worker_id) > 160 then
        raise exception using errcode = '22023', message = 'invalid webhook worker id';
    end if;
    if p_limit is null or p_limit < 1 or p_limit > 50 then
        raise exception using errcode = '22023', message = 'invalid webhook claim limit';
    end if;
    if p_lease_seconds is null or p_lease_seconds < 5 or p_lease_seconds > 300 then
        raise exception using errcode = '22023', message = 'invalid webhook lease seconds';
    end if;

    for v_candidate in
        select j.id as job_id, d.id as delivery_id
          from app.jobs j
          join app.webhook_deliveries d on d.id = j.resource_id
          join app.webhook_events ev on ev.id = d.webhook_event_id
          join app.webhook_endpoints ep
            on ep.id = d.webhook_endpoint_id
           and ep.merchant_id = ev.merchant_id
           and ep.environment = ev.environment
         where j.kind = 'merchant_webhook_delivery'
           and j.resource_type = 'webhook_delivery'
           and j.payload_version = 1
           and pg_catalog.jsonb_typeof(j.payload) = 'object'
           and j.payload ->> 'webhook_delivery_id' = d.id::text
           and ep.status = 'disabled'
           and (
                (j.state = 'pending' and d.state = 'pending'
                    and j.available_at <= v_now and d.next_attempt_at <= v_now)
                or
                (j.state = 'leased' and d.state = 'leased'
                    and j.lease_expires_at <= v_now and d.lease_expires_at <= v_now
                    and j.lease_token = d.lease_token)
           )
         order by
             case when j.state = 'leased' then j.lease_expires_at else j.available_at end,
             j.created_at,
             j.id
         for update of j, d skip locked
         limit p_limit
    loop
        update app.jobs
           set state = 'completed', lease_owner = null, lease_token = null,
               lease_expires_at = null, last_finished_at = v_now,
               completed_at = v_now, last_error_class = null,
               last_error_code = null, updated_at = v_now
         where id = v_candidate.job_id;
        update app.webhook_deliveries
           set state = 'disabled', lease_token = null, lease_expires_at = null,
               last_error_class = null, last_error_code = null, updated_at = v_now
         where id = v_candidate.delivery_id;
    end loop;

    for v_candidate in
        select
            j.id as job_id,
            j.max_attempts,
            d.id as delivery_id,
            d.signing_secret_version,
            d.endpoint_url_snapshot as endpoint_url,
            ep.id as endpoint_id,
            ep.environment as endpoint_environment,
            ep.secret_version as current_secret_version,
            sv.secret_version as selected_secret_version,
            sv.ciphertext_format,
            sv.wrapping_key_id,
            sv.secret_ciphertext,
            sv.usable_until,
            ev.id as event_id,
            ev.type as event_type,
            ev.occurred_at,
            ev.payload_version,
            ev.payload_snapshot
          from app.jobs j
          join app.webhook_deliveries d on d.id = j.resource_id
          join app.webhook_events ev on ev.id = d.webhook_event_id
          join app.webhook_endpoints ep
            on ep.id = d.webhook_endpoint_id
           and ep.merchant_id = ev.merchant_id
           and ep.environment = ev.environment
          left join app.webhook_endpoint_secret_versions sv
            on sv.webhook_endpoint_id = d.webhook_endpoint_id
           and sv.secret_version = d.signing_secret_version
         where j.kind = 'merchant_webhook_delivery'
           and j.resource_type = 'webhook_delivery'
           and j.payload_version = 1
           and pg_catalog.jsonb_typeof(j.payload) = 'object'
           and j.payload ->> 'webhook_delivery_id' = d.id::text
           and ep.status = 'active'
           and j.attempt_count = d.attempt_count
           and j.attempt_count < j.max_attempts
           and (
                (j.state = 'pending' and d.state = 'pending'
                    and j.available_at <= v_now and d.next_attempt_at <= v_now)
                or
                (j.state = 'leased' and d.state = 'leased'
                    and j.lease_expires_at <= v_now and d.lease_expires_at <= v_now
                    and j.lease_token = d.lease_token)
           )
         order by
             case when j.state = 'leased' then j.lease_expires_at else j.available_at end,
             j.created_at,
             j.id
         for update of j, d skip locked
         limit p_limit
    loop
        v_lease_token := pg_catalog.gen_random_uuid();
        v_lease_expires_at := v_now + pg_catalog.make_interval(secs => p_lease_seconds);
        select attempt_count + 1 into v_attempt_number
          from app.jobs where id = v_candidate.job_id;

        update app.jobs
           set state = 'leased', attempt_count = v_attempt_number,
               lease_owner = v_worker_id, lease_token = v_lease_token,
               lease_expires_at = v_lease_expires_at,
               last_started_at = v_now, updated_at = v_now
         where id = v_candidate.job_id;
        update app.webhook_deliveries
           set state = 'leased', attempt_count = v_attempt_number,
               lease_token = v_lease_token, lease_expires_at = v_lease_expires_at,
               first_attempt_at = coalesce(first_attempt_at, v_now),
               last_attempt_at = v_now, updated_at = v_now
         where id = v_candidate.delivery_id;

        if v_candidate.selected_secret_version is not null then
            if v_candidate.signing_secret_version = v_candidate.current_secret_version
               or (v_candidate.usable_until is not null and v_candidate.usable_until > v_now) then
                v_secret_ciphertext := v_candidate.secret_ciphertext;
                v_ciphertext_format := v_candidate.ciphertext_format;
                v_wrapping_key_id := v_candidate.wrapping_key_id;
            else
                v_secret_ciphertext := null;
                v_ciphertext_format := v_candidate.ciphertext_format;
                v_wrapping_key_id := v_candidate.wrapping_key_id;
            end if;
        else
            v_secret_ciphertext := null;
            v_ciphertext_format := null;
            v_wrapping_key_id := null;
        end if;

        return next pg_catalog.jsonb_build_object(
            'jobId', v_candidate.job_id::text,
            'deliveryId', v_candidate.delivery_id::text,
            'leaseToken', v_lease_token::text,
            'attemptNumber', v_attempt_number,
            'maxAttempts', v_candidate.max_attempts,
            'leaseExpiresAt', pg_catalog.to_char(v_lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'endpoint', pg_catalog.jsonb_build_object(
                'id', v_candidate.endpoint_id::text,
                'url', v_candidate.endpoint_url,
                'environment', v_candidate.endpoint_environment,
                'signingSecretVersion', v_candidate.signing_secret_version,
                'signingSecretCiphertext', v_secret_ciphertext,
                'signingSecretCiphertextFormat', v_ciphertext_format,
                'signingSecretWrappingKeyId', v_wrapping_key_id
            ),
            'event', pg_catalog.jsonb_build_object(
                'id', v_candidate.event_id::text,
                'type', v_candidate.event_type,
                'occurredAt', pg_catalog.to_char(v_candidate.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                'payloadVersion', v_candidate.payload_version,
                'payload', v_candidate.payload_snapshot
            )
        );
    end loop;
    return;
end;
$$;

revoke all on function app.claim_merchant_webhook_deliveries(text, integer, integer)
    from public, anon, authenticated, service_role, swiftpay_api;
grant execute on function app.claim_merchant_webhook_deliveries(text, integer, integer)
    to swiftpay_worker;
