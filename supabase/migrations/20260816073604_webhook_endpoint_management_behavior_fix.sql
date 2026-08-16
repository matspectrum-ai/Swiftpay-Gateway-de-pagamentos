-- SwiftPay V2 A7: corrective behavior hardening discovered during GREEN.
--
-- This migration fixes three implementation defects without widening authority:
-- * PostgreSQL has no pg_catalog.jsonb_object_length(jsonb), so command shape
--   validation uses a private object-key counter;
-- * COALESCE is SQL syntax, not a pg_catalog function;
-- * A4 endpoints created/rotated after the A7 history backfill must continue to
--   dispatch through the legacy current/previous AES mirrors when no history row
--   exists, while A7 version-history rows remain canonical when present.

create or replace function app._a7_jsonb_object_key_count(p_value jsonb)
returns bigint
language sql
immutable
security invoker
set search_path = ''
as $$
    select case
        when p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'object' then null
        else (
            select pg_catalog.count(*)
              from pg_catalog.jsonb_object_keys(p_value)
        )
    end
$$;

revoke all on function app._a7_jsonb_object_key_count(jsonb)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

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
            ep.secret_ciphertext as legacy_current_secret_ciphertext,
            ep.previous_secret_version as legacy_previous_secret_version,
            ep.previous_secret_ciphertext as legacy_previous_secret_ciphertext,
            ep.previous_secret_expires_at as legacy_previous_secret_expires_at,
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
        elsif v_candidate.signing_secret_version = v_candidate.current_secret_version then
            v_secret_ciphertext := v_candidate.legacy_current_secret_ciphertext;
            v_ciphertext_format := 'aes-256-gcm-v1';
            v_wrapping_key_id := null;
        elsif v_candidate.signing_secret_version = v_candidate.legacy_previous_secret_version
              and v_candidate.legacy_previous_secret_expires_at is not null
              and v_candidate.legacy_previous_secret_expires_at > v_now then
            v_secret_ciphertext := v_candidate.legacy_previous_secret_ciphertext;
            v_ciphertext_format := 'aes-256-gcm-v1';
            v_wrapping_key_id := null;
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
       or app._a7_jsonb_object_key_count(p_command) <> 7
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
       or app._a7_jsonb_object_key_count(p_command) < 2
       or app._a7_jsonb_object_key_count(p_command) > 3
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
       or app._a7_jsonb_object_key_count(p_command) <> 1
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
       or app._a7_jsonb_object_key_count(p_command)<>1 or not (p_command ? 'expectedRevision') then
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
       or app._a7_jsonb_object_key_count(p_command)<>5
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

-- CREATE OR REPLACE preserves ACLs; restate the intended capability boundary.
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

grant execute on function app.create_dashboard_webhook_endpoint(uuid, uuid, text, text, text, jsonb) to swiftpay_api;
grant execute on function app.update_dashboard_webhook_endpoint(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
grant execute on function app.disable_dashboard_webhook_endpoint(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
grant execute on function app.enable_dashboard_webhook_endpoint(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
grant execute on function app.rotate_dashboard_webhook_endpoint_secret(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
