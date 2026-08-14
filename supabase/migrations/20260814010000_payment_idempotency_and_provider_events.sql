-- SwiftPay V2 Phase 2: request identity, canonical Payment, ProviderAttempt and ProviderEvent.

create table app.request_idempotency (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete cascade,
    environment text not null,
    operation text not null,
    idempotency_key text not null,
    request_hash text not null,
    state text not null,
    resource_type text,
    resource_id uuid,
    http_status_snapshot integer,
    response_snapshot jsonb,
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    expires_at timestamptz,
    constraint request_idempotency_environment_ck check (environment in ('sandbox', 'production')),
    constraint request_idempotency_state_ck check (state in ('in_progress', 'completed', 'failed')),
    constraint request_idempotency_key_nonempty_ck check (length(trim(idempotency_key)) > 0),
    constraint request_idempotency_hash_nonempty_ck check (length(trim(request_hash)) > 0)
);

create unique index request_idempotency_scope_uq
    on app.request_idempotency (merchant_id, environment, operation, idempotency_key);

create table app.payments (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    environment text not null,
    external_id text,
    source text not null,
    source_resource_id uuid,
    collection_status text not null,
    amount_cents bigint not null,
    currency text not null default 'BRL',
    description text,
    customer_snapshot jsonb,
    metadata jsonb,
    pricing_version text not null,
    rounding_policy_version text not null,
    merchant_fee_cents bigint not null,
    merchant_net_cents bigint not null,
    provider_cost_cents bigint,
    refunded_amount_cents bigint not null default 0,
    expires_at timestamptz,
    paid_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint payments_environment_ck check (environment in ('sandbox', 'production')),
    constraint payments_source_ck check (source in ('api', 'checkout', 'payment_link', 'quick_pix')),
    constraint payments_collection_status_ck
        check (collection_status in ('creating', 'pending', 'paid', 'expired', 'failed', 'cancelled')),
    constraint payments_amount_positive_ck check (amount_cents > 0),
    constraint payments_currency_brl_ck check (currency = 'BRL'),
    constraint payments_merchant_fee_nonnegative_ck check (merchant_fee_cents >= 0),
    constraint payments_merchant_net_nonnegative_ck check (merchant_net_cents >= 0),
    constraint payments_provider_cost_nonnegative_ck check (provider_cost_cents is null or provider_cost_cents >= 0),
    constraint payments_fee_net_equals_gross_ck check (merchant_fee_cents + merchant_net_cents = amount_cents),
    constraint payments_refunded_amount_ck check (refunded_amount_cents >= 0 and refunded_amount_cents <= amount_cents)
);

create index payments_merchant_created_idx
    on app.payments (merchant_id, environment, created_at desc, id);

create table app.provider_attempts (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references app.payments(id) on delete restrict,
    provider_id uuid not null references app.providers(id) on delete restrict,
    provider_account_id uuid not null references app.provider_accounts(id) on delete restrict,
    operation text not null,
    attempt_number integer not null,
    state text not null,
    client_reference text not null,
    request_fingerprint text not null,
    provider_payment_id text,
    provider_txid text,
    provider_status_raw text,
    pix_copy_paste text,
    pix_qr_reference text,
    expires_at timestamptz,
    execution_token uuid,
    lease_expires_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    last_error_class text,
    last_error_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint provider_attempts_operation_ck check (operation = 'create_pix_charge'),
    constraint provider_attempts_attempt_number_ck check (attempt_number > 0),
    constraint provider_attempts_state_ck
        check (state in ('prepared', 'executing', 'succeeded', 'definitively_failed', 'execution_unknown')),
    constraint provider_attempts_client_reference_nonempty_ck check (length(trim(client_reference)) > 0),
    constraint provider_attempts_request_fingerprint_nonempty_ck check (length(trim(request_fingerprint)) > 0)
);

create unique index provider_attempts_payment_attempt_uq
    on app.provider_attempts (payment_id, attempt_number);
create unique index provider_attempts_client_reference_uq
    on app.provider_attempts (provider_account_id, client_reference);
create unique index provider_attempts_one_unresolved_uq
    on app.provider_attempts (payment_id)
    where state in ('prepared', 'executing', 'execution_unknown');

create table app.provider_events (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references app.providers(id) on delete restrict,
    provider_account_id uuid not null references app.provider_accounts(id) on delete restrict,
    environment text not null,
    provider_event_id text,
    fingerprint text not null,
    resource_type text not null,
    provider_resource_id text,
    event_type text not null,
    payload_hash text not null,
    raw_evidence_ref text,
    received_at timestamptz not null default now(),
    applied_at timestamptz,
    state text not null default 'received',
    constraint provider_events_environment_ck check (environment in ('sandbox', 'production')),
    constraint provider_events_state_ck check (state in ('received', 'applied', 'absorbed', 'rejected')),
    constraint provider_events_fingerprint_nonempty_ck check (length(trim(fingerprint)) > 0),
    constraint provider_events_payload_hash_nonempty_ck check (length(trim(payload_hash)) > 0)
);

create unique index provider_events_fingerprint_uq
    on app.provider_events (provider_account_id, environment, fingerprint);
create unique index provider_events_provider_event_id_uq
    on app.provider_events (provider_account_id, environment, provider_event_id)
    where provider_event_id is not null;

revoke all on all tables in schema app from anon, authenticated, service_role;
alter default privileges in schema app revoke all on tables from anon, authenticated, service_role;
