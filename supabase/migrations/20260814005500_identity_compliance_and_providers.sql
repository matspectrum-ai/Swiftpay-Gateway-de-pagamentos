-- SwiftPay V2 Phase 2: identity, compliance, machine credentials and provider configuration.

create schema if not exists app;

-- Canonical domain objects are server-owned. `app` is intentionally not exposed by config.toml.
revoke all on schema app from public;
revoke all on schema app from anon;
revoke all on schema app from authenticated;
revoke all on schema app from service_role;

create table app.merchants (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    lifecycle_status text not null default 'draft',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    suspended_at timestamptz,
    closed_at timestamptz,
    constraint merchants_lifecycle_status_ck
        check (lifecycle_status in ('draft', 'active', 'suspended', 'closed'))
);

create table app.merchant_members (
    merchant_id uuid not null references app.merchants(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    primary key (merchant_id, user_id),
    constraint merchant_members_role_ck check (role in ('owner', 'admin', 'member')),
    constraint merchant_members_status_ck check (status in ('active', 'disabled'))
);

create table app.kyc_cases (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete cascade,
    status text not null default 'draft',
    requirement_profile_version text not null,
    submitted_at timestamptz,
    decided_at timestamptz,
    decision_reason text,
    reviewed_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint kyc_cases_status_ck
        check (status in ('draft', 'submitted', 'under_review', 'needs_information', 'approved', 'rejected'))
);

create table app.kyc_documents (
    id uuid primary key default gen_random_uuid(),
    kyc_case_id uuid not null references app.kyc_cases(id) on delete restrict,
    merchant_id uuid not null references app.merchants(id) on delete restrict,
    purpose text not null,
    version integer not null,
    storage_path text not null,
    original_filename text,
    detected_mime_type text not null,
    size_bytes bigint not null,
    sha256 text not null,
    status text not null default 'uploaded',
    uploaded_by uuid not null references auth.users(id) on delete restrict,
    created_at timestamptz not null default now(),
    submitted_at timestamptz,
    constraint kyc_documents_version_positive_ck check (version > 0),
    constraint kyc_documents_size_positive_ck check (size_bytes > 0),
    constraint kyc_documents_status_ck
        check (status in ('uploaded', 'submitted', 'accepted', 'rejected', 'quarantined'))
);

create unique index kyc_documents_version_uq
    on app.kyc_documents (kyc_case_id, purpose, version);
create unique index kyc_documents_storage_path_uq
    on app.kyc_documents (storage_path);

create table app.api_credentials (
    id uuid primary key default gen_random_uuid(),
    merchant_id uuid not null references app.merchants(id) on delete cascade,
    environment text not null,
    name text not null,
    public_key text not null,
    secret_verifier text not null,
    secret_version integer not null default 1,
    status text not null default 'active',
    ip_allowlist jsonb,
    last_used_at timestamptz,
    created_at timestamptz not null default now(),
    rotated_at timestamptz,
    revoked_at timestamptz,
    constraint api_credentials_environment_ck check (environment in ('sandbox', 'production')),
    constraint api_credentials_secret_version_ck check (secret_version > 0),
    constraint api_credentials_status_ck check (status in ('active', 'revoked'))
);

create unique index api_credentials_public_key_uq
    on app.api_credentials (public_key);

create table app.providers (
    id uuid primary key default gen_random_uuid(),
    code text not null,
    name text not null,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    constraint providers_status_ck check (status in ('active', 'disabled'))
);

create unique index providers_code_uq on app.providers (code);

create table app.provider_accounts (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references app.providers(id) on delete restrict,
    merchant_id uuid references app.merchants(id) on delete restrict,
    name text not null,
    environment text not null,
    status text not null default 'active',
    credentials_ciphertext jsonb not null,
    capabilities jsonb not null default '{}'::jsonb,
    configuration jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint provider_accounts_environment_ck check (environment in ('sandbox', 'production')),
    constraint provider_accounts_status_ck check (status in ('active', 'disabled'))
);

revoke all on all tables in schema app from anon, authenticated, service_role;
alter default privileges in schema app revoke all on tables from anon, authenticated, service_role;
