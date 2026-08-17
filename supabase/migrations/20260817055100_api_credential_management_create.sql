-- SwiftPay V2 A8: dashboard API credential creation.

create or replace function app.create_dashboard_api_credential(
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
    v_required_role text;
    v_gate jsonb;
    v_idempotency_id uuid;
    v_credential_id uuid;
    v_name text;
    v_public_key text;
    v_secret_verifier text;
    v_ip_allowlist jsonb;
    v_ip_item jsonb;
    v_ip_text text;
    v_seen_ips text[] := array[]::text[];
    v_active_count bigint;
    v_result jsonb;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    v_required_role := case when p_environment = 'production' then 'owner' else 'admin' end;
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, v_required_role);

    if p_command is null
       or pg_catalog.jsonb_typeof(p_command) <> 'object'
       or not (p_command ?& array['credentialId','name','publicKey','secretVerifier','ipAllowlist'])
       or exists (
           select 1
             from pg_catalog.jsonb_object_keys(p_command) as k(key)
            where k.key <> all(array['credentialId','name','publicKey','secretVerifier','ipAllowlist'])
       ) then
        raise exception using errcode = '22023', message = 'invalid A8 create command';
    end if;

    begin
        v_credential_id := (p_command ->> 'credentialId')::uuid;
    exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'invalid A8 credential id';
    end;

    v_name := pg_catalog.btrim(p_command ->> 'name');
    v_public_key := p_command ->> 'publicKey';
    v_secret_verifier := p_command ->> 'secretVerifier';
    v_ip_allowlist := p_command -> 'ipAllowlist';

    if v_name is null or pg_catalog.length(v_name) < 1 or pg_catalog.length(v_name) > 120
       or v_public_key is null
       or (p_environment = 'sandbox' and v_public_key !~ '^pk_sandbox_[A-Za-z0-9_-]{24}$')
       or (p_environment = 'production' and v_public_key !~ '^pk_production_[A-Za-z0-9_-]{24}$')
       or v_secret_verifier is null
       or v_secret_verifier !~ '^scrypt-v1\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$' then
        raise exception using errcode = '22023', message = 'invalid A8 credential create data';
    end if;

    if v_ip_allowlist is not null and v_ip_allowlist <> 'null'::jsonb then
        if pg_catalog.jsonb_typeof(v_ip_allowlist) <> 'array'
           or pg_catalog.jsonb_array_length(v_ip_allowlist) > 32 then
            raise exception using errcode = '22023', message = 'invalid A8 IP allowlist';
        end if;
        if pg_catalog.jsonb_array_length(v_ip_allowlist) = 0 then
            v_ip_allowlist := null;
        else
            for v_ip_item in select value from pg_catalog.jsonb_array_elements(v_ip_allowlist)
            loop
                if pg_catalog.jsonb_typeof(v_ip_item) <> 'string' then
                    raise exception using errcode = '22023', message = 'invalid A8 IP allowlist';
                end if;
                v_ip_text := v_ip_item #>> '{}';
                if v_ip_text is null
                   or pg_catalog.btrim(v_ip_text) <> v_ip_text
                   or pg_catalog.strpos(v_ip_text, '/') > 0
                   or pg_catalog.strpos(v_ip_text, '*') > 0
                   or v_ip_text = any(v_seen_ips) then
                    raise exception using errcode = '22023', message = 'invalid A8 IP allowlist';
                end if;
                begin
                    if pg_catalog.host(v_ip_text::pg_catalog.inet) <> v_ip_text then
                        raise exception using errcode = '22023', message = 'noncanonical A8 IP allowlist';
                    end if;
                exception when invalid_text_representation then
                    raise exception using errcode = '22023', message = 'invalid A8 IP allowlist';
                end;
                v_seen_ips := pg_catalog.array_append(v_seen_ips, v_ip_text);
            end loop;
        end if;
    else
        v_ip_allowlist := null;
    end if;

    v_gate := app._a8_begin_api_credential_command(
        p_merchant_id, p_environment, 'dashboard_api_credential_create_v0',
        p_idempotency_key, p_request_hash
    );
    if v_gate ->> 'kind' = 'conflict' then
        return pg_catalog.jsonb_build_object('kind', 'idempotency_conflict');
    elsif v_gate ->> 'kind' = 'in_progress' then
        return pg_catalog.jsonb_build_object('kind', 'idempotency_in_progress');
    elsif v_gate ->> 'kind' = 'completed' then
        return pg_catalog.jsonb_build_object(
            'kind', 'created', 'replayed', true, 'credential', v_gate -> 'response'
        );
    end if;
    v_idempotency_id := (v_gate ->> 'id')::uuid;

    perform 1 from app.merchants where id = p_merchant_id for update;
    select pg_catalog.count(*) into v_active_count
      from app.api_credentials c
     where c.merchant_id = p_merchant_id
       and c.environment = p_environment
       and c.status = 'active';
    if v_active_count >= 10 then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind', 'credential_limit_reached');
    end if;

    insert into app.api_credentials (
        id, merchant_id, environment, name, public_key, secret_verifier,
        secret_version, revision, status, ip_allowlist, created_at
    ) values (
        v_credential_id, p_merchant_id, p_environment, v_name, v_public_key,
        v_secret_verifier, 1, 1, 'active', v_ip_allowlist, v_now
    );

    v_result := app._a8_api_credential_json(v_credential_id);
    perform app.record_audit_event(
        'application_command', 'a8:' || v_idempotency_id::text, p_request_hash, 1,
        'user', p_user_id::text, p_merchant_id, p_environment,
        'api_credential.created', 'api_credential', v_credential_id::text,
        null, null, null, null,
        pg_catalog.jsonb_build_object(
            'revisionAfter', 1,
            'secretVersionAfter', 1,
            'ipAllowlistCount', pg_catalog.coalesce(pg_catalog.jsonb_array_length(v_ip_allowlist), 0)
        ),
        v_now
    );
    perform app._a8_complete_api_credential_command(v_idempotency_id, v_credential_id, v_result);
    return pg_catalog.jsonb_build_object('kind', 'created', 'replayed', false, 'credential', v_result);
end;
$$;

revoke all on function app.create_dashboard_api_credential(uuid, uuid, text, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
