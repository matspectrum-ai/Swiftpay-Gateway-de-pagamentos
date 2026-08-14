-- SwiftPay V2 Phase 2: canonical ledger identity and PostgreSQL durable work foundation.

create table app.accounts (
    id uuid primary key default gen_random_uuid(),
    scope_type text not null,
    scope_id uuid,
    environment text not null,
    currency text not null default 'BRL',
    account_type text not null,
    category text not null,
    normal_side text not null,
    balance_cents bigint not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint accounts_scope_type_ck
        check (scope_type in ('merchant', 'provider', 'platform')),
    constraint accounts_scope_identity_ck
        check (
            (scope_type = 'platform' and scope_id is null)
            or (scope_type in ('merchant', 'provider') and scope_id is not null)
        ),
    constraint accounts_environment_ck check (environment in ('sandbox', 'production')),
    constraint accounts_currency_brl_ck check (currency = 'BRL'),
    constraint accounts_category_ck check (category in ('asset', 'liability', 'revenue', 'expense')),
    constraint accounts_normal_side_ck check (normal_side in ('debit', 'credit')),
    constraint accounts_type_ck check (account_type in (
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
    ))
);

-- PostgreSQL NULLS NOT DISTINCT makes the platform/null account identity truly unique.
create unique index accounts_identity_uq
    on app.accounts (scope_type, scope_id, environment, currency, account_type)
    nulls not distinct;

create table app.ledger_transactions (
    id uuid primary key default gen_random_uuid(),
    environment text not null,
    currency text not null default 'BRL',
    source_type text not null,
    source_id uuid not null,
    posting_type text not null,
    description text,
    created_at timestamptz not null default now(),
    constraint ledger_transactions_environment_ck check (environment in ('sandbox', 'production')),
    constraint ledger_transactions_currency_brl_ck check (currency = 'BRL'),
    constraint ledger_transactions_source_type_nonempty_ck check (length(trim(source_type)) > 0),
    constraint ledger_transactions_posting_type_nonempty_ck check (length(trim(posting_type)) > 0)
);

create unique index ledger_transactions_source_uq
    on app.ledger_transactions (environment, source_type, source_id, posting_type);

create table app.ledger_entries (
    id uuid primary key default gen_random_uuid(),
    ledger_transaction_id uuid not null references app.ledger_transactions(id) on delete restrict,
    account_id uuid not null references app.accounts(id) on delete restrict,
    direction text not null,
    amount_cents bigint not null,
    created_at timestamptz not null default now(),
    constraint ledger_entries_direction_ck check (direction in ('debit', 'credit')),
    constraint ledger_entries_amount_positive_ck check (amount_cents > 0)
);

create index ledger_entries_transaction_idx
    on app.ledger_entries (ledger_transaction_id, id);
create index ledger_entries_account_idx
    on app.ledger_entries (account_id, created_at, id);

create table app.outbox_jobs (
    id uuid primary key default gen_random_uuid(),
    kind text not null,
    source_type text not null,
    source_id uuid not null,
    dedupe_key text not null,
    payload_version integer not null default 1,
    payload_json jsonb not null default '{}'::jsonb,
    state text not null default 'pending',
    attempt_count integer not null default 0,
    max_attempts integer not null default 10,
    next_attempt_at timestamptz not null default now(),
    lease_token uuid,
    lease_expires_at timestamptz,
    last_started_at timestamptz,
    last_finished_at timestamptz,
    last_error_class text,
    last_error_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    constraint outbox_jobs_kind_nonempty_ck check (length(trim(kind)) > 0),
    constraint outbox_jobs_source_type_nonempty_ck check (length(trim(source_type)) > 0),
    constraint outbox_jobs_dedupe_key_nonempty_ck check (length(trim(dedupe_key)) > 0),
    constraint outbox_jobs_payload_version_ck check (payload_version > 0),
    constraint outbox_jobs_state_ck check (state in ('pending', 'leased', 'completed', 'dead')),
    constraint outbox_jobs_attempt_count_ck check (attempt_count >= 0),
    constraint outbox_jobs_max_attempts_ck check (max_attempts > 0),
    constraint outbox_jobs_lease_shape_ck check (
        (state = 'leased' and lease_token is not null and lease_expires_at is not null)
        or (state <> 'leased')
    )
);

create unique index outbox_jobs_dedupe_uq on app.outbox_jobs (dedupe_key);
create index outbox_jobs_due_idx
    on app.outbox_jobs (next_attempt_at, created_at, id)
    where state = 'pending';

revoke all on app.accounts, app.ledger_transactions, app.ledger_entries, app.outbox_jobs
    from anon, authenticated, service_role;
