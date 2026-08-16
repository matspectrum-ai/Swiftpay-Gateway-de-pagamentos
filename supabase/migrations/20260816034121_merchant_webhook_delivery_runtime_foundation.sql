-- SwiftPay V2 A4: merchant webhook delivery runtime foundation.
--
-- This migration establishes only the durable schema/ACL boundary required by
-- the frozen A4 specification. Claim/resolve behavior remains deliberately
-- fail-closed until the following behavior migration turns the RED contracts
-- GREEN.

alter table app.webhook_deliveries
    add column signing_secret_version integer,
    add column last_error_code text;

-- Existing durable deliveries predate A4. Snapshot the endpoint version that is
-- currently referenced by each delivery without materializing any plaintext
-- secret. New deliveries receive the version atomically during fanout below.
update app.webhook_deliveries d
   set signing_secret_version = e.secret_version
  from app.webhook_endpoints e
 where e.id = d.webhook_endpoint_id
   and d.signing_secret_version is null;

alter table app.webhook_deliveries
    alter column signing_secret_version set not null,
    add constraint webhook_deliveries_signing_secret_version_ck
        check (signing_secret_version > 0),
    add constraint webhook_deliveries_last_error_code_length_ck
        check (last_error_code is null or pg_catalog.length(last_error_code) <= 80);

-- A4 freezes the signing-secret version at delivery fanout. Replaying an
-- existing logical source still returns the original event and never refans out.
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
        raise exception 'invalid webhook environment: %', p_environment
            using errcode = '23514';
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
        merchant_id,
        environment,
        type,
        resource_type,
        resource_id,
        source_type,
        source_id,
        payload_version,
        payload_snapshot,
        occurred_at
    ) values (
        p_merchant_id,
        p_environment,
        p_type,
        p_resource_type,
        p_resource_id,
        p_source_type,
        p_source_id,
        p_payload_version,
        p_payload_snapshot,
        p_occurred_at
    )
    on conflict (merchant_id, environment, source_type, source_id, type)
    do nothing
    returning id into v_event_id;

    if v_event_id is null then
        select *
          into strict v_existing
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
            state,
            attempt_count,
            next_attempt_at
        )
        select
            v_event_id,
            e.id,
            e.secret_version,
            'pending',
            0,
            now()
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
            jsonb_build_object('webhook_delivery_id', v_delivery_id),
            1,
            8,
            now()
        );
    end loop;

    return v_event_id;
end;
$$;

-- Structural A4 worker boundary. These functions are intentionally unavailable
-- behaviorally until the next migration, but their security shape is frozen now.
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
begin
    raise exception using
        errcode = '0A000',
        message = 'A4 merchant webhook delivery claim behavior is not implemented';
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
begin
    raise exception using
        errcode = '0A000',
        message = 'A4 merchant webhook delivery resolution behavior is not implemented';
end;
$$;

-- CREATE FUNCTION grants PUBLIC EXECUTE by default, so the privileged routines
-- are explicitly closed before granting only the trusted worker capability.
revoke all on function app.claim_merchant_webhook_deliveries(text, integer, integer)
    from public, anon, authenticated, service_role, swiftpay_api;
revoke all on function app.resolve_merchant_webhook_delivery(uuid, uuid, uuid, text, integer, text, text, integer)
    from public, anon, authenticated, service_role, swiftpay_api;

grant execute on function app.claim_merchant_webhook_deliveries(text, integer, integer)
    to swiftpay_worker;
grant execute on function app.resolve_merchant_webhook_delivery(uuid, uuid, uuid, text, integer, text, text, integer)
    to swiftpay_worker;
