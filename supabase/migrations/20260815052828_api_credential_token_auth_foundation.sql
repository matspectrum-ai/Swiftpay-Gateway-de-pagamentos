-- SwiftPay V2 Phase 3 / A1: API credential token-auth structural foundation.
--
-- This migration intentionally establishes only the private persistence shape,
-- routine signatures and least-privilege ACLs. Runtime behavior remains
-- fail-closed (SQLSTATE 0A000) so the next slice can establish a behavioral RED.

create table app.api_credential_token_windows (
    credential_id uuid primary key
        references app.api_credentials(id) on delete cascade,
    window_started_at timestamptz not null,
    issued_count integer not null default 0,
    updated_at timestamptz not null,
    constraint api_credential_token_windows_issued_count_nonnegative_ck
        check (issued_count >= 0)
);

-- API/worker capability roles retain routine-only access. The token-window
-- persistence is private even from the trusted runtimes.
revoke all privileges on table app.api_credential_token_windows
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

create function app.lookup_api_credential_for_token(p_public_key text)
returns table (
    credential_id uuid,
    merchant_id uuid,
    environment text,
    credential_status text,
    secret_verifier text,
    secret_version integer,
    ip_allowlist jsonb,
    merchant_lifecycle_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    raise exception 'A1 credential token lookup behavior not implemented'
        using errcode = '0A000';
end;
$$;

create function app.consume_api_token_issuance(p_credential_id uuid)
returns table (
    allowed boolean,
    remaining integer,
    retry_after_seconds integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    raise exception 'A1 credential token issuance behavior not implemented'
        using errcode = '0A000';
end;
$$;

create function app.get_api_credential_auth_state(p_credential_id uuid)
returns table (
    credential_id uuid,
    merchant_id uuid,
    environment text,
    credential_status text,
    secret_version integer,
    merchant_lifecycle_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    raise exception 'A1 bearer credential state behavior not implemented'
        using errcode = '0A000';
end;
$$;

-- Functions are executable only through the trusted API capability role.
revoke all on function app.lookup_api_credential_for_token(text)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
revoke all on function app.consume_api_token_issuance(uuid)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
revoke all on function app.get_api_credential_auth_state(uuid)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

grant execute on function app.lookup_api_credential_for_token(text)
    to swiftpay_api;
grant execute on function app.consume_api_token_issuance(uuid)
    to swiftpay_api;
grant execute on function app.get_api_credential_auth_state(uuid)
    to swiftpay_api;
