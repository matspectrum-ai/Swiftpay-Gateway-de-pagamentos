-- SwiftPay V2 Phase 2: canonical double-entry ledger foundation.
-- The app schema is server-only. Merchant ownership and provider funding location
-- are modeled separately; provider-specific merchant balance buckets do not exist.

create table app.accounts (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid references app.merchants(id) on delete restrict,
    provider_account_id uuid references app.provider_accounts(id) on delete restrict,
    environment text not null,
    currency text not null default 'BRL',
    account_type text not null,
    category text not null,
    normal_side text not null,
    balance_cents bigint not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint accounts_environment_ck
        check (environment in ('sandbox', 'production')),
    constraint accounts_currency_brl_ck
        check (currency = 'BRL'),
    constraint accounts_category_ck
        check (category in ('asset', 'liability', 'revenue', 'expense')),
    constraint accounts_normal_side_ck
        check (normal_side in ('debit', 'credit')),
    constraint accounts_type_ck
        check (account_type in (
            'provider_settlement_asset',
            'merchant_pending_liability',
            'merchant_available_liability',
            'merchant_risk_reserved_liability',
            'merchant_payout_blocked_liability',
            'merchant_refund_blocked_liability',
            'payment_fee_revenue',
            'payout_fee_revenue',
            'provider_payment_fee_expense',
            'provider_payout_fee_expense'
        )),
    constraint accounts_scope_ck
        check (
            (account_type = 'provider_settlement_asset'
                and merchant_id is null
                and provider_account_id is not null)
            or
            (account_type in (
                'merchant_pending_liability',
                'merchant_available_liability',
                'merchant_risk_reserved_liability',
                'merchant_payout_blocked_liability',
                'merchant_refund_blocked_liability'
            )
                and merchant_id is not null
                and provider_account_id is null)
            or
            (account_type in (
                'payment_fee_revenue',
                'payout_fee_revenue',
                'provider_payment_fee_expense',
                'provider_payout_fee_expense'
            )
                and merchant_id is null
                and provider_account_id is null)
        ),
    constraint accounts_type_semantics_ck
        check (
            (account_type = 'provider_settlement_asset'
                and category = 'asset' and normal_side = 'debit')
            or
            (account_type in (
                'merchant_pending_liability',
                'merchant_available_liability',
                'merchant_risk_reserved_liability',
                'merchant_payout_blocked_liability',
                'merchant_refund_blocked_liability'
            ) and category = 'liability' and normal_side = 'credit')
            or
            (account_type in ('payment_fee_revenue', 'payout_fee_revenue')
                and category = 'revenue' and normal_side = 'credit')
            or
            (account_type in ('provider_payment_fee_expense', 'provider_payout_fee_expense')
                and category = 'expense' and normal_side = 'debit')
        )
);

create unique index accounts_merchant_identity_uq
    on app.accounts (merchant_id, environment, currency, account_type)
    where merchant_id is not null and provider_account_id is null;

create unique index accounts_provider_identity_uq
    on app.accounts (provider_account_id, environment, currency, account_type)
    where provider_account_id is not null and merchant_id is null;

create unique index accounts_platform_identity_uq
    on app.accounts (environment, currency, account_type)
    where merchant_id is null and provider_account_id is null;

create table app.ledger_transactions (
    id uuid primary key default gen_random_uuid(),
    environment text not null,
    currency text not null default 'BRL',
    source_type text not null,
    source_id uuid not null,
    posting_type text not null,
    created_at timestamptz not null default now(),

    constraint ledger_transactions_environment_ck
        check (environment in ('sandbox', 'production')),
    constraint ledger_transactions_currency_brl_ck
        check (currency = 'BRL'),
    constraint ledger_transactions_source_type_nonempty_ck
        check (length(trim(source_type)) > 0),
    constraint ledger_transactions_posting_type_nonempty_ck
        check (length(trim(posting_type)) > 0)
);

create unique index ledger_transactions_source_uq
    on app.ledger_transactions (environment, source_type, source_id, posting_type);

create table app.ledger_entries (
    id uuid primary key default gen_random_uuid(),
    ledger_transaction_id uuid not null
        references app.ledger_transactions(id) on delete restrict,
    account_id uuid not null
        references app.accounts(id) on delete restrict,
    direction text not null,
    amount_cents bigint not null,
    created_at timestamptz not null default now(),

    constraint ledger_entries_direction_ck
        check (direction in ('debit', 'credit')),
    constraint ledger_entries_amount_positive_ck
        check (amount_cents > 0)
);

