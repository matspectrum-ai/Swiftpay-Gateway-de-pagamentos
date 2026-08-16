-- SwiftPay V2 A7: merchant webhook endpoint management behavior.
--
-- This migration preserves the A4 worker claim/resolve boundary while adding:
-- * immutable URL + signing-secret-version delivery snapshots;
-- * exact secret-version lookup across rotation history;
-- * narrow dashboard API management routines;
-- * durable request idempotency and append-only audit composition.

create or replace function app._a7_webhook_endpoint_json(p_endpoint_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select pg_catalog.jsonb_build_object(
        'id', e.id::text,
        'merchantId', e.merchant_id::text,
        'environment', e.environment,
        'url', e.url,
        'status', e.status,
        'subscribedEvents', e.subscribed_events,
        'secretVersion', e.secret_version,
        'revision', e.revision,
        'createdAt', pg_catalog.to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', pg_catalog.to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
    from app.webhook_endpoints e
    where e.id = p_endpoint_id
$$;

revoke all on function app._a7_webhook_endpoint_json(uuid)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

-- Freeze both URL and signing-secret version at fanout. Replaying an existing
-- logical event still returns the original event and never fans out again.
create or replace function app.record_webhook_event(
    p_merchant_id uuid,
    p_environment text,
    p_type text,
    p_resource_type text,
    p_resource_id uuid,
    p_source_type text,
    p_source_id uuid,
    p_payload_version text,
    p_payload_snapshot jsonb,
    p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_event_id uuid;
    v_existing app.webhook_events%rowtype;
    v_delivery_id uuid;
begin
    if p_merchant_id is null then
        raise exception 'webhook merchant is required' using errcode = '23514';
    end if;
    if p_environment not in ('sandbox', 'production') then
        raise exception 'invalid webhook environment' using errcode = '23514';
    end if;
    if p_type is null or length(trim(p_type)) = 0
       or p_resource_type is null or length(trim(p_resource_type)) = 0
       or p_resource_id is null
       or p_source_type is null or length(trim(p_source_type)) = 0
       or p_source_id is null
       or p_payload_version is null or length(trim(p_payload_version)) = 0
       or p_payload_snapshot is null
       or jsonb_typeof(p_payload_snapshot) <> 'object'
       or p_occurred_at is null then
        raise exception 'invalid merchant webhook event identity/payload'
            using errcode = '23514';
    end if;

    insert into app.webhook_events (
        merchant_id, environment, type, resource_type, resource_id,
        source_type, source_id, payload_version, payload_snapshot, occurred_at
    ) values (
        p_merchant_id, p_environment, p_type, p_resource_type, p_resource_id,
        p_source_type, p_source_id, p_payload_version, p_payload_snapshot, p_occurred_at
    )
    on conflict (merchant_id, environment, source_type, source_id, type)
    do nothing
    returning id into v_event_id;

    if v_event_id is null then
        select * into strict v_existing
          from app.webhook_events
         where merchant_id = p_merchant_id
           and environment = p_environment
           and source_type = p_source_type
           and source_id = p_source_id
           and type = p_type;
        if v_existing.resource_type is distinct from p_resource_type
           or v_existing.resource_id is distinct from p_resource_id
           or v_existing.payload_version is distinct from p_payload_version
           or v_existing.payload_snapshot is distinct from p_payload_snapshot then
            raise exception 'webhook source identity reused with different logical event'
                using errcode = '23505';
        end if;
        return v_existing.id;
    end if;

    for v_delivery_id in
        insert into app.webhook_deliveries (
            webhook_event_id,
            webhook_endpoint_id,
            signing_secret_version,
            endpoint_url_snapshot,
            state,
            attempt_count,
            next_attempt_at
        )
        select
            v_event_id,
            e.id,
            e.secret_version,
            e.url,
            'pending',
            0,
            pg_catalog.clock_timestamp()
        from app.webhook_endpoints e
        where e.merchant_id = p_merchant_id
          and e.environment = p_environment
          and e.status = 'active'
          and e.subscribed_events ? p_type
        on conflict (webhook_event_id, webhook_endpoint_id) do nothing
        returning id
    loop
        perform app.enqueue_job(
            'merchant_webhook_delivery',
            'webhook_delivery',
            v_delivery_id,
            'merchant-webhook-delivery:' || v_delivery_id::text || ':send',
            pg_catalog.jsonb_build_object('webhook_delivery_id', v_delivery_id),
            1,
            8,
            pg_catalog.clock_timestamp()
        );
    end loop;

    return v_event_id;
end;
$$;

-- A7 replaces A4 current+previous selection with exact durable version history
-- and uses the URL snapshotted on the delivery rather than mutable endpoint URL.
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

    -- Disabled endpoints terminalize eligible pending/expired work with no HTTP attempt.
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
               first_attempt_at = pg_catalog.coalesce(first_attempt_at, v_now),
               last_attempt_at = v_now, updated_at = v_now
         where id = v_candidate.delivery_id;

        if v_candidate.selected_secret_version is null then
            v_secret_ciphertext := null;
            v_ciphertext_format := null;
            v_wrapping_key_id := null;
        elsif v_candidate.signing_secret_version = v_candidate.current_secret_version
              or (v_candidate.usable_until is not null and v_candidate.usable_until > v_now) then
            v_secret_ciphertext := v_candidate.secret_ciphertext;
            v_ciphertext_format := v_candidate.ciphertext_format;
            v_wrapping_key_id := v_candidate.wrapping_key_id;
        else
            v_secret_ciphertext := null;
            v_ciphertext_format := v_candidate.ciphertext_format;
            v_wrapping_key_id := v_candidate.wrapping_key_id;
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

create or replace function app.list_dashboard_webhook_endpoints(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, 'member');
    return query
    select app._a7_webhook_endpoint_json(e.id)
      from app.webhook_endpoints e
     where e.merchant_id = p_merchant_id
       and e.environment = p_environment
     order by e.created_at desc, e.id desc;
end;
$$;

create or replace function app.get_dashboard_webhook_endpoint(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_endpoint_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, 'member');
    select app._a7_webhook_endpoint_json(e.id) into v_result
      from app.webhook_endpoints e
     where e.id = p_endpoint_id
       and e.merchant_id = p_merchant_id
       and e.environment = p_environment;
    return v_result;
end;
$$;

-- Internal idempotency helper is intentionally not executable by runtime roles.
create or replace function app._a7_begin_webhook_command(
    p_merchant_id uuid,
    p_environment text,
    p_operation text,
    p_idempotency_key text,
    p_request_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_new_id uuid;
    v_existing app.request_idempotency%rowtype;
begin
    if p_idempotency_key is null
       or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) < 1
       or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) > 160
       or p_request_hash is null
       or p_request_hash !~ '^[0-9a-f]{64}$' then
        raise exception using errcode = '22023', message = 'invalid A7 idempotency input';
    end if;

    insert into app.request_idempotency (
        merchant_id, environment, operation, idempotency_key,
        request_hash, state
    ) values (
        p_merchant_id, p_environment, p_operation,
        pg_catalog.btrim(p_idempotency_key), p_request_hash, 'in_progress'
    )
    on conflict (merchant_id, environment, operation, idempotency_key) do nothing
    returning id into v_new_id;

    if v_new_id is not null then
        return pg_catalog.jsonb_build_object('kind', 'winning', 'id', v_new_id::text);
    end if;

    select * into v_existing
      from app.request_idempotency r
     where r.merchant_id = p_merchant_id
       and r.environment = p_environment
       and r.operation = p_operation
       and r.idempotency_key = pg_catalog.btrim(p_idempotency_key)
     for update;

    if not found then
        raise exception using errcode = '55000', message = 'A7 idempotency row disappeared';
    end if;
    if v_existing.request_hash is distinct from p_request_hash then
        return pg_catalog.jsonb_build_object('kind', 'conflict');
    end if;
    if v_existing.state = 'completed' and v_existing.response_snapshot is not null then
        return pg_catalog.jsonb_build_object(
            'kind', 'completed',
            'id', v_existing.id::text,
            'response', v_existing.response_snapshot
        );
    end if;
    return pg_catalog.jsonb_build_object('kind', 'in_progress', 'id', v_existing.id::text);
end;
$$;

create or replace function app._a7_complete_webhook_command(
    p_idempotency_id uuid,
    p_endpoint_id uuid,
    p_response jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if p_response is null or pg_catalog.jsonb_typeof(p_response) <> 'object'
       or p_response ? 'signingSecret'
       or p_response ? 'secretCiphertext'
       or p_response ? 'wrappingKeyId' then
        raise exception using errcode = '22023', message = 'invalid A7 idempotency response snapshot';
    end if;
    update app.request_idempotency
       set state = 'completed',
           resource_type = 'webhook_endpoint',
           resource_id = p_endpoint_id,
           http_status_snapshot = 200,
           response_snapshot = p_response,
           completed_at = pg_catalog.clock_timestamp()
     where id = p_idempotency_id
       and state = 'in_progress';
    if not found then
        raise exception using errcode = '55000', message = 'A7 idempotency completion failed';
    end if;
end;
$$;

revoke all on function app._a7_begin_webhook_command(uuid, text, text, text, text)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
revoke all on function app._a7_complete_webhook_command(uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

create or replace function app.create_dashboard_webhook_endpoint(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_idempotency_key text,
    p_request_hash text,
    p_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_gate jsonb;
    v_idempotency_id uuid;
    v_endpoint_id uuid;
    v_url text;
    v_events jsonb;
    v_ciphertext text;
    v_format text;
    v_key_id text;
    v_endpoint jsonb;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_active_count bigint;
begin
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, 'admin');
    if p_command is null or pg_catalog.jsonb_typeof(p_command) <> 'object'
       or pg_catalog.jsonb_object_length(p_command) <> 7
       or not (p_command ?& array['endpointId','url','subscribedEvents','secretVersion','secretCiphertext','secretCiphertextFormat','wrappingKeyId']) then
        raise exception using errcode = '22023', message = 'invalid A7 create command';
    end if;

    v_gate := app._a7_begin_webhook_command(
        p_merchant_id, p_environment, 'dashboard_webhook_endpoint_create_v0',
        p_idempotency_key, p_request_hash
    );
    if v_gate ->> 'kind' = 'conflict' then
        return pg_catalog.jsonb_build_object('kind', 'idempotency_conflict');
    elsif v_gate ->> 'kind' = 'in_progress' then
        return pg_catalog.jsonb_build_object('kind', 'idempotency_in_progress');
    elsif v_gate ->> 'kind' = 'completed' then
        return pg_catalog.jsonb_build_object(
            'kind', 'created', 'replayed', true, 'endpoint', v_gate -> 'response'
        );
    end if;
    v_idempotency_id := (v_gate ->> 'id')::uuid;

    begin
        v_endpoint_id := (p_command ->> 'endpointId')::uuid;
    exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'invalid A7 endpoint id';
    end;
    v_url := p_command ->> 'url';
    v_events := p_command -> 'subscribedEvents';
    v_ciphertext := p_command ->> 'secretCiphertext';
    v_format := p_command ->> 'secretCiphertextFormat';
    v_key_id := p_command ->> 'wrappingKeyId';

    if v_url is null or pg_catalog.length(pg_catalog.btrim(v_url)) < 1 or pg_catalog.length(v_url) > 2048
       or v_events is distinct from '["payment.paid"]'::jsonb
       or (p_command ->> 'secretVersion')::integer <> 1
       or v_format <> 'rsa-oaep-sha256-v1'
       or v_ciphertext is null or v_ciphertext !~ '^rsa-oaep-sha256-v1\$[A-Za-z0-9_-]+$'
       or v_key_id is null or v_key_id !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
        raise exception using errcode = '22023', message = 'invalid A7 endpoint create data';
    end if;

    perform 1 from app.merchants where id = p_merchant_id for update;
    select pg_catalog.count(*) into v_active_count
      from app.webhook_endpoints e
     where e.merchant_id = p_merchant_id
       and e.environment = p_environment
       and e.status = 'active';
    if v_active_count >= 10 then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind', 'endpoint_limit_reached');
    end if;

    insert into app.webhook_endpoints (
        id, merchant_id, environment, url, status,
        secret_ciphertext, secret_version, subscribed_events,
        revision, created_at, updated_at
    ) values (
        v_endpoint_id, p_merchant_id, p_environment, v_url, 'active',
        v_ciphertext, 1, v_events, 1, v_now, v_now
    );
    insert into app.webhook_endpoint_secret_versions (
        webhook_endpoint_id, secret_version, ciphertext_format,
        wrapping_key_id, secret_ciphertext, usable_until, created_at
    ) values (
        v_endpoint_id, 1, v_format, v_key_id, v_ciphertext, null, v_now
    );

    v_endpoint := app._a7_webhook_endpoint_json(v_endpoint_id);
    perform app.record_audit_event(
        'application_command', 'a7:' || v_idempotency_id::text, p_request_hash, 1,
        'user', p_user_id::text, p_merchant_id, p_environment,
        'webhook_endpoint.created', 'webhook_endpoint', v_endpoint_id::text,
        null, null, null, null,
        pg_catalog.jsonb_build_object('revisionAfter', 1, 'secretVersionAfter', 1),
        v_now
    );
    perform app._a7_complete_webhook_command(v_idempotency_id, v_endpoint_id, v_endpoint);
    return pg_catalog.jsonb_build_object('kind', 'created', 'replayed', false, 'endpoint', v_endpoint);
end;
$$;

create or replace function app.update_dashboard_webhook_endpoint(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_endpoint_id uuid,
    p_idempotency_key text,
    p_request_hash text,
    p_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_gate jsonb;
    v_idempotency_id uuid;
    v_endpoint app.webhook_endpoints%rowtype;
    v_expected_revision bigint;
    v_new_url text;
    v_new_events jsonb;
    v_result jsonb;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_changed text[] := array[]::text[];
begin
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, 'admin');
    if p_command is null or pg_catalog.jsonb_typeof(p_command) <> 'object'
       or not (p_command ? 'expectedRevision')
       or pg_catalog.jsonb_object_length(p_command) < 2
       or pg_catalog.jsonb_object_length(p_command) > 3
       or exists (
           select 1 from pg_catalog.jsonb_object_keys(p_command) k
           where k not in ('expectedRevision','url','subscribedEvents')
       ) then
        raise exception using errcode = '22023', message = 'invalid A7 update command';
    end if;
    begin
        v_expected_revision := (p_command ->> 'expectedRevision')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'invalid A7 expected revision';
    end;
    if v_expected_revision < 1 then
        raise exception using errcode = '22023', message = 'invalid A7 expected revision';
    end if;

    v_gate := app._a7_begin_webhook_command(
        p_merchant_id, p_environment, 'dashboard_webhook_endpoint_update_v0',
        p_idempotency_key, p_request_hash
    );
    if v_gate ->> 'kind' = 'conflict' then return pg_catalog.jsonb_build_object('kind','idempotency_conflict'); end if;
    if v_gate ->> 'kind' = 'in_progress' then return pg_catalog.jsonb_build_object('kind','idempotency_in_progress'); end if;
    if v_gate ->> 'kind' = 'completed' then
        return pg_catalog.jsonb_build_object('kind','ok','replayed',true,'endpoint',v_gate -> 'response');
    end if;
    v_idempotency_id := (v_gate ->> 'id')::uuid;

    select * into v_endpoint
      from app.webhook_endpoints e
     where e.id = p_endpoint_id
       and e.merchant_id = p_merchant_id
       and e.environment = p_environment
     for update;
    if not found then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind','resource_not_found');
    end if;
    if v_endpoint.revision <> v_expected_revision then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind','resource_conflict');
    end if;

    v_new_url := v_endpoint.url;
    v_new_events := v_endpoint.subscribed_events;
    if p_command ? 'url' then
        if v_endpoint.status <> 'disabled' then
            delete from app.request_idempotency where id = v_idempotency_id;
            return pg_catalog.jsonb_build_object('kind','resource_conflict');
        end if;
        v_new_url := p_command ->> 'url';
        if v_new_url is null or pg_catalog.length(pg_catalog.btrim(v_new_url)) < 1 or pg_catalog.length(v_new_url) > 2048 then
            raise exception using errcode = '22023', message = 'invalid A7 endpoint URL';
        end if;
        v_changed := pg_catalog.array_append(v_changed, 'url');
    end if;
    if p_command ? 'subscribedEvents' then
        v_new_events := p_command -> 'subscribedEvents';
        if v_new_events is distinct from '["payment.paid"]'::jsonb then
            raise exception using errcode = '22023', message = 'invalid A7 subscriptions';
        end if;
        v_changed := pg_catalog.array_append(v_changed, 'subscribedEvents');
    end if;

    update app.webhook_endpoints
       set url = v_new_url,
           subscribed_events = v_new_events,
           revision = revision + 1,
           updated_at = v_now
     where id = p_endpoint_id;
    v_result := app._a7_webhook_endpoint_json(p_endpoint_id);
    perform app.record_audit_event(
        'application_command', 'a7:' || v_idempotency_id::text, p_request_hash, 1,
        'user', p_user_id::text, p_merchant_id, p_environment,
        'webhook_endpoint.updated', 'webhook_endpoint', p_endpoint_id::text,
        null, null, null, null,
        pg_catalog.jsonb_build_object(
            'revisionBefore', v_expected_revision,
            'revisionAfter', v_expected_revision + 1,
            'changedFields', pg_catalog.to_jsonb(v_changed)
        ),
        v_now
    );
    perform app._a7_complete_webhook_command(v_idempotency_id, p_endpoint_id, v_result);
    return pg_catalog.jsonb_build_object('kind','ok','replayed',false,'endpoint',v_result);
end;
$$;

create or replace function app.disable_dashboard_webhook_endpoint(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_endpoint_id uuid,
    p_idempotency_key text,
    p_request_hash text,
    p_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_gate jsonb;
    v_idempotency_id uuid;
    v_endpoint app.webhook_endpoints%rowtype;
    v_expected_revision bigint;
    v_result jsonb;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, 'admin');
    if p_command is null or pg_catalog.jsonb_typeof(p_command) <> 'object'
       or pg_catalog.jsonb_object_length(p_command) <> 1
       or not (p_command ? 'expectedRevision') then
        raise exception using errcode = '22023', message = 'invalid A7 disable command';
    end if;
    begin v_expected_revision := (p_command ->> 'expectedRevision')::bigint;
    exception when others then raise exception using errcode='22023', message='invalid A7 expected revision'; end;
    if v_expected_revision < 1 then raise exception using errcode='22023', message='invalid A7 expected revision'; end if;

    v_gate := app._a7_begin_webhook_command(p_merchant_id,p_environment,'dashboard_webhook_endpoint_disable_v0',p_idempotency_key,p_request_hash);
    if v_gate ->> 'kind' = 'conflict' then return pg_catalog.jsonb_build_object('kind','idempotency_conflict'); end if;
    if v_gate ->> 'kind' = 'in_progress' then return pg_catalog.jsonb_build_object('kind','idempotency_in_progress'); end if;
    if v_gate ->> 'kind' = 'completed' then return pg_catalog.jsonb_build_object('kind','ok','replayed',true,'endpoint',v_gate -> 'response'); end if;
    v_idempotency_id := (v_gate ->> 'id')::uuid;

    select * into v_endpoint from app.webhook_endpoints e
     where e.id=p_endpoint_id and e.merchant_id=p_merchant_id and e.environment=p_environment for update;
    if not found then delete from app.request_idempotency where id=v_idempotency_id; return pg_catalog.jsonb_build_object('kind','resource_not_found'); end if;
    if v_endpoint.revision <> v_expected_revision then delete from app.request_idempotency where id=v_idempotency_id; return pg_catalog.jsonb_build_object('kind','resource_conflict'); end if;
    if v_endpoint.status = 'disabled' then delete from app.request_idempotency where id=v_idempotency_id; return pg_catalog.jsonb_build_object('kind','resource_conflict'); end if;

    update app.webhook_endpoints set status='disabled', revision=revision+1, updated_at=v_now where id=p_endpoint_id;

    update app.jobs j
       set state='completed', lease_owner=null, lease_token=null, lease_expires_at=null,
           last_finished_at=v_now, completed_at=v_now,
           last_error_class=null, last_error_code=null, updated_at=v_now
     where j.kind='merchant_webhook_delivery'
       and j.resource_type='webhook_delivery'
       and j.state='pending'
       and j.resource_id in (
           select d.id from app.webhook_deliveries d
            where d.webhook_endpoint_id=p_endpoint_id and d.state='pending'
       );
    update app.webhook_deliveries d
       set state='disabled', lease_token=null, lease_expires_at=null,
           last_error_class=null, last_error_code=null, updated_at=v_now
     where d.webhook_endpoint_id=p_endpoint_id and d.state='pending';

    v_result := app._a7_webhook_endpoint_json(p_endpoint_id);
    perform app.record_audit_event(
        'application_command','a7:'||v_idempotency_id::text,p_request_hash,1,
        'user',p_user_id::text,p_merchant_id,p_environment,
        'webhook_endpoint.disabled','webhook_endpoint',p_endpoint_id::text,
        null,null,null,null,
        pg_catalog.jsonb_build_object('revisionBefore',v_expected_revision,'revisionAfter',v_expected_revision+1,'statusBefore','active','statusAfter','disabled'),
        v_now
    );
    perform app._a7_complete_webhook_command(v_idempotency_id,p_endpoint_id,v_result);
    return pg_catalog.jsonb_build_object('kind','ok','replayed',false,'endpoint',v_result);
end;
$$;

create or replace function app.enable_dashboard_webhook_endpoint(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_endpoint_id uuid,
    p_idempotency_key text,
    p_request_hash text,
    p_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_gate jsonb;
    v_idempotency_id uuid;
    v_endpoint app.webhook_endpoints%rowtype;
    v_expected_revision bigint;
    v_result jsonb;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_active_count bigint;
begin
    perform app.require_dashboard_merchant_context(p_user_id,p_merchant_id,p_environment,'admin');
    if p_command is null or pg_catalog.jsonb_typeof(p_command)<>'object'
       or pg_catalog.jsonb_object_length(p_command)<>1 or not (p_command ? 'expectedRevision') then
        raise exception using errcode='22023', message='invalid A7 enable command';
    end if;
    begin v_expected_revision := (p_command->>'expectedRevision')::bigint;
    exception when others then raise exception using errcode='22023', message='invalid A7 expected revision'; end;
    if v_expected_revision < 1 then raise exception using errcode='22023', message='invalid A7 expected revision'; end if;

    v_gate := app._a7_begin_webhook_command(p_merchant_id,p_environment,'dashboard_webhook_endpoint_enable_v0',p_idempotency_key,p_request_hash);
    if v_gate->>'kind'='conflict' then return pg_catalog.jsonb_build_object('kind','idempotency_conflict'); end if;
    if v_gate->>'kind'='in_progress' then return pg_catalog.jsonb_build_object('kind','idempotency_in_progress'); end if;
    if v_gate->>'kind'='completed' then return pg_catalog.jsonb_build_object('kind','ok','replayed',true,'endpoint',v_gate->'response'); end if;
    v_idempotency_id := (v_gate->>'id')::uuid;

    perform 1 from app.merchants where id=p_merchant_id for update;
    select * into v_endpoint from app.webhook_endpoints e
     where e.id=p_endpoint_id and e.merchant_id=p_merchant_id and e.environment=p_environment for update;
    if not found then delete from app.request_idempotency where id=v_idempotency_id; return pg_catalog.jsonb_build_object('kind','resource_not_found'); end if;
    if v_endpoint.revision<>v_expected_revision or v_endpoint.status<>'disabled' then delete from app.request_idempotency where id=v_idempotency_id; return pg_catalog.jsonb_build_object('kind','resource_conflict'); end if;
    select pg_catalog.count(*) into v_active_count from app.webhook_endpoints e
     where e.merchant_id=p_merchant_id and e.environment=p_environment and e.status='active';
    if v_active_count>=10 then delete from app.request_idempotency where id=v_idempotency_id; return pg_catalog.jsonb_build_object('kind','endpoint_limit_reached'); end if;

    update app.webhook_endpoints set status='active',revision=revision+1,updated_at=v_now where id=p_endpoint_id;
    v_result := app._a7_webhook_endpoint_json(p_endpoint_id);
    perform app.record_audit_event(
        'application_command','a7:'||v_idempotency_id::text,p_request_hash,1,
        'user',p_user_id::text,p_merchant_id,p_environment,
        'webhook_endpoint.enabled','webhook_endpoint',p_endpoint_id::text,
        null,null,null,null,
        pg_catalog.jsonb_build_object('revisionBefore',v_expected_revision,'revisionAfter',v_expected_revision+1,'statusBefore','disabled','statusAfter','active'),v_now
    );
    perform app._a7_complete_webhook_command(v_idempotency_id,p_endpoint_id,v_result);
    return pg_catalog.jsonb_build_object('kind','ok','replayed',false,'endpoint',v_result);
end;
$$;

create or replace function app.rotate_dashboard_webhook_endpoint_secret(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_endpoint_id uuid,
    p_idempotency_key text,
    p_request_hash text,
    p_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_gate jsonb;
    v_idempotency_id uuid;
    v_endpoint app.webhook_endpoints%rowtype;
    v_expected_revision bigint;
    v_new_version integer;
    v_ciphertext text;
    v_format text;
    v_key_id text;
    v_result jsonb;
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_overlap_until timestamptz;
begin
    perform app.require_dashboard_merchant_context(p_user_id,p_merchant_id,p_environment,'admin');
    if p_command is null or pg_catalog.jsonb_typeof(p_command)<>'object'
       or pg_catalog.jsonb_object_length(p_command)<>5
       or not (p_command ?& array['expectedRevision','newSecretVersion','secretCiphertext','secretCiphertextFormat','wrappingKeyId']) then
        raise exception using errcode='22023', message='invalid A7 rotate command';
    end if;
    begin
        v_expected_revision := (p_command->>'expectedRevision')::bigint;
        v_new_version := (p_command->>'newSecretVersion')::integer;
    exception when others then raise exception using errcode='22023', message='invalid A7 rotation numeric input'; end;
    v_ciphertext := p_command->>'secretCiphertext';
    v_format := p_command->>'secretCiphertextFormat';
    v_key_id := p_command->>'wrappingKeyId';
    if v_expected_revision<1 or v_new_version<1
       or v_format<>'rsa-oaep-sha256-v1'
       or v_ciphertext is null or v_ciphertext !~ '^rsa-oaep-sha256-v1\$[A-Za-z0-9_-]+$'
       or v_key_id is null or v_key_id !~ '^[a-z0-9][a-z0-9._-]{0,63}$' then
        raise exception using errcode='22023', message='invalid A7 rotation input';
    end if;

    v_gate := app._a7_begin_webhook_command(p_merchant_id,p_environment,'dashboard_webhook_endpoint_rotate_secret_v0',p_idempotency_key,p_request_hash);
    if v_gate->>'kind'='conflict' then return pg_catalog.jsonb_build_object('kind','idempotency_conflict'); end if;
    if v_gate->>'kind'='in_progress' then return pg_catalog.jsonb_build_object('kind','idempotency_in_progress'); end if;
    if v_gate->>'kind'='completed' then return pg_catalog.jsonb_build_object('kind','ok','replayed',true,'endpoint',v_gate->'response'); end if;
    v_idempotency_id := (v_gate->>'id')::uuid;

    select * into v_endpoint from app.webhook_endpoints e
     where e.id=p_endpoint_id and e.merchant_id=p_merchant_id and e.environment=p_environment for update;
    if not found then delete from app.request_idempotency where id=v_idempotency_id; return pg_catalog.jsonb_build_object('kind','resource_not_found'); end if;
    if v_endpoint.revision<>v_expected_revision or v_new_version<>v_endpoint.secret_version+1 then
        delete from app.request_idempotency where id=v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind','resource_conflict');
    end if;

    v_overlap_until := v_now + pg_catalog.make_interval(hours => 24);
    update app.webhook_endpoint_secret_versions
       set usable_until=v_overlap_until
     where webhook_endpoint_id=p_endpoint_id
       and secret_version=v_endpoint.secret_version;
    if not found then
        raise exception using errcode='55000', message='A7 current secret version history is missing';
    end if;

    insert into app.webhook_endpoint_secret_versions(
        webhook_endpoint_id,secret_version,ciphertext_format,wrapping_key_id,
        secret_ciphertext,usable_until,created_at
    ) values (p_endpoint_id,v_new_version,v_format,v_key_id,v_ciphertext,null,v_now);

    update app.webhook_endpoints
       set previous_secret_ciphertext=secret_ciphertext,
           previous_secret_version=secret_version,
           previous_secret_expires_at=v_overlap_until,
           secret_ciphertext=v_ciphertext,
           secret_version=v_new_version,
           revision=revision+1,
           updated_at=v_now
     where id=p_endpoint_id;

    v_result := app._a7_webhook_endpoint_json(p_endpoint_id);
    perform app.record_audit_event(
        'application_command','a7:'||v_idempotency_id::text,p_request_hash,1,
        'user',p_user_id::text,p_merchant_id,p_environment,
        'webhook_endpoint.secret_rotated','webhook_endpoint',p_endpoint_id::text,
        null,null,null,null,
        pg_catalog.jsonb_build_object(
            'revisionBefore',v_expected_revision,'revisionAfter',v_expected_revision+1,
            'secretVersionBefore',v_endpoint.secret_version,'secretVersionAfter',v_new_version
        ),v_now
    );
    perform app._a7_complete_webhook_command(v_idempotency_id,p_endpoint_id,v_result);
    return pg_catalog.jsonb_build_object('kind','ok','replayed',false,'endpoint',v_result);
end;
$$;

-- Exact A7 API capability allowlist. The Data API/browser and worker receive no
-- management capability; swiftpay_api receives no table DML.
revoke all on function app.list_dashboard_webhook_endpoints(uuid, uuid, text)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.get_dashboard_webhook_endpoint(uuid, uuid, text, uuid)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.create_dashboard_webhook_endpoint(uuid, uuid, text, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.update_dashboard_webhook_endpoint(uuid, uuid, text, uuid, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.disable_dashboard_webhook_endpoint(uuid, uuid, text, uuid, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.enable_dashboard_webhook_endpoint(uuid, uuid, text, uuid, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.rotate_dashboard_webhook_endpoint_secret(uuid, uuid, text, uuid, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;

grant execute on function app.list_dashboard_webhook_endpoints(uuid, uuid, text) to swiftpay_api;
grant execute on function app.get_dashboard_webhook_endpoint(uuid, uuid, text, uuid) to swiftpay_api;
grant execute on function app.create_dashboard_webhook_endpoint(uuid, uuid, text, text, text, jsonb) to swiftpay_api;
grant execute on function app.update_dashboard_webhook_endpoint(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
grant execute on function app.disable_dashboard_webhook_endpoint(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
grant execute on function app.enable_dashboard_webhook_endpoint(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
grant execute on function app.rotate_dashboard_webhook_endpoint_secret(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
