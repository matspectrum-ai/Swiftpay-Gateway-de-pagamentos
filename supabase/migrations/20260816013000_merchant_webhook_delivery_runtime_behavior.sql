-- SwiftPay V2 A4: composed merchant webhook delivery claim/resolve behavior.
--
-- One database capability owns both Job and WebhookDelivery scheduling state.
-- The worker never claims webhook Jobs through the generic job lease API.

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

    -- Endpoint disable is a local terminal decision. It consumes no HTTP
    -- attempt and completes the paired job under the same transaction.
    for v_candidate in
        select j.id as job_id, d.id as delivery_id
          from app.jobs j
          join app.webhook_deliveries d
            on d.id = j.resource_id
          join app.webhook_events ev
            on ev.id = d.webhook_event_id
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
           set state = 'completed',
               lease_owner = null,
               lease_token = null,
               lease_expires_at = null,
               last_finished_at = v_now,
               completed_at = v_now,
               last_error_class = null,
               last_error_code = null,
               updated_at = v_now
         where id = v_candidate.job_id;

        update app.webhook_deliveries
           set state = 'disabled',
               lease_token = null,
               lease_expires_at = null,
               last_error_class = null,
               last_error_code = null,
               updated_at = v_now
         where id = v_candidate.delivery_id;
    end loop;

    -- Active dispatch claims serialize Job + Delivery with one fencing token.
    for v_candidate in
        select
            j.id as job_id,
            j.max_attempts,
            d.id as delivery_id,
            d.signing_secret_version,
            ep.id as endpoint_id,
            ep.url as endpoint_url,
            ep.environment as endpoint_environment,
            ep.secret_version,
            ep.secret_ciphertext,
            ep.previous_secret_version,
            ep.previous_secret_ciphertext,
            ep.previous_secret_expires_at,
            ev.id as event_id,
            ev.type as event_type,
            ev.occurred_at,
            ev.payload_version,
            ev.payload_snapshot
          from app.jobs j
          join app.webhook_deliveries d
            on d.id = j.resource_id
          join app.webhook_events ev
            on ev.id = d.webhook_event_id
          join app.webhook_endpoints ep
            on ep.id = d.webhook_endpoint_id
           and ep.merchant_id = ev.merchant_id
           and ep.environment = ev.environment
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
        v_attempt_number := (
            select attempt_count + 1
              from app.jobs
             where id = v_candidate.job_id
        );

        update app.jobs
           set state = 'leased',
               attempt_count = v_attempt_number,
               lease_owner = v_worker_id,
               lease_token = v_lease_token,
               lease_expires_at = v_lease_expires_at,
               last_started_at = v_now,
               updated_at = v_now
         where id = v_candidate.job_id;

        update app.webhook_deliveries
           set state = 'leased',
               attempt_count = v_attempt_number,
               lease_token = v_lease_token,
               lease_expires_at = v_lease_expires_at,
               first_attempt_at = coalesce(first_attempt_at, v_now),
               last_attempt_at = v_now,
               updated_at = v_now
         where id = v_candidate.delivery_id;

        if v_candidate.signing_secret_version = v_candidate.secret_version then
            v_secret_ciphertext := v_candidate.secret_ciphertext;
        elsif v_candidate.signing_secret_version = v_candidate.previous_secret_version
              and v_candidate.previous_secret_expires_at is not null
              and v_candidate.previous_secret_expires_at > v_now then
            v_secret_ciphertext := v_candidate.previous_secret_ciphertext;
        else
            v_secret_ciphertext := null;
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
                'signingSecretCiphertext', v_secret_ciphertext
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