create index ledger_entries_transaction_idx
    on app.ledger_entries (ledger_transaction_id, id);

create index ledger_entries_account_idx
    on app.ledger_entries (account_id, created_at, id);

create or replace function app.ensure_account(
    p_merchant_id uuid,
    p_provider_account_id uuid,
    p_environment text,
    p_currency text,
    p_account_type text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_category text;
    v_normal_side text;
    v_id uuid;
begin
    if p_environment not in ('sandbox', 'production') then
        raise exception 'invalid account environment: %', p_environment
            using errcode = '23514';
    end if;

    if p_currency <> 'BRL' then
        raise exception 'only BRL accounts are supported in V1'
            using errcode = '23514';
    end if;

    case p_account_type
        when 'provider_settlement_asset' then
            v_category := 'asset';
            v_normal_side := 'debit';
            if p_merchant_id is not null or p_provider_account_id is null then
                raise exception 'provider settlement account requires provider_account_id only'
                    using errcode = '23514';
            end if;
        when 'merchant_pending_liability',
             'merchant_available_liability',
             'merchant_risk_reserved_liability',
             'merchant_payout_blocked_liability',
             'merchant_refund_blocked_liability' then
            v_category := 'liability';
            v_normal_side := 'credit';
            if p_merchant_id is null or p_provider_account_id is not null then
                raise exception 'merchant liability account requires merchant_id only'
                    using errcode = '23514';
            end if;
        when 'payment_fee_revenue', 'payout_fee_revenue' then
            v_category := 'revenue';
            v_normal_side := 'credit';
            if p_merchant_id is not null or p_provider_account_id is not null then
                raise exception 'platform revenue account cannot be merchant/provider scoped'
                    using errcode = '23514';
            end if;
        when 'provider_payment_fee_expense', 'provider_payout_fee_expense' then
            v_category := 'expense';
            v_normal_side := 'debit';
            if p_merchant_id is not null or p_provider_account_id is not null then
                raise exception 'platform expense account cannot be merchant/provider scoped'
                    using errcode = '23514';
            end if;
        else
            raise exception 'unsupported account type: %', p_account_type
                using errcode = '23514';
    end case;

    if p_merchant_id is not null then
        insert into app.accounts (
            merchant_id, provider_account_id, environment, currency,
            account_type, category, normal_side
        ) values (
            p_merchant_id, null, p_environment, p_currency,
            p_account_type, v_category, v_normal_side
        )
        on conflict (merchant_id, environment, currency, account_type)
            where merchant_id is not null and provider_account_id is null
        do update set updated_at = app.accounts.updated_at
        returning id into v_id;
    elsif p_provider_account_id is not null then
        insert into app.accounts (
            merchant_id, provider_account_id, environment, currency,
            account_type, category, normal_side
        ) values (
            null, p_provider_account_id, p_environment, p_currency,
            p_account_type, v_category, v_normal_side
        )
        on conflict (provider_account_id, environment, currency, account_type)
            where provider_account_id is not null and merchant_id is null
        do update set updated_at = app.accounts.updated_at
        returning id into v_id;
    else
        insert into app.accounts (
            merchant_id, provider_account_id, environment, currency,
            account_type, category, normal_side
        ) values (
            null, null, p_environment, p_currency,
            p_account_type, v_category, v_normal_side
        )
        on conflict (environment, currency, account_type)
            where merchant_id is null and provider_account_id is null
        do update set updated_at = app.accounts.updated_at
        returning id into v_id;
    end if;

    return v_id;
end;
$$;

create or replace function app.post_ledger_transaction(
    p_environment text,
    p_source_type text,
    p_source_id uuid,
    p_posting_type text,
    p_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_transaction_id uuid;
    v_debits bigint;
    v_credits bigint;
    v_entry_count integer;
    v_target_count integer;
    v_invalid_count integer;
    v_negative_count integer;
begin
    if p_environment not in ('sandbox', 'production') then
        raise exception 'invalid ledger environment: %', p_environment
            using errcode = '23514';
    end if;

    if p_source_id is null
       or p_source_type is null or length(trim(p_source_type)) = 0
       or p_posting_type is null or length(trim(p_posting_type)) = 0 then
        raise exception 'ledger source identity is required'
            using errcode = '23514';
    end if;

    if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then
        raise exception 'ledger posting requires at least two entries'
            using errcode = '23514';
    end if;

    with parsed as (
        select
            (e->>'account_id')::uuid as account_id,
            e->>'direction' as direction,
            (e->>'amount_cents')::bigint as amount_cents
        from jsonb_array_elements(p_entries) e
    )
    select
        count(*)::integer,
        count(*) filter (
            where account_id is null
               or direction not in ('debit', 'credit')
               or amount_cents is null
               or amount_cents <= 0
        )::integer,
        coalesce(sum(amount_cents) filter (where direction = 'debit'), 0)::bigint,
        coalesce(sum(amount_cents) filter (where direction = 'credit'), 0)::bigint
    into v_entry_count, v_invalid_count, v_debits, v_credits
    from parsed;

    if v_invalid_count > 0 then
        raise exception 'ledger entries require account, debit/credit and positive amount'
            using errcode = '23514';
    end if;

    if v_debits <> v_credits then
        raise exception 'unbalanced ledger posting: debits %, credits %', v_debits, v_credits
            using errcode = '23514';
    end if;

    -- Lock each affected account exactly once, in deterministic UUID order.
    -- The DISTINCT lives only inside EXISTS semantics, so PostgreSQL can legally
    -- apply FOR UPDATE to the account rows themselves.
    perform a.id
    from app.accounts a
    where exists (
        select 1
        from jsonb_array_elements(p_entries) e
        where (e->>'account_id')::uuid = a.id
    )
    order by a.id
    for update;

    select count(*)::integer
    into v_target_count
    from app.accounts a
    join (
        select distinct (e->>'account_id')::uuid as account_id
        from jsonb_array_elements(p_entries) e
    ) x on x.account_id = a.id
    where a.environment = p_environment
      and a.currency = 'BRL';

    if v_target_count <> (
        select count(*)::integer
        from (
            select distinct (e->>'account_id')::uuid as account_id
            from jsonb_array_elements(p_entries) e
        ) q
    ) then
        raise exception 'ledger account missing or outside posting environment/currency'
            using errcode = '23514';
    end if;

    -- Merchant liability balances are credit-normal. A debit can consume a
    -- liability bucket but may never make the cached bucket negative.
    with parsed as (
        select
            (e->>'account_id')::uuid as account_id,
            e->>'direction' as direction,
            (e->>'amount_cents')::bigint as amount_cents
        from jsonb_array_elements(p_entries) e
    ), deltas as (
        select
            a.id,
            a.merchant_id,
            a.category,
            a.balance_cents,
            sum(case when p.direction = a.normal_side
                     then p.amount_cents else -p.amount_cents end)::bigint as delta
        from parsed p
        join app.accounts a on a.id = p.account_id
        group by a.id, a.merchant_id, a.category, a.balance_cents
    )
    select count(*)::integer
    into v_negative_count
    from deltas
    where merchant_id is not null
      and category = 'liability'
      and balance_cents + delta < 0;

    if v_negative_count > 0 then
        raise exception 'merchant liability bucket cannot become negative'
            using errcode = '23514';
    end if;

    insert into app.ledger_transactions (
        environment, currency, source_type, source_id, posting_type
    ) values (
        p_environment, 'BRL', p_source_type, p_source_id, p_posting_type
    )
    returning id into v_transaction_id;

    insert into app.ledger_entries (
        ledger_transaction_id, account_id, direction, amount_cents
    )
    select
        v_transaction_id,
        (e->>'account_id')::uuid,
        e->>'direction',
        (e->>'amount_cents')::bigint
    from jsonb_array_elements(p_entries) e;

    with parsed as (
        select
            (e->>'account_id')::uuid as account_id,
            e->>'direction' as direction,
            (e->>'amount_cents')::bigint as amount_cents
        from jsonb_array_elements(p_entries) e
    ), deltas as (
        select
            a.id,
            sum(case when p.direction = a.normal_side
                     then p.amount_cents else -p.amount_cents end)::bigint as delta
        from parsed p
        join app.accounts a on a.id = p.account_id
        group by a.id
    )
    update app.accounts a
       set balance_cents = a.balance_cents + d.delta,
           updated_at = now()
      from deltas d
     where a.id = d.id;

    return v_transaction_id;
end;
$$;

revoke all on app.accounts, app.ledger_transactions, app.ledger_entries
    from anon, authenticated, service_role;

revoke all on function app.ensure_account(uuid, uuid, text, text, text)
    from public, anon, authenticated, service_role;
revoke all on function app.post_ledger_transaction(text, text, uuid, text, jsonb)
    from public, anon, authenticated, service_role;
