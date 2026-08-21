-- SwiftPay V2 Phase 2: first-class payout/refund resource foundation.
-- External HTTP execution remains outside PostgreSQL; these records preserve
-- operation identity, certainty state and one unresolved provider attempt.

create table app.payout_accounts (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    environment text not null,
    status text not null default 'active',
    destination_ciphertext jsonb not null,
    destination_fingerprint text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint payout_accounts_environment_ck check (environment in ('sandbox','production')),
    constraint payout_accounts_status_ck check (status in ('active','disabled')),
    constraint payout_accounts_fingerprint_ck check (length(trim(destination_fingerprint)) > 0)
);

create table app.payouts (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    environment text not null,
    currency text not null default 'BRL',
    amount_cents bigint not null,
    merchant_fee_cents bigint not null,
    recipient_amount_cents bigint not null,
    external_id text,
    state text not null default 'requested',
    destination_snapshot jsonb not null,
    idempotency_key text not null,
    request_fingerprint text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint payouts_environment_ck check (environment in ('sandbox','production')),
    constraint payouts_currency_ck check (currency = 'BRL'),
    constraint payouts_amount_ck check (amount_cents > 0),
    constraint payouts_fee_ck check (merchant_fee_cents >= 0),
    constraint payouts_recipient_ck check (recipient_amount_cents > 0 and recipient_amount_cents + merchant_fee_cents = amount_cents),
    constraint payouts_state_ck check (state in ('requested','processing','execution_unknown','completed','failed','rejected','cancelled')),
    constraint payouts_destination_ck check (jsonb_typeof(destination_snapshot) = 'object'),
    constraint payouts_idempotency_ck check (length(trim(idempotency_key)) > 0 and length(trim(request_fingerprint)) > 0)
);
create unique index payouts_request_idempotency_uq on app.payouts (merchant_id, environment, idempotency_key);

create table app.payout_attempts (
    id uuid primary key default gen_random_uuid(),
    payout_id uuid not null references app.payouts(id) on delete restrict,
    provider_id uuid not null references app.providers(id) on delete restrict,
    provider_account_id uuid not null references app.provider_accounts(id) on delete restrict,
    attempt_number integer not null,
    state text not null default 'prepared',
    client_reference text not null,
    execution_token uuid,
    lease_expires_at timestamptz,
    provider_payout_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint payout_attempts_number_ck check (attempt_number > 0),
    constraint payout_attempts_state_ck check (state in ('prepared','executing','processing','succeeded','definitively_failed','execution_unknown')),
    constraint payout_attempts_reference_ck check (length(trim(client_reference)) > 0)
);
create unique index payout_attempts_number_uq on app.payout_attempts (payout_id, attempt_number);
create unique index payout_attempts_client_reference_uq on app.payout_attempts (provider_account_id, client_reference);
create unique index payout_attempts_unresolved_uq on app.payout_attempts (payout_id)
where state in ('prepared','executing','processing','execution_unknown');

create table app.refunds (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references app.payments(id) on delete restrict,
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    environment text not null,
    currency text not null default 'BRL',
    amount_cents bigint not null,
    external_id text,
    state text not null default 'requested',
    idempotency_key text not null,
    request_fingerprint text not null,
    fee_policy_version text not null,
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    failed_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint refunds_environment_ck check (environment in ('sandbox','production')),
    constraint refunds_currency_ck check (currency = 'BRL'),
    constraint refunds_amount_ck check (amount_cents > 0),
    constraint refunds_state_ck check (state in ('requested','processing','execution_unknown','completed','failed','cancelled')),
    constraint refunds_identity_ck check (length(trim(idempotency_key)) > 0 and length(trim(request_fingerprint)) > 0),
    constraint refunds_fee_policy_ck check (length(trim(fee_policy_version)) > 0)
);
create unique index refunds_request_idempotency_uq on app.refunds (merchant_id, environment, payment_id, idempotency_key);

create table app.refund_attempts (
    id uuid primary key default gen_random_uuid(),
    refund_id uuid not null references app.refunds(id) on delete restrict,
    provider_id uuid not null references app.providers(id) on delete restrict,
    provider_account_id uuid not null references app.provider_accounts(id) on delete restrict,
    attempt_number integer not null,
    state text not null default 'prepared',
    client_reference text not null,
    execution_token uuid,
    lease_expires_at timestamptz,
    provider_refund_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint refund_attempts_number_ck check (attempt_number > 0),
    constraint refund_attempts_state_ck check (state in ('prepared','executing','processing','succeeded','definitively_failed','execution_unknown')),
    constraint refund_attempts_reference_ck check (length(trim(client_reference)) > 0)
);
create unique index refund_attempts_number_uq on app.refund_attempts (refund_id, attempt_number);
create unique index refund_attempts_client_reference_uq on app.refund_attempts (provider_account_id, client_reference);
create unique index refund_attempts_unresolved_uq on app.refund_attempts (refund_id)
where state in ('prepared','executing','processing','execution_unknown');

-- Signatures are established now; behavioral ledger semantics are introduced
-- only with executable fixtures that prove reservation/release/completion.
create or replace function app.reserve_payout(uuid,text,text,bigint,bigint,jsonb,text,text,timestamptz)
returns uuid language plpgsql security definer set search_path=pg_catalog,app as $$
begin
    raise exception 'reserve_payout behavioral contract not implemented' using errcode='0A000';
end; $$;
create or replace function app.resolve_payout(uuid,text,uuid,timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,app as $$
begin
    raise exception 'resolve_payout behavioral contract not implemented' using errcode='0A000';
end; $$;
create or replace function app.reserve_refund(uuid,uuid,text,bigint,text,text,timestamptz)
returns uuid language plpgsql security definer set search_path=pg_catalog,app as $$
begin
    raise exception 'reserve_refund behavioral contract not implemented' using errcode='0A000';
end; $$;
create or replace function app.resolve_refund(uuid,text,uuid,timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,app as $$
begin
    raise exception 'resolve_refund behavioral contract not implemented' using errcode='0A000';
end; $$;

revoke all on app.payout_accounts, app.payouts, app.payout_attempts, app.refunds, app.refund_attempts from anon, authenticated, service_role;
revoke all on function app.reserve_payout(uuid,text,text,bigint,bigint,jsonb,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.resolve_payout(uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.reserve_refund(uuid,uuid,text,bigint,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function app.resolve_refund(uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
