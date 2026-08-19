-- SwiftPay V2 A23: Sandbox hosted Pix checkout + payment links.
--
-- This slice adds a private fixed-amount payment-link resource and five narrow
-- swiftpay_api capabilities. It preserves A2 machine creation, Production
-- fail-closed behavior, zero browser/Data-API table authority and zero live PSP
-- authority.

create table app.payment_links (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    environment text not null default 'sandbox',
    public_token text not null,
    status text not null default 'active',
    amount_cents bigint not null,
    currency text not null default 'BRL',
    description text,
    pix_expiration_minutes integer not null default 60,
    created_at timestamptz not null default now(),
    disabled_at timestamptz,
    constraint payment_links_environment_ck check (environment = 'sandbox'),
    constraint payment_links_status_ck check (status in ('active', 'disabled')),
    constraint payment_links_amount_positive_ck check (amount_cents > 0),
    constraint payment_links_currency_brl_ck check (currency = 'BRL'),
    constraint payment_links_pix_expiration_ck check (pix_expiration_minutes >= 5 and pix_expiration_minutes <= 1440),
    constraint payment_links_public_token_ck check (public_token ~ '^plink_sandbox_[A-Za-z0-9_-]{32}$'),
    constraint payment_links_disabled_state_ck check (
        (status = 'active' and disabled_at is null)
        or (status = 'disabled' and disabled_at is not null)
    )
);

create unique index payment_links_public_token_uq on app.payment_links(public_token);
create index payment_links_merchant_created_idx
    on app.payment_links(merchant_id, environment, created_at desc, id desc);

revoke all on table app.payment_links
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