create or replace function app.resolve_merchant_webhook_delivery(
    p_job_id uuid,
    p_delivery_id uuid,
    p_lease_token uuid,
    p_outcome text,
    p_http_status integer,
    p_error_class text,
    p_error_code text,
    p_retry_after_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_job app.jobs%rowtype;
    v_delivery app.webhook_deliveries%rowtype;
    v_due_at timestamptz;
begin
    if p_job_id is null or p_delivery_id is null or p_lease_token is null then
        return false;
    end if;

    if p_outcome not in ('success', 'retry', 'terminal') then
        raise exception using errcode = '22023', message = 'invalid webhook resolution outcome';
    end if;

    if p_http_status is not null and (p_http_status < 100 or p_http_status > 599) then
        raise exception using errcode = '22023', message = 'invalid webhook HTTP status';
    end if;

    if p_error_class is not null
       and p_error_class not in ('transient', 'rate_limited', 'configuration', 'validation', 'permanent', 'internal') then
        raise exception using errcode = '22023', message = 'invalid webhook error class';
    end if;

    if p_error_code is not null and pg_catalog.length(p_error_code) > 80 then
        raise exception using errcode = '22023', message = 'invalid webhook error code';
    end if;

    if p_retry_after_seconds is not null
       and (p_retry_after_seconds < 1 or p_retry_after_seconds > 7200) then
        raise exception using errcode = '22023', message = 'invalid webhook retry delay';
    end if;

    if p_outcome = 'success' then
        if p_http_status is null or p_http_status < 200 or p_http_status > 299
           or p_retry_after_seconds is not null then
            raise exception using errcode = '22023', message = 'invalid webhook success evidence';
        end if;
    elsif p_outcome = 'retry' then
        if p_retry_after_seconds is null then
            raise exception using errcode = '22023', message = 'webhook retry delay is required';
        end if;
    else
        if p_retry_after_seconds is not null then
            raise exception using errcode = '22023', message = 'terminal webhook resolution cannot schedule retry';
        end if;
    end if;

    perform 1
      from app.jobs j
      join app.webhook_deliveries d
        on d.id = p_delivery_id
       and j.resource_id = d.id
     where j.id = p_job_id
       and j.kind = 'merchant_webhook_delivery'
       and j.resource_type = 'webhook_delivery'
     for update of j, d;

    if not found then
        return false;
    end if;

    select * into strict v_job from app.jobs where id = p_job_id;
    select * into strict v_delivery from app.webhook_deliveries where id = p_delivery_id;

    if v_job.state <> 'leased'
       or v_delivery.state <> 'leased'
       or v_job.lease_token is distinct from p_lease_token
       or v_delivery.lease_token is distinct from p_lease_token
       or v_job.lease_token is distinct from v_delivery.lease_token then
        return false;
    end if;

    if v_job.attempt_count <> v_delivery.attempt_count then
        raise exception using errcode = '55000', message = 'webhook job/delivery attempt counters diverged';
    end if;

    if p_outcome = 'success' then
        update app.jobs
           set state = 'completed',
               lease_owner = null,
               lease_token = null,
               lease_expires_at = null,
               last_finished_at = v_now,
               last_error_class = null,
               last_error_code = null,
               completed_at = v_now,
               updated_at = v_now
         where id = p_job_id;

        update app.webhook_deliveries
           set state = 'succeeded',
               lease_token = null,
               lease_expires_at = null,
               last_http_status = p_http_status,
               last_error_class = null,
               last_error_code = null,
               succeeded_at = v_now,
               updated_at = v_now
         where id = p_delivery_id;

        return true;
    end if;

    if p_outcome = 'retry' and v_job.attempt_count < v_job.max_attempts then
        v_due_at := v_now + pg_catalog.make_interval(secs => p_retry_after_seconds);

        update app.jobs
           set state = 'pending',
               available_at = v_due_at,
               lease_owner = null,
               lease_token = null,
               lease_expires_at = null,
               last_finished_at = v_now,
               last_error_class = p_error_class,
               last_error_code = p_error_code,
               completed_at = null,
               updated_at = v_now
         where id = p_job_id;

        update app.webhook_deliveries
           set state = 'pending',
               next_attempt_at = v_due_at,
               lease_token = null,
               lease_expires_at = null,
               last_http_status = p_http_status,
               last_error_class = p_error_class,
               last_error_code = p_error_code,
               succeeded_at = null,
               updated_at = v_now
         where id = p_delivery_id;

        return true;
    end if;

    -- Explicit terminal outcome, or retry requested at the durable ceiling.
    update app.jobs
       set state = 'dead',
           lease_owner = null,
           lease_token = null,
           lease_expires_at = null,
           last_finished_at = v_now,
           last_error_class = p_error_class,
           last_error_code = p_error_code,
           completed_at = null,
           updated_at = v_now
     where id = p_job_id;

    update app.webhook_deliveries
       set state = 'exhausted',
           lease_token = null,
           lease_expires_at = null,
           last_http_status = p_http_status,
           last_error_class = p_error_class,
           last_error_code = p_error_code,
           succeeded_at = null,
           updated_at = v_now
     where id = p_delivery_id;

    return true;
end;
$$;

revoke all on function app.claim_merchant_webhook_deliveries(text, integer, integer)
    from public, anon, authenticated, service_role, swiftpay_api;
revoke all on function app.resolve_merchant_webhook_delivery(uuid, uuid, uuid, text, integer, text, text, integer)
    from public, anon, authenticated, service_role, swiftpay_api;

grant execute on function app.claim_merchant_webhook_deliveries(text, integer, integer)
    to swiftpay_worker;
grant execute on function app.resolve_merchant_webhook_delivery(uuid, uuid, uuid, text, integer, text, text, integer)
    to swiftpay_worker;
