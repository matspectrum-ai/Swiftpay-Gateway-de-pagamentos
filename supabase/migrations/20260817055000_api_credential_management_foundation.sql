-- SwiftPay V2 A8: trusted dashboard API credential management foundation.
-- Plaintext machine secrets never enter PostgreSQL.

alter table app.api_credentials
    add column revision bigint not null default 1;

alter table app.api_credentials
    add constraint api_credentials_revision_positive_ck check (revision > 0);

create or replace function app._a8_api_credential_json(p_credential_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select pg_catalog.jsonb_build_object(
        'id', c.id::text,
        'merchantId', c.merchant_id::text,
        'environment', c.environment,
        'name', c.name,
        'publicKey', c.public_key,
        'status', c.status,
        'secretVersion', c.secret_version,
        'revision', c.revision,
        'ipAllowlist', c.ip_allowlist,
        'lastUsedAt', case when c.last_used_at is null then null else pg_catalog.to_char(c.last_used_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'createdAt', pg_catalog.to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'rotatedAt', case when c.rotated_at is null then null else pg_catalog.to_char(c.rotated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'revokedAt', case when c.revoked_at is null then null else pg_catalog.to_char(c.revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
    )
    from app.api_credentials c
    where c.id = p_credential_id
$$;

create or replace function app._a8_begin_api_credential_command(
    p_merchant_id uuid,
    p_environment text,
    p_operation text,
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
    v_new_id uuid;
    v_existing app.request_idempotency%rowtype;
begin
    if p_merchant_id is null
       or p_environment not in ('sandbox', 'production')
       or p_operation not in (
           'dashboard_api_credential_create_v0',
           'dashboard_api_credential_rotate_secret_v0',
           'dashboard_api_credential_revoke_v0'
       )
       or p_idempotency_key is null
       or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) < 1
       or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) > 160
       or p_request_hash is null
       or p_request_hash !~ '^[0-9a-f]{64}$' then
        raise exception using errcode = '22023', message = 'invalid A8 idempotency input';
    end if;

    insert into app.request_idempotency (
        merchant_id, environment, operation, idempotency_key, request_hash, state
    ) values (
        p_merchant_id, p_environment, p_operation,
        pg_catalog.btrim(p_idempotency_key), p_request_hash, 'in_progress'
    )
    on conflict (merchant_id, environment, operation, idempotency_key) do nothing
    returning id into v_new_id;

    if v_new_id is not null then
        return pg_catalog.jsonb_build_object('kind', 'winning', 'id', v_new_id::text);
    end if;

    select * into v_existing
      from app.request_idempotency r
     where r.merchant_id = p_merchant_id
       and r.environment = p_environment
       and r.operation = p_operation
       and r.idempotency_key = pg_catalog.btrim(p_idempotency_key)
     for update;

    if not found then
        raise exception using errcode = '55000', message = 'A8 idempotency row disappeared';
    end if;
    if v_existing.request_hash is distinct from p_request_hash then
        return pg_catalog.jsonb_build_object('kind', 'conflict');
    end if;
    if v_existing.state = 'completed' and v_existing.response_snapshot is not null then
        return pg_catalog.jsonb_build_object(
            'kind', 'completed',
            'id', v_existing.id::text,
            'response', v_existing.response_snapshot
        );
    end if;
    return pg_catalog.jsonb_build_object('kind', 'in_progress', 'id', v_existing.id::text);
end;
$$;

create or replace function app._a8_complete_api_credential_command(
    p_idempotency_id uuid,
    p_credential_id uuid,
    p_response jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if p_response is null
       or pg_catalog.jsonb_typeof(p_response) <> 'object'
       or p_response ? 'secretKey'
       or p_response ? 'secretVerifier'
       or pg_catalog.strpos(p_response::text, 'scrypt-v1') > 0
       or pg_catalog.strpos(p_response::text, 'sk_sandbox_') > 0
       or pg_catalog.strpos(p_response::text, 'sk_production_') > 0 then
        raise exception using errcode = '22023', message = 'invalid A8 idempotency response snapshot';
    end if;

    update app.request_idempotency
       set state = 'completed',
           resource_type = 'api_credential',
           resource_id = p_credential_id,
           http_status_snapshot = 200,
           response_snapshot = p_response,
           completed_at = pg_catalog.clock_timestamp()
     where id = p_idempotency_id
       and state = 'in_progress';

    if not found then
        raise exception using errcode = '55000', message = 'A8 idempotency completion failed';
    end if;
end;
$$;

create or replace function app.list_dashboard_api_credentials(
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
    select app._a8_api_credential_json(c.id)
      from app.api_credentials c
     where c.merchant_id = p_merchant_id
       and c.environment = p_environment
     order by c.created_at desc, c.id desc;
end;
$$;

create or replace function app.get_dashboard_api_credential(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_credential_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_result jsonb;
begin
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, 'member');
    select app._a8_api_credential_json(c.id) into v_result
      from app.api_credentials c
     where c.id = p_credential_id
       and c.merchant_id = p_merchant_id
       and c.environment = p_environment;
    return v_result;
end;
$$;

revoke all on function app._a8_api_credential_json(uuid)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
revoke all on function app._a8_begin_api_credential_command(uuid, text, text, text, text)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
revoke all on function app._a8_complete_api_credential_command(uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