create function app._a23_dashboard_payment_link_json(p_payment_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select pg_catalog.jsonb_build_object(
        'id', pl.id::text,
        'publicToken', pl.public_token,
        'checkoutPath', '/pay/' || pl.public_token,
        'status', pl.status,
        'amount', pl.amount_cents,
        'currency', pl.currency,
        'description', pl.description,
        'pixExpirationMinutes', pl.pix_expiration_minutes,
        'createdAt', pg_catalog.to_char(pl.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'disabledAt', case when pl.disabled_at is null then null else pg_catalog.to_char(pl.disabled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
    )
    from app.payment_links pl
    where pl.id = p_payment_link_id;
$$;

revoke all on function app._a23_dashboard_payment_link_json(uuid)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

create function app.list_dashboard_payment_links(
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
    select app._a23_dashboard_payment_link_json(pl.id)
    from app.payment_links pl
    where pl.merchant_id = p_merchant_id
      and pl.environment = p_environment
    order by pl.created_at desc, pl.id desc;
end;
$$;

create function app.create_dashboard_payment_link(
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
    v_idempotency_id uuid;
    v_existing app.request_idempotency%rowtype;
    v_payment_link_id uuid;
    v_public_token text;
    v_amount bigint;
    v_expiration integer;
    v_description text;
    v_projection jsonb;
begin
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, 'admin');

    if p_environment is distinct from 'sandbox' then
        return pg_catalog.jsonb_build_object('kind', 'forbidden');
    end if;

    if p_idempotency_key is null
       or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
       or pg_catalog.length(p_idempotency_key) < 1
       or pg_catalog.length(p_idempotency_key) > 160
       or p_request_hash is null
       or p_request_hash !~ '^[0-9a-f]{64}$' then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;

    if p_command is null
       or pg_catalog.jsonb_typeof(p_command) <> 'object'
       or pg_catalog.jsonb_object_length(p_command) not in (4, 5)
       or not (p_command ? 'amount')
       or not (p_command ? 'currency')
       or not (p_command ? 'description')
       or not (p_command ? 'pixExpirationMinutes')
       or p_command ->> 'currency' is distinct from 'BRL' then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;

    begin
        v_amount := (p_command ->> 'amount')::bigint;
        v_expiration := (p_command ->> 'pixExpirationMinutes')::integer;
    exception when others then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end;

    if v_amount < 1 or v_amount > 9007199254740991
       or v_expiration < 5 or v_expiration > 1440 then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;

    if p_command -> 'description' <> 'null'::jsonb
       and pg_catalog.jsonb_typeof(p_command -> 'description') <> 'string' then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;
    v_description := p_command ->> 'description';

    if p_command ? 'publicToken' then
        v_public_token := p_command ->> 'publicToken';
        if v_public_token is null or v_public_token !~ '^plink_sandbox_[A-Za-z0-9_-]{32}$' then
            return pg_catalog.jsonb_build_object('kind', 'validation_error');
        end if;
    end if;

    insert into app.request_idempotency(
        merchant_id, environment, operation, idempotency_key, request_hash, state
    ) values (
        p_merchant_id, 'sandbox', 'dashboard_payment_link_create', p_idempotency_key, p_request_hash, 'in_progress'
    )
    on conflict (merchant_id, environment, operation, idempotency_key) do nothing
    returning id into v_idempotency_id;

    if v_idempotency_id is null then
        select ri.* into v_existing
        from app.request_idempotency ri
        where ri.merchant_id = p_merchant_id
          and ri.environment = 'sandbox'
          and ri.operation = 'dashboard_payment_link_create'
          and ri.idempotency_key = p_idempotency_key
        for update;

        if not found then
            raise exception using errcode = '55000', message = 'A23 payment-link idempotency state disappeared';
        end if;
        if v_existing.request_hash <> p_request_hash then
            return pg_catalog.jsonb_build_object('kind', 'idempotency_conflict');
        end if;
        if v_existing.state = 'completed' then
            if v_existing.response_snapshot is null then
                raise exception using errcode = '55000', message = 'A23 completed payment-link snapshot is missing';
            end if;
            return pg_catalog.jsonb_build_object(
                'kind', 'created',
                'replayed', true,
                'paymentLink', v_existing.response_snapshot
            );
        end if;
        if v_existing.state <> 'in_progress' then
            return pg_catalog.jsonb_build_object('kind', 'idempotency_conflict');
        end if;
        v_idempotency_id := v_existing.id;

        if v_existing.resource_id is not null then
            v_projection := app._a23_dashboard_payment_link_json(v_existing.resource_id);
            if v_projection is null then
                raise exception using errcode = '55000', message = 'A23 payment-link resource link is invalid';
            end if;
            update app.request_idempotency
            set state = 'completed', http_status_snapshot = 201,
                response_snapshot = v_projection, completed_at = pg_catalog.clock_timestamp()
            where id = v_existing.id;
            return pg_catalog.jsonb_build_object('kind', 'created', 'replayed', true, 'paymentLink', v_projection);
        end if;
    end if;

    -- A completed replay returns above before a new CSPRNG token is requested.
    if v_public_token is null then
        return pg_catalog.jsonb_build_object('kind', 'token_required');
    end if;

    v_payment_link_id := pg_catalog.gen_random_uuid();
    begin
        insert into app.payment_links(
            id, merchant_id, environment, public_token, status,
            amount_cents, currency, description, pix_expiration_minutes
        ) values (
            v_payment_link_id, p_merchant_id, 'sandbox', v_public_token, 'active',
            v_amount, 'BRL', v_description, v_expiration
        );
    exception when unique_violation then
        return pg_catalog.jsonb_build_object('kind', 'token_collision');
    end;

    v_projection := app._a23_dashboard_payment_link_json(v_payment_link_id);

    update app.request_idempotency
    set resource_type = 'payment_link', resource_id = v_payment_link_id,
        state = 'completed', http_status_snapshot = 201,
        response_snapshot = v_projection, completed_at = pg_catalog.clock_timestamp()
    where id = v_idempotency_id;

    return pg_catalog.jsonb_build_object(
        'kind', 'created',
        'replayed', false,
        'paymentLink', v_projection
    );
end;
$$;

create function app.disable_dashboard_payment_link(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_payment_link_id uuid,
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
    v_idempotency_id uuid;
    v_existing app.request_idempotency%rowtype;
    v_projection jsonb;
    v_status text;
begin
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, 'admin');

    if p_environment is distinct from 'sandbox' then
        return pg_catalog.jsonb_build_object('kind', 'forbidden');
    end if;
    if p_payment_link_id is null
       or p_idempotency_key is null
       or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
       or pg_catalog.length(p_idempotency_key) < 1
       or pg_catalog.length(p_idempotency_key) > 160
       or p_request_hash is null
       or p_request_hash !~ '^[0-9a-f]{64}$'
       or p_command is null
       or p_command <> '{}'::jsonb then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;

    select pl.status into v_status
    from app.payment_links pl
    where pl.id = p_payment_link_id
      and pl.merchant_id = p_merchant_id
      and pl.environment = 'sandbox'
    for update;
    if not found then
        return pg_catalog.jsonb_build_object('kind', 'resource_not_found');
    end if;

    insert into app.request_idempotency(
        merchant_id, environment, operation, idempotency_key, request_hash, state
    ) values (
        p_merchant_id,
        'sandbox',
        'dashboard_payment_link_disable:' || p_payment_link_id::text,
        p_idempotency_key,
        p_request_hash,
        'in_progress'
    )
    on conflict (merchant_id, environment, operation, idempotency_key) do nothing
    returning id into v_idempotency_id;

    if v_idempotency_id is null then
        select ri.* into v_existing
        from app.request_idempotency ri
        where ri.merchant_id = p_merchant_id
          and ri.environment = 'sandbox'
          and ri.operation = 'dashboard_payment_link_disable:' || p_payment_link_id::text
          and ri.idempotency_key = p_idempotency_key
        for update;
        if not found then
            raise exception using errcode = '55000', message = 'A23 disable idempotency state disappeared';
        end if;
        if v_existing.request_hash <> p_request_hash then
            return pg_catalog.jsonb_build_object('kind', 'idempotency_conflict');
        end if;
        if v_existing.state = 'completed' then
            return pg_catalog.jsonb_build_object('kind', 'ok', 'replayed', true, 'paymentLink', v_existing.response_snapshot);
        end if;
        if v_existing.state <> 'in_progress' then
            return pg_catalog.jsonb_build_object('kind', 'idempotency_conflict');
        end if;
        v_idempotency_id := v_existing.id;
    end if;

    if v_status = 'active' then
        update app.payment_links
        set status = 'disabled', disabled_at = pg_catalog.clock_timestamp()
        where id = p_payment_link_id;
    end if;

    v_projection := app._a23_dashboard_payment_link_json(p_payment_link_id);
    update app.request_idempotency
    set resource_type = 'payment_link', resource_id = p_payment_link_id,
        state = 'completed', http_status_snapshot = 200,
        response_snapshot = v_projection, completed_at = pg_catalog.clock_timestamp()
    where id = v_idempotency_id;

    return pg_catalog.jsonb_build_object('kind', 'ok', 'replayed', false, 'paymentLink', v_projection);
end;
$$;

create function app.get_public_payment_link(p_public_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    if p_public_token is null or p_public_token !~ '^plink_sandbox_[A-Za-z0-9_-]{32}$' then
        return null;
    end if;

    select pg_catalog.jsonb_build_object(
        'merchantName', m.name,
        'amount', pl.amount_cents,
        'currency', pl.currency,
        'description', pl.description,
        'environment', 'sandbox',
        'pixExpirationMinutes', pl.pix_expiration_minutes
    ) into v_result
    from app.payment_links pl
    join app.merchants m on m.id = pl.merchant_id
    where pl.public_token = p_public_token
      and pl.environment = 'sandbox'
      and pl.status = 'active'
      and m.lifecycle_status = 'active';

    return v_result;
end;
$$;

create function app.prepare_payment_link_pix_payment(
    p_public_token text,
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
    v_link app.payment_links%rowtype;
    v_operation text;
    v_idempotency_id uuid;
    v_existing app.request_idempotency%rowtype;
    v_provider_id uuid;
    v_provider_account_id uuid;
    v_eligible_count bigint;
    v_payment_id uuid;
    v_attempt_id uuid;
    v_attempt_state text;
    v_attempt_expires_at timestamptz;
    v_expires_at timestamptz;
    v_payment jsonb;
begin
    if p_public_token is null or p_public_token !~ '^plink_sandbox_[A-Za-z0-9_-]{32}$' then
        return pg_catalog.jsonb_build_object('kind', 'not_found');
    end if;
    if p_idempotency_key is null
       or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
       or pg_catalog.length(p_idempotency_key) < 1
       or pg_catalog.length(p_idempotency_key) > 160
       or p_request_hash is null
       or p_request_hash !~ '^[0-9a-f]{64}$' then
        return pg_catalog.jsonb_build_object('kind', 'validation_error');
    end if;

    select pl.* into v_link
    from app.payment_links pl
    join app.merchants m on m.id = pl.merchant_id
    where pl.public_token = p_public_token
      and pl.environment = 'sandbox'
      and pl.status = 'active'
      and m.lifecycle_status = 'active'
    for share of pl;
    if not found then
        return pg_catalog.jsonb_build_object('kind', 'not_found');
    end if;

    v_operation := 'payment_link_create_payment:' || v_link.id::text;

    insert into app.request_idempotency(
        merchant_id, environment, operation, idempotency_key, request_hash, state
    ) values (
        v_link.merchant_id, 'sandbox', v_operation, p_idempotency_key, p_request_hash, 'in_progress'
    )
    on conflict (merchant_id, environment, operation, idempotency_key) do nothing
    returning id into v_idempotency_id;

    if v_idempotency_id is null then
        select ri.* into v_existing
        from app.request_idempotency ri
        where ri.merchant_id = v_link.merchant_id
          and ri.environment = 'sandbox'
          and ri.operation = v_operation
          and ri.idempotency_key = p_idempotency_key
        for update;
        if not found then
            raise exception using errcode = '55000', message = 'A23 checkout idempotency state disappeared';
        end if;
        if v_existing.request_hash <> p_request_hash then
            return pg_catalog.jsonb_build_object('kind', 'conflict');
        end if;
        if v_existing.state = 'completed' then
            if v_existing.http_status_snapshot <> 201 or v_existing.response_snapshot is null then
                raise exception using errcode = '55000', message = 'A23 checkout completed snapshot is invalid';
            end if;
            return pg_catalog.jsonb_build_object('kind', 'completed', 'httpStatus', 201, 'payment', v_existing.response_snapshot);
        end if;
        if v_existing.state <> 'in_progress' or v_existing.resource_type is distinct from 'payment' or v_existing.resource_id is null then
            raise exception using errcode = '55000', message = 'A23 checkout idempotency resource is invalid';
        end if;

        select pa.id, pa.state, pa.expires_at
        into v_attempt_id, v_attempt_state, v_attempt_expires_at
        from app.provider_attempts pa
        where pa.payment_id = v_existing.resource_id
        order by pa.attempt_number desc
        limit 1;
        if not found then
            raise exception using errcode = '55000', message = 'A23 checkout ProviderAttempt is missing';
        end if;

        v_payment := app._a2_public_payment_json(v_existing.resource_id);
        if v_attempt_state = 'prepared' then
            return pg_catalog.jsonb_build_object(
                'kind', 'prepared',
                'merchantId', v_link.merchant_id::text,
                'payment', v_payment,
                'providerAttempt', pg_catalog.jsonb_build_object(
                    'id', v_attempt_id::text,
                    'amountCents', v_link.amount_cents,
                    'expiresAt', pg_catalog.to_char(v_attempt_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                )
            );
        end if;
        if v_attempt_state in ('executing', 'execution_unknown') then
            return pg_catalog.jsonb_build_object('kind', v_attempt_state, 'payment', v_payment);
        end if;
        if v_attempt_state in ('succeeded', 'definitively_failed') then
            update app.request_idempotency
            set state = 'completed', http_status_snapshot = 201,
                response_snapshot = v_payment, completed_at = pg_catalog.clock_timestamp()
            where id = v_existing.id;
            return pg_catalog.jsonb_build_object('kind', 'completed', 'httpStatus', 201, 'payment', v_payment);
        end if;
        raise exception using errcode = '55000', message = 'A23 checkout ProviderAttempt state is invalid';
    end if;

    select pg_catalog.count(*) into v_eligible_count
    from app.provider_accounts pa
    join app.providers pr on pr.id = pa.provider_id
    where pr.code = 'swiftpay_emulator'
      and pr.status = 'active'
      and pa.merchant_id is null
      and pa.environment = 'sandbox'
      and pa.status = 'active'
      and pa.capabilities @> '{"create_pix_charge":true}'::jsonb;
    if v_eligible_count <> 1 then
        raise exception using errcode = '55000', message = 'A23 sandbox emulator routing is not uniquely configured';
    end if;

    select pr.id, pa.id into v_provider_id, v_provider_account_id
    from app.provider_accounts pa
    join app.providers pr on pr.id = pa.provider_id
    where pr.code = 'swiftpay_emulator'
      and pr.status = 'active'
      and pa.merchant_id is null
      and pa.environment = 'sandbox'
      and pa.status = 'active'
      and pa.capabilities @> '{"create_pix_charge":true}'::jsonb;

    v_payment_id := pg_catalog.gen_random_uuid();
    v_attempt_id := pg_catalog.gen_random_uuid();
    v_expires_at := pg_catalog.clock_timestamp() + pg_catalog.make_interval(mins => v_link.pix_expiration_minutes);

    insert into app.payments(
        id, merchant_id, environment, external_id, source, source_resource_id,
        collection_status, amount_cents, currency, description, customer_snapshot,
        pricing_version, rounding_policy_version, merchant_fee_cents, merchant_net_cents,
        provider_cost_cents, refunded_amount_cents, expires_at, refund_fee_policy,
        fee_mode, fee_fixed_cents, fee_basis_points, fee_percentage_component_cents,
        routing_policy_version
    ) values (
        v_payment_id, v_link.merchant_id, 'sandbox', null, 'payment_link', v_link.id,
        'creating', v_link.amount_cents, 'BRL', v_link.description, null,
        'sandbox-zero-fee-v0', 'ceil-bp-v1', 0, v_link.amount_cents,
        null, 0, v_expires_at, 'merchant_fee_non_refundable',
        'fixed', 0, 0, 0, 'sandbox-emulator-v0'
    );

    insert into app.provider_attempts(
        id, payment_id, provider_id, provider_account_id, operation, attempt_number,
        state, client_reference, request_fingerprint, expires_at
    ) values (
        v_attempt_id, v_payment_id, v_provider_id, v_provider_account_id,
        'create_pix_charge', 1, 'prepared', v_attempt_id::text, p_request_hash, v_expires_at
    );

    update app.request_idempotency
    set resource_type = 'payment', resource_id = v_payment_id
    where id = v_idempotency_id;

    v_payment := app._a2_public_payment_json(v_payment_id);
    return pg_catalog.jsonb_build_object(
        'kind', 'prepared',
        'merchantId', v_link.merchant_id::text,
        'payment', v_payment,
        'providerAttempt', pg_catalog.jsonb_build_object(
            'id', v_attempt_id::text,
            'amountCents', v_link.amount_cents,
            'expiresAt', pg_catalog.to_char(v_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
    );
end;
$$;

-- Preserve the exact A2 function implementation behind a non-runtime helper,
-- then restore the public signature with a source-aware compatibility wrapper.
alter function app.resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    rename to _a23_a2_resolve_api_pix_attempt;
revoke all on function app._a23_a2_resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

create function app._a23_resolve_payment_link_pix_attempt(
    p_merchant_id uuid,
    p_environment text,
    p_payment_id uuid,
    p_provider_attempt_id uuid,
    p_execution_token uuid,
    p_resolution jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_certainty text;
    v_link_id uuid;
    v_idempotency_id uuid;
    v_payment jsonb;
begin
    if p_environment is distinct from 'sandbox'
       or p_resolution is null
       or pg_catalog.jsonb_typeof(p_resolution) <> 'object' then
        raise exception using errcode = '22023', message = 'A23 checkout resolution is invalid';
    end if;

    select p.source_resource_id into v_link_id
    from app.payments p
    where p.id = p_payment_id
      and p.merchant_id = p_merchant_id
      and p.environment = 'sandbox'
      and p.source = 'payment_link';
    if not found or v_link_id is null then
        raise exception using errcode = '55000', message = 'A23 checkout Payment scope is invalid';
    end if;

    perform 1
    from app.provider_attempts pa
    where pa.id = p_provider_attempt_id
      and pa.payment_id = p_payment_id
      and pa.state = 'executing'
      and pa.execution_token = p_execution_token
    for update;
    if not found then
        raise exception using errcode = '55000', message = 'A23 checkout resolution does not own execution';
    end if;

    select ri.id into v_idempotency_id
    from app.request_idempotency ri
    where ri.merchant_id = p_merchant_id
      and ri.environment = 'sandbox'
      and ri.operation = 'payment_link_create_payment:' || v_link_id::text
      and ri.resource_type = 'payment'
      and ri.resource_id = p_payment_id
      and ri.state = 'in_progress'
    for update;
    if not found then
        raise exception using errcode = '55000', message = 'A23 checkout idempotency link is invalid';
    end if;

    v_certainty := p_resolution ->> 'certainty';

    if v_certainty = 'success' then
        if pg_catalog.jsonb_object_length(p_resolution) <> 6
           or pg_catalog.coalesce(p_resolution ->> 'providerPaymentId', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'txId', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'copyAndPaste', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'qrCode', '') = ''
           or pg_catalog.coalesce(p_resolution ->> 'expiresAt', '') = '' then
            raise exception using errcode = '22023', message = 'A23 checkout success resolution is invalid';
        end if;

        update app.provider_attempts
        set state = 'succeeded',
            provider_payment_id = p_resolution ->> 'providerPaymentId',
            provider_txid = p_resolution ->> 'txId',
            provider_status_raw = 'emulator_pending',
            pix_copy_paste = p_resolution ->> 'copyAndPaste',
            pix_qr_reference = p_resolution ->> 'qrCode',
            execution_token = null,
            lease_expires_at = null,
            finished_at = v_now,
            last_error_class = null,
            last_error_code = null,
            updated_at = v_now
        where id = p_provider_attempt_id;

        update app.payments
        set collection_status = 'pending', updated_at = v_now
        where id = p_payment_id;

        v_payment := app._a2_public_payment_json(p_payment_id);
        update app.request_idempotency
        set state = 'completed', http_status_snapshot = 201,
            response_snapshot = v_payment, completed_at = v_now
        where id = v_idempotency_id;
        return v_payment;
    end if;

    if v_certainty = 'execution_unknown' then
        if p_resolution ->> 'errorClass' is distinct from 'execution_unknown' then
            raise exception using errcode = '22023', message = 'A23 execution-unknown resolution is invalid';
        end if;
        update app.provider_attempts
        set state = 'execution_unknown', execution_token = null, lease_expires_at = null,
            recovery_required_at = v_now, last_error_class = 'execution_unknown',
            last_error_code = null, updated_at = v_now
        where id = p_provider_attempt_id;
        return app._a2_public_payment_json(p_payment_id);
    end if;

    if v_certainty = 'definitive_rejection' then
        if p_resolution ->> 'errorClass' is distinct from 'definitive_rejection'
           or pg_catalog.coalesce(p_resolution ->> 'errorCode', '') = '' then
            raise exception using errcode = '22023', message = 'A23 definitive rejection resolution is invalid';
        end if;
        update app.provider_attempts
        set state = 'definitively_failed', execution_token = null, lease_expires_at = null,
            finished_at = v_now, last_error_class = 'definitive_rejection',
            last_error_code = p_resolution ->> 'errorCode', updated_at = v_now
        where id = p_provider_attempt_id;
        update app.payments
        set collection_status = 'failed', updated_at = v_now
        where id = p_payment_id;
        v_payment := app._a2_public_payment_json(p_payment_id);
        update app.request_idempotency
        set state = 'completed', http_status_snapshot = 201,
            response_snapshot = v_payment, completed_at = v_now
        where id = v_idempotency_id;
        return v_payment;
    end if;

    raise exception using errcode = '22023', message = 'A23 checkout resolution certainty is invalid';
end;
$$;

revoke all on function app._a23_resolve_payment_link_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

create function app.resolve_api_pix_attempt(
    p_merchant_id uuid,
    p_environment text,
    p_payment_id uuid,
    p_provider_attempt_id uuid,
    p_execution_token uuid,
    p_resolution jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_source text;
begin
    select p.source into v_source
    from app.payments p
    where p.id = p_payment_id
      and p.merchant_id = p_merchant_id
      and p.environment = p_environment;

    if v_source = 'payment_link' then
        return app._a23_resolve_payment_link_pix_attempt(
            p_merchant_id, p_environment, p_payment_id, p_provider_attempt_id, p_execution_token, p_resolution
        );
    end if;

    return app._a23_a2_resolve_api_pix_attempt(
        p_merchant_id, p_environment, p_payment_id, p_provider_attempt_id, p_execution_token, p_resolution
    );
end;
$$;

-- Extend A14/A18 with the dedicated anonymous checkout quota while preserving
-- canonical dual-HMAC insertion/locking order from A18's concurrency fix.
create or replace function app.consume_api_abuse_quota(
  p_policy text,
  p_active_subject_hash text,
  p_previous_subject_hash text default null
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_limit integer;
  v_canonical_window_started_at timestamptz;
  v_canonical_request_count integer;
  v_request_count_after integer;
  v_allowed boolean;
  v_remaining integer;
  v_retry_after_seconds integer;
begin
  if p_active_subject_hash is null or p_active_subject_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid abuse quota subject'; end if;
  if p_previous_subject_hash is not null and p_previous_subject_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid abuse quota subject'; end if;
  if p_previous_subject_hash = p_active_subject_hash then raise exception 'duplicate abuse quota subjects'; end if;

  v_limit := case p_policy
    when 'token_exchange_pre_auth' then 30
    when 'machine_request_pre_auth' then 12000
    when 'machine_read' then 6000
    when 'machine_mutation' then 3000
    when 'dashboard_request_pre_auth' then 300
    when 'checkout_request_pre_auth' then 120
    when 'readiness_probe' then 120
    else null
  end;
  if v_limit is null then raise exception 'invalid abuse quota policy'; end if;

  delete from app.api_abuse_windows as target
  using (
    select candidate.ctid from app.api_abuse_windows as candidate
    where candidate.updated_at < v_now - interval '24 hours'
    order by candidate.updated_at asc limit 32
  ) as stale
  where target.ctid = stale.ctid;

  insert into app.api_abuse_windows(policy, subject_hash, window_started_at, request_count, updated_at)
  select p_policy, subject.subject_hash, v_now - interval '60 seconds', 0, v_now
  from (
    select p_active_subject_hash as subject_hash
    union all
    select p_previous_subject_hash where p_previous_subject_hash is not null
  ) as subject
  order by subject.subject_hash asc
  on conflict (policy, subject_hash) do nothing;

  perform abuse_window.subject_hash
  from app.api_abuse_windows as abuse_window
  where abuse_window.policy = p_policy
    and (abuse_window.subject_hash = p_active_subject_hash
      or (p_previous_subject_hash is not null and abuse_window.subject_hash = p_previous_subject_hash))
  order by abuse_window.subject_hash asc
  for update;

  select max(abuse_window.window_started_at), max(abuse_window.request_count)
  into v_canonical_window_started_at, v_canonical_request_count
  from app.api_abuse_windows as abuse_window
  where abuse_window.policy = p_policy
    and (abuse_window.subject_hash = p_active_subject_hash
      or (p_previous_subject_hash is not null and abuse_window.subject_hash = p_previous_subject_hash))
    and v_now < abuse_window.window_started_at + interval '60 seconds';

  if v_canonical_window_started_at is null then
    v_canonical_window_started_at := v_now;
    v_canonical_request_count := 0;
  end if;

  if v_canonical_request_count < v_limit then
    v_request_count_after := v_canonical_request_count + 1;
    v_allowed := true;
    v_remaining := v_limit - v_request_count_after;
    v_retry_after_seconds := 0;
  else
    v_request_count_after := v_canonical_request_count;
    v_allowed := false;
    v_remaining := 0;
    v_retry_after_seconds := pg_catalog.greatest(1, pg_catalog.least(60,
      pg_catalog.ceil(pg_catalog.extract(epoch from ((v_canonical_window_started_at + interval '60 seconds') - v_now)))::integer));
  end if;

  update app.api_abuse_windows as abuse_window
  set window_started_at = v_canonical_window_started_at,
      request_count = v_request_count_after,
      updated_at = v_now
  where abuse_window.policy = p_policy
    and (abuse_window.subject_hash = p_active_subject_hash
      or (p_previous_subject_hash is not null and abuse_window.subject_hash = p_previous_subject_hash));

  return query select v_allowed, v_remaining, v_retry_after_seconds;
end;
$$;

revoke all on function app.list_dashboard_payment_links(uuid, uuid, text)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.create_dashboard_payment_link(uuid, uuid, text, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.disable_dashboard_payment_link(uuid, uuid, text, uuid, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.get_public_payment_link(text)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.prepare_payment_link_pix_payment(text, text, text)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.consume_api_abuse_quota(text, text, text)
    from public, anon, authenticated, service_role, swiftpay_worker;

grant execute on function app.list_dashboard_payment_links(uuid, uuid, text) to swiftpay_api;
grant execute on function app.create_dashboard_payment_link(uuid, uuid, text, text, text, jsonb) to swiftpay_api;
grant execute on function app.disable_dashboard_payment_link(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
grant execute on function app.get_public_payment_link(text) to swiftpay_api;
grant execute on function app.prepare_payment_link_pix_payment(text, text, text) to swiftpay_api;
grant execute on function app.resolve_api_pix_attempt(uuid, text, uuid, uuid, uuid, jsonb) to swiftpay_api;
grant execute on function app.consume_api_abuse_quota(text, text, text) to swiftpay_api;
