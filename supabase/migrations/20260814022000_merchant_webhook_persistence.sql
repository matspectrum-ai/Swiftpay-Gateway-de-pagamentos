-- SwiftPay V2 Phase 2: durable merchant webhook persistence.
-- This migration persists endpoint configuration, one logical merchant event,
-- endpoint deliveries and the durable worker jobs required to send them.
-- HTTP execution, HMAC signing and SSRF controls belong to the trusted worker.

create table app.webhook_endpoints (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    environment text not null,
    url text not null,
    status text not null default 'active',
    secret_ciphertext text not null,
    secret_version integer not null default 1,
    previous_secret_ciphertext text,
    previous_secret_version integer,
    previous_secret_expires_at timestamptz,
    subscribed_events jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint webhook_endpoints_environment_ck
        check (environment in ('sandbox', 'production')),
    constraint webhook_endpoints_status_ck
        check (status in ('active', 'disabled')),
    constraint webhook_endpoints_url_nonempty_ck
        check (length(trim(url)) > 0),
    constraint webhook_endpoints_secret_nonempty_ck
        check (length(secret_ciphertext) > 0),
    constraint webhook_endpoints_secret_version_ck
        check (secret_version > 0),
    constraint webhook_endpoints_previous_secret_shape_ck
        check (
            (previous_secret_ciphertext is null
                and previous_secret_version is null
                and previous_secret_expires_at is null)
            or
            (previous_secret_ciphertext is not null
                and length(previous_secret_ciphertext) > 0
                and previous_secret_version is not null
                and previous_secret_version > 0
                and previous_secret_version < secret_version
                and previous_secret_expires_at is not null)
        ),
    constraint webhook_endpoints_subscriptions_array_ck
        check (jsonb_typeof(subscribed_events) = 'array')
);

create index webhook_endpoints_active_idx
    on app.webhook_endpoints (merchant_id, environment, id)
    where status = 'active';

create table app.webhook_events (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    environment text not null,
    type text not null,
    resource_type text not null,
    resource_id uuid not null,
    source_type text not null,
    source_id uuid not null,
    payload_version text not null,
    payload_snapshot jsonb not null,
    occurred_at timestamptz not null,
    created_at timestamptz not null default now(),

    constraint webhook_events_environment_ck
        check (environment in ('sandbox', 'production')),
    constraint webhook_events_type_nonempty_ck
        check (length(trim(type)) > 0),
    constraint webhook_events_resource_type_nonempty_ck
        check (length(trim(resource_type)) > 0),
    constraint webhook_events_source_type_nonempty_ck
        check (length(trim(source_type)) > 0),
    constraint webhook_events_payload_version_nonempty_ck
        check (length(trim(payload_version)) > 0),
    constraint webhook_events_payload_object_ck
        check (jsonb_typeof(payload_snapshot) = 'object')
);

create unique index webhook_events_source_uq
    on app.webhook_events (
        merchant_id,
        environment,
        source_type,
        source_id,
        type
    );

create index webhook_events_resource_idx
    on app.webhook_events (
        merchant_id,
        environment,
        resource_type,
        resource_id,
        occurred_at
    );

create table app.webhook_deliveries (
    id uuid primary key default gen_random_uuid(),
    webhook_event_id uuid not null references app.webhook_events(id) on delete restrict,
    webhook_endpoint_id uuid not null references app.webhook_endpoints(id) on delete restrict,
    state text not null default 'pending',
    attempt_count integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    lease_token uuid,
    lease_expires_at timestamptz,
    last_http_status integer,
    last_error_class text,
    first_attempt_at timestamptz,
    last_attempt_at timestamptz,
    succeeded_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint webhook_deliveries_state_ck
        check (state in ('pending', 'leased', 'succeeded', 'exhausted', 'disabled')),
    constraint webhook_deliveries_attempt_count_ck
        check (attempt_count >= 0),
    constraint webhook_deliveries_lease_shape_ck
        check (
            (state = 'leased' and lease_token is not null and lease_expires_at is not null)
            or
            (state <> 'leased' and lease_token is null and lease_expires_at is null)
        ),
    constraint webhook_deliveries_http_status_ck
        check (last_http_status is null or last_http_status between 100 and 599),
    constraint webhook_deliveries_success_shape_ck
        check (
            (state = 'succeeded' and succeeded_at is not null)
            or
            (state <> 'succeeded' and succeeded_at is null)
        )
);

create unique index webhook_deliveries_event_endpoint_uq
    on app.webhook_deliveries (webhook_event_id, webhook_endpoint_id);

create index webhook_deliveries_due_idx
    on app.webhook_deliveries (state, next_attempt_at, created_at, id)
    where state in ('pending', 'leased');

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

        -- Source identity is immutable. Reusing it for a different public event
        -- projection is a caller/domain bug, never a last-writer-wins update.
        if v_existing.resource_type is distinct from p_resource_type
           or v_existing.resource_id is distinct from p_resource_id
           or v_existing.payload_version is distinct from p_payload_version
           or v_existing.payload_snapshot is distinct from p_payload_snapshot then
            raise exception 'webhook source identity reused with different logical event'
                using errcode = '23505';
        end if;

        -- The original fanout is intentionally frozen. Replaying an existing
        -- source does not deliver historical events to endpoints created later.
        return v_existing.id;
    end if;

    for v_delivery_id in
        insert into app.webhook_deliveries (
            webhook_event_id,
            webhook_endpoint_id,
            state,
            attempt_count,
            next_attempt_at
        )
        select
            v_event_id,
            e.id,
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

revoke all on app.webhook_endpoints, app.webhook_events, app.webhook_deliveries
    from anon, authenticated, service_role;

revoke all on function app.record_webhook_event(
    uuid, text, text, text, uuid, text, uuid, text, jsonb, timestamptz
) from public, anon, authenticated, service_role;
