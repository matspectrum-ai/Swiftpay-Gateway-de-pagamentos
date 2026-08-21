-- SwiftPay V2 Phase 3 / A1: API credential token-auth behavior.
--
-- Implements only the frozen trusted API database capabilities. Plaintext
-- secrets and JWT signing material never enter PostgreSQL.

create or replace function app.lookup_api_credential_for_token(p_public_key text)
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
    return query
    select
        c.id,
        c.merchant_id,
        c.environment,
        c.status,
        c.secret_verifier,
        c.secret_version,
        c.ip_allowlist,
        m.lifecycle_status
    from app.api_credentials as c
    join app.merchants as m on m.id = c.merchant_id
    where c.public_key = p_public_key;
end;
$$;

create or replace function app.consume_api_token_issuance(p_credential_id uuid)
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
declare
    v_now timestamptz := pg_catalog.clock_timestamp();
    v_window_started_at timestamptz;
    v_issued_count integer;
    v_retry_after_seconds integer;
begin
    -- Materialize one row per credential. The FK proves the credential exists;
    -- ON CONFLICT serializes concurrent first-use attempts on the same key.
    insert into app.api_credential_token_windows (
        credential_id,
        window_started_at,
        issued_count,
        updated_at
    ) values (
        p_credential_id,
        v_now,
        0,
        v_now
    )
    on conflict (credential_id) do nothing;

    -- The row lock is the distributed concurrency boundary for all API
    -- instances consuming the same credential quota.
    select w.window_started_at, w.issued_count
      into v_window_started_at, v_issued_count
      from app.api_credential_token_windows as w
     where w.credential_id = p_credential_id
     for update;

    if v_now >= v_window_started_at + interval '3600 seconds' then
        update app.api_credential_token_windows as w
           set window_started_at = v_now,
               issued_count = 1,
               updated_at = v_now
         where w.credential_id = p_credential_id;

        update app.api_credentials as c
           set last_used_at = v_now
         where c.id = p_credential_id;

        return query select true, 9, 0;
        return;
    end if;

    if v_issued_count < 10 then
        v_issued_count := v_issued_count + 1;

        update app.api_credential_token_windows as w
           set issued_count = v_issued_count,
               updated_at = v_now
         where w.credential_id = p_credential_id;

        update app.api_credentials as c
           set last_used_at = v_now
         where c.id = p_credential_id;

        return query select true, 10 - v_issued_count, 0;
        return;
    end if;

    v_retry_after_seconds := pg_catalog.ceil(
        pg_catalog.date_part(
            'epoch',
            (v_window_started_at + interval '3600 seconds') - v_now
        )
    )::integer;

    if v_retry_after_seconds < 1 then
        v_retry_after_seconds := 1;
    elsif v_retry_after_seconds > 3600 then
        v_retry_after_seconds := 3600;
    end if;

    -- A denied request does not mutate the window or credential last_used_at.
    return query select false, 0, v_retry_after_seconds;
end;
$$;

create or replace function app.get_api_credential_auth_state(p_credential_id uuid)
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
    return query
    select
        c.id,
        c.merchant_id,
        c.environment,
        c.status,
        c.secret_version,
        m.lifecycle_status
    from app.api_credentials as c
    join app.merchants as m on m.id = c.merchant_id
    where c.id = p_credential_id;
end;
$$;

-- CREATE OR REPLACE normally preserves ACLs, but repeat the frozen allowlist so
-- this migration remains explicit and auditable if ownership/defaults change.
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
