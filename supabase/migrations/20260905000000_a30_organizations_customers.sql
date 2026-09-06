-- A30: minimal gateway Day-1 organization/customer/account/payout read-model API.
-- Canonical financial authority remains the existing append-only ledger and payout
-- reservation state machine. This migration creates no mutable balance authority.

create table app.organizations (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    name text not null,
    slug text not null,
    status text not null default 'active',
    is_default boolean not null default false,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint organizations_name_ck check (length(trim(name)) > 0),
    constraint organizations_slug_ck check (slug = lower(trim(slug)) and slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
    constraint organizations_status_ck check (status in ('active','disabled')),
    constraint organizations_metadata_ck check (jsonb_typeof(metadata) = 'object'),
    constraint organizations_id_merchant_uq unique (id, merchant_id),
    constraint organizations_merchant_slug_uq unique (merchant_id, slug)
);

create unique index organizations_one_default_uq
    on app.organizations (merchant_id)
    where is_default;

insert into app.organizations (merchant_id, name, slug, status, is_default)
select m.id, 'Default', 'default', 'active', true
from app.merchants m
where not exists (
    select 1 from app.organizations o where o.merchant_id = m.id and o.is_default
);

create table app.customers (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    organization_id uuid,
    external_ref text,
    name text,
    document text,
    email text,
    phone text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint customers_organization_merchant_fk
        foreign key (organization_id, merchant_id)
        references app.organizations(id, merchant_id) on delete restrict,
    constraint customers_external_ref_ck check (external_ref is null or length(trim(external_ref)) > 0),
    constraint customers_name_ck check (name is null or length(trim(name)) > 0),
    constraint customers_document_ck check (document is null or length(trim(document)) > 0),
    constraint customers_email_ck check (email is null or length(trim(email)) > 0),
    constraint customers_phone_ck check (phone is null or length(trim(phone)) > 0),
    constraint customers_metadata_ck check (jsonb_typeof(metadata) = 'object')
);

create unique index customers_external_ref_uq
    on app.customers (
        merchant_id,
        coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        external_ref
    )
    where external_ref is not null;
create index customers_merchant_created_idx on app.customers (merchant_id, created_at desc, id desc);
create index customers_organization_created_idx on app.customers (organization_id, created_at desc, id desc)
    where organization_id is not null;

create table app.customer_mutation_idempotency (
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    operation text not null,
    target_id uuid not null,
    idempotency_key text not null,
    request_fingerprint text not null,
    customer_id uuid not null references app.customers(id) on delete restrict,
    created_at timestamptz not null default now(),
    primary key (merchant_id, operation, target_id, idempotency_key),
    constraint customer_mutation_operation_ck check (operation in ('create','update')),
    constraint customer_mutation_key_ck check (length(trim(idempotency_key)) > 0),
    constraint customer_mutation_fingerprint_ck check (length(trim(request_fingerprint)) > 0)
);

create or replace function app._a30_customer_json(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
    select jsonb_build_object(
        'id', c.id,
        'object', 'customer',
        'organization_id', c.organization_id,
        'external_ref', c.external_ref,
        'name', c.name,
        'document', c.document,
        'email', c.email,
        'phone', c.phone,
        'metadata', c.metadata,
        'created_at', c.created_at,
        'updated_at', c.updated_at
    )
    from app.customers c
    where c.id = p_customer_id
$$;

create or replace function app.create_api_customer(
    p_merchant_id uuid,
    p_organization_id uuid,
    p_idempotency_key text,
    p_request_fingerprint text,
    p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_target constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
    v_existing app.customer_mutation_idempotency%rowtype;
    v_customer_id uuid;
    v_external_ref text;
begin
    if p_merchant_id is null
       or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0
       or p_request_fingerprint is null or length(trim(p_request_fingerprint)) = 0
       or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'invalid customer create request' using errcode = '23514';
    end if;

    if not exists (
        select 1 from app.merchants m where m.id = p_merchant_id and m.lifecycle_status in ('draft','active')
    ) then
        raise exception 'merchant unavailable' using errcode = '42501';
    end if;

    if p_organization_id is not null and not exists (
        select 1 from app.organizations o
        where o.id = p_organization_id and o.merchant_id = p_merchant_id and o.status = 'active'
    ) then
        raise exception 'organization unavailable' using errcode = '42501';
    end if;

    select * into v_existing
    from app.customer_mutation_idempotency i
    where i.merchant_id = p_merchant_id
      and i.operation = 'create'
      and i.target_id = v_target
      and i.idempotency_key = p_idempotency_key;

    if found then
        if v_existing.request_fingerprint is distinct from p_request_fingerprint then
            raise exception 'customer idempotency key reused with different request' using errcode = '23505';
        end if;
        return app._a30_customer_json(v_existing.customer_id);
    end if;

    v_external_ref := nullif(trim(p_payload->>'external_ref'), '');

    insert into app.customers (
        merchant_id, organization_id, external_ref, name, document, email, phone, metadata
    ) values (
        p_merchant_id,
        p_organization_id,
        v_external_ref,
        nullif(trim(p_payload->>'name'), ''),
        nullif(trim(p_payload->>'document'), ''),
        nullif(trim(p_payload->>'email'), ''),
        nullif(trim(p_payload->>'phone'), ''),
        coalesce(p_payload->'metadata', '{}'::jsonb)
    )
    returning id into v_customer_id;

    insert into app.customer_mutation_idempotency (
        merchant_id, operation, target_id, idempotency_key, request_fingerprint, customer_id
    ) values (
        p_merchant_id, 'create', v_target, p_idempotency_key, p_request_fingerprint, v_customer_id
    );

    return app._a30_customer_json(v_customer_id);
exception
    when unique_violation then
        select * into v_existing
        from app.customer_mutation_idempotency i
        where i.merchant_id = p_merchant_id
          and i.operation = 'create'
          and i.target_id = v_target
          and i.idempotency_key = p_idempotency_key;
        if found then
            if v_existing.request_fingerprint is distinct from p_request_fingerprint then
                raise exception 'customer idempotency key reused with different request' using errcode = '23505';
            end if;
            return app._a30_customer_json(v_existing.customer_id);
        end if;
        raise;
end;
$$;

create or replace function app.get_api_customer(p_merchant_id uuid, p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
    select app._a30_customer_json(c.id)
    from app.customers c
    where c.id = p_customer_id and c.merchant_id = p_merchant_id
$$;

create or replace function app.list_api_customers(
    p_merchant_id uuid,
    p_organization_id uuid,
    p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
    select coalesce(jsonb_agg(app._a30_customer_json(q.id) order by q.created_at desc, q.id desc), '[]'::jsonb)
    from (
        select c.id, c.created_at
        from app.customers c
        where c.merchant_id = p_merchant_id
          and (p_organization_id is null or c.organization_id = p_organization_id)
        order by c.created_at desc, c.id desc
        limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) q
$$;

create or replace function app.update_api_customer(
    p_merchant_id uuid,
    p_customer_id uuid,
    p_idempotency_key text,
    p_request_fingerprint text,
    p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_existing app.customer_mutation_idempotency%rowtype;
    v_customer app.customers%rowtype;
    v_org uuid;
begin
    if p_merchant_id is null or p_customer_id is null
       or p_idempotency_key is null or length(trim(p_idempotency_key)) = 0
       or p_request_fingerprint is null or length(trim(p_request_fingerprint)) = 0
       or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'invalid customer update request' using errcode = '23514';
    end if;

    select * into v_existing
    from app.customer_mutation_idempotency i
    where i.merchant_id = p_merchant_id
      and i.operation = 'update'
      and i.target_id = p_customer_id
      and i.idempotency_key = p_idempotency_key;
    if found then
        if v_existing.request_fingerprint is distinct from p_request_fingerprint then
            raise exception 'customer idempotency key reused with different request' using errcode = '23505';
        end if;
        return app._a30_customer_json(v_existing.customer_id);
    end if;

    select * into v_customer
    from app.customers c
    where c.id = p_customer_id and c.merchant_id = p_merchant_id
    for update;
    if not found then return null; end if;

    if p_payload ? 'organization_id' then
        v_org := nullif(p_payload->>'organization_id', '')::uuid;
        if v_org is not null and not exists (
            select 1 from app.organizations o
            where o.id = v_org and o.merchant_id = p_merchant_id and o.status = 'active'
        ) then
            raise exception 'organization unavailable' using errcode = '42501';
        end if;
    else
        v_org := v_customer.organization_id;
    end if;

    update app.customers c set
        organization_id = v_org,
        external_ref = case when p_payload ? 'external_ref' then nullif(trim(p_payload->>'external_ref'), '') else c.external_ref end,
        name = case when p_payload ? 'name' then nullif(trim(p_payload->>'name'), '') else c.name end,
        document = case when p_payload ? 'document' then nullif(trim(p_payload->>'document'), '') else c.document end,
        email = case when p_payload ? 'email' then nullif(trim(p_payload->>'email'), '') else c.email end,
        phone = case when p_payload ? 'phone' then nullif(trim(p_payload->>'phone'), '') else c.phone end,
        metadata = case when p_payload ? 'metadata' then coalesce(p_payload->'metadata', '{}'::jsonb) else c.metadata end,
        updated_at = now()
    where c.id = p_customer_id and c.merchant_id = p_merchant_id;

    insert into app.customer_mutation_idempotency (
        merchant_id, operation, target_id, idempotency_key, request_fingerprint, customer_id
    ) values (
        p_merchant_id, 'update', p_customer_id, p_idempotency_key, p_request_fingerprint, p_customer_id
    );

    return app._a30_customer_json(p_customer_id);
end;
$$;

create or replace function app.list_api_accounts(p_merchant_id uuid, p_environment text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'object', 'account',
        'type', case a.account_type
            when 'merchant_available_liability' then 'available'
            when 'merchant_pending_liability' then 'pending'
            when 'merchant_payout_blocked_liability' then 'payout_blocked'
            when 'merchant_refund_blocked_liability' then 'refund_blocked'
            when 'merchant_risk_reserved_liability' then 'risk_reserved'
            else a.account_type
        end,
        'currency', a.currency,
        'environment', a.environment,
        'balance_cents', a.balance_cents
    ) order by a.account_type), '[]'::jsonb)
    from app.accounts a
    where a.merchant_id = p_merchant_id
      and a.environment = p_environment
      and a.currency = 'BRL'
$$;

create or replace function app.list_api_account_statement(
    p_merchant_id uuid,
    p_environment text,
    p_account_id uuid,
    p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.entry_id,
        'occurred_at', q.created_at,
        'operation_type', q.posting_type,
        'source_type', q.source_type,
        'source_id', q.source_id,
        'amount_cents', q.amount_cents,
        'currency', 'BRL',
        'balance_effect', case when q.direction = q.normal_side then 'credit' else 'debit' end
    ) order by q.created_at desc, q.entry_id desc), '[]'::jsonb)
    from (
        select le.id as entry_id, le.created_at, le.direction, le.amount_cents,
               a.normal_side, lt.source_type, lt.source_id, lt.posting_type
        from app.accounts a
        join app.ledger_entries le on le.account_id = a.id
        join app.ledger_transactions lt on lt.id = le.ledger_transaction_id
        where a.id = p_account_id
          and a.merchant_id = p_merchant_id
          and a.environment = p_environment
        order by le.created_at desc, le.id desc
        limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) q
$$;

create or replace function app._a30_payout_json(p_merchant_id uuid, p_payout_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
    select jsonb_build_object(
        'id', p.id,
        'object', 'payout',
        'environment', p.environment,
        'currency', p.currency,
        'amount_cents', p.amount_cents,
        'recipient_amount_cents', p.recipient_amount_cents,
        'merchant_fee_cents', p.merchant_fee_cents,
        'state', p.state,
        'external_ref', p.external_id,
        'created_at', p.created_at,
        'updated_at', p.updated_at
    )
    from app.payouts p
    where p.id = p_payout_id and p.merchant_id = p_merchant_id
$$;

create or replace function app.create_api_sandbox_payout(
    p_merchant_id uuid,
    p_environment text,
    p_amount_cents bigint,
    p_destination_snapshot jsonb,
    p_external_ref text,
    p_idempotency_key text,
    p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_payout_id uuid;
    v_safe_destination jsonb;
begin
    if p_environment <> 'sandbox' then
        raise exception 'production payout execution is not enabled' using errcode = '0A000';
    end if;
    if p_destination_snapshot is null or jsonb_typeof(p_destination_snapshot) <> 'object' then
        raise exception 'invalid payout destination' using errcode = '23514';
    end if;

    -- Sandbox never requires a real Pix key. Persist only non-authorizing metadata.
    v_safe_destination := jsonb_build_object(
        'type', 'pix',
        'key_type', coalesce(nullif(trim(p_destination_snapshot->>'key_type'), ''), 'random'),
        'masked', true
    );

    v_payout_id := app.reserve_payout(
        p_merchant_id,
        p_environment,
        'BRL',
        p_amount_cents,
        0,
        v_safe_destination,
        p_idempotency_key,
        p_request_fingerprint,
        now()
    );

    if p_external_ref is not null then
        update app.payouts
        set external_id = coalesce(external_id, nullif(trim(p_external_ref), '')),
            updated_at = now()
        where id = v_payout_id and merchant_id = p_merchant_id;
    end if;

    return app._a30_payout_json(p_merchant_id, v_payout_id);
end;
$$;

create or replace function app.get_api_payout(p_merchant_id uuid, p_payout_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
    select app._a30_payout_json(p_merchant_id, p_payout_id)
$$;

create or replace function app.list_api_payouts(
    p_merchant_id uuid,
    p_environment text,
    p_state text,
    p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
    select coalesce(jsonb_agg(app._a30_payout_json(p_merchant_id, q.id) order by q.created_at desc, q.id desc), '[]'::jsonb)
    from (
        select p.id, p.created_at
        from app.payouts p
        where p.merchant_id = p_merchant_id
          and p.environment = p_environment
          and (p_state is null or p.state = p_state)
        order by p.created_at desc, p.id desc
        limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) q
$$;

revoke all on app.organizations, app.customers, app.customer_mutation_idempotency
    from anon, authenticated, service_role;

revoke all on function app._a30_customer_json(uuid) from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
revoke all on function app.create_api_customer(uuid,uuid,text,text,jsonb) from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.get_api_customer(uuid,uuid) from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.list_api_customers(uuid,uuid,integer) from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.update_api_customer(uuid,uuid,text,text,jsonb) from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.list_api_accounts(uuid,text) from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.list_api_account_statement(uuid,text,uuid,integer) from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app._a30_payout_json(uuid,uuid) from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
revoke all on function app.create_api_sandbox_payout(uuid,text,bigint,jsonb,text,text,text) from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.get_api_payout(uuid,uuid) from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.list_api_payouts(uuid,text,text,integer) from public, anon, authenticated, service_role, swiftpay_worker;

grant execute on function app.create_api_customer(uuid,uuid,text,text,jsonb) to swiftpay_api;
grant execute on function app.get_api_customer(uuid,uuid) to swiftpay_api;
grant execute on function app.list_api_customers(uuid,uuid,integer) to swiftpay_api;
grant execute on function app.update_api_customer(uuid,uuid,text,text,jsonb) to swiftpay_api;
grant execute on function app.list_api_accounts(uuid,text) to swiftpay_api;
grant execute on function app.list_api_account_statement(uuid,text,uuid,integer) to swiftpay_api;
grant execute on function app.create_api_sandbox_payout(uuid,text,bigint,jsonb,text,text,text) to swiftpay_api;
grant execute on function app.get_api_payout(uuid,uuid) to swiftpay_api;
grant execute on function app.list_api_payouts(uuid,text,text,integer) to swiftpay_api;
