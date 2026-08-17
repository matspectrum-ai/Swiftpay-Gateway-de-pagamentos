-- SwiftPay V2 A8: trusted dashboard API credential management.
-- Plaintext machine secrets never enter PostgreSQL. The trusted API supplies
-- only public key material and the frozen A1 scrypt-v1 verifier.

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

revoke all on function app._a8_api_credential_json(uuid)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

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
       or pg_catalog.position('scrypt-v1' in p_response::text) > 0
       or pg_catalog.position('sk_sandbox_' in p_response::text) > 0
       or pg_catalog.position('sk_production_' in p_response::text) > 0 then
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

revoke all on function app._a8_begin_api_credential_command(uuid, text, text, text, text)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;
revoke all on function app._a8_complete_api_credential_command(uuid, uuid, jsonb)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

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
       or pg_catalog.jsonb_object_length(p_command) <> 5
       or not (p_command ?& array['credentialId','name','publicKey','secretVerifier','ipAllowlist']) then
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
                   or pg_catalog.position('/' in v_ip_text) > 0
                   or pg_catalog.position('*' in v_ip_text) > 0
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

create or replace function app.rotate_dashboard_api_credential_secret(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_credential_id uuid,
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
    v_credential app.api_credentials%rowtype;
    v_expected_revision bigint;
    v_secret_verifier text;
    v_result jsonb;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    v_required_role := case when p_environment = 'production' then 'owner' else 'admin' end;
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, v_required_role);

    if p_command is null
       or pg_catalog.jsonb_typeof(p_command) <> 'object'
       or pg_catalog.jsonb_object_length(p_command) <> 2
       or not (p_command ?& array['expectedRevision','secretVerifier']) then
        raise exception using errcode = '22023', message = 'invalid A8 rotate command';
    end if;
    begin
        v_expected_revision := (p_command ->> 'expectedRevision')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'invalid A8 expected revision';
    end;
    v_secret_verifier := p_command ->> 'secretVerifier';
    if v_expected_revision < 1
       or v_secret_verifier is null
       or v_secret_verifier !~ '^scrypt-v1\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$' then
        raise exception using errcode = '22023', message = 'invalid A8 rotate data';
    end if;

    v_gate := app._a8_begin_api_credential_command(
        p_merchant_id, p_environment, 'dashboard_api_credential_rotate_secret_v0',
        p_idempotency_key, p_request_hash
    );
    if v_gate ->> 'kind' = 'conflict' then return pg_catalog.jsonb_build_object('kind','idempotency_conflict'); end if;
    if v_gate ->> 'kind' = 'in_progress' then return pg_catalog.jsonb_build_object('kind','idempotency_in_progress'); end if;
    if v_gate ->> 'kind' = 'completed' then
        return pg_catalog.jsonb_build_object('kind','ok','replayed',true,'credential',v_gate -> 'response');
    end if;
    v_idempotency_id := (v_gate ->> 'id')::uuid;

    select * into v_credential
      from app.api_credentials c
     where c.id = p_credential_id
       and c.merchant_id = p_merchant_id
       and c.environment = p_environment
     for update;
    if not found then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind','resource_not_found');
    end if;
    if v_credential.status <> 'active' or v_credential.revision <> v_expected_revision then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind','resource_conflict');
    end if;
    if v_credential.secret_version >= 2147483647 or v_credential.revision >= 9223372036854775807 then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind','validation_error');
    end if;

    update app.api_credentials
       set secret_verifier = v_secret_verifier,
           secret_version = secret_version + 1,
           revision = revision + 1,
           rotated_at = v_now
     where id = p_credential_id;

    v_result := app._a8_api_credential_json(p_credential_id);
    perform app.record_audit_event(
        'application_command', 'a8:' || v_idempotency_id::text, p_request_hash, 1,
        'user', p_user_id::text, p_merchant_id, p_environment,
        'api_credential.rotated', 'api_credential', p_credential_id::text,
        null, null, null, null,
        pg_catalog.jsonb_build_object(
            'revisionBefore', v_credential.revision,
            'revisionAfter', v_credential.revision + 1,
            'secretVersionBefore', v_credential.secret_version,
            'secretVersionAfter', v_credential.secret_version + 1
        ),
        v_now
    );
    perform app._a8_complete_api_credential_command(v_idempotency_id, p_credential_id, v_result);
    return pg_catalog.jsonb_build_object('kind','ok','replayed',false,'credential',v_result);
end;
$$;

create or replace function app.revoke_dashboard_api_credential(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_credential_id uuid,
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
    v_credential app.api_credentials%rowtype;
    v_expected_revision bigint;
    v_result jsonb;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    v_required_role := case when p_environment = 'production' then 'owner' else 'admin' end;
    perform app.require_dashboard_merchant_context(p_user_id, p_merchant_id, p_environment, v_required_role);

    if p_command is null
       or pg_catalog.jsonb_typeof(p_command) <> 'object'
       or pg_catalog.jsonb_object_length(p_command) <> 1
       or not (p_command ? 'expectedRevision') then
        raise exception using errcode = '22023', message = 'invalid A8 revoke command';
    end if;
    begin
        v_expected_revision := (p_command ->> 'expectedRevision')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'invalid A8 expected revision';
    end;
    if v_expected_revision < 1 then
        raise exception using errcode = '22023', message = 'invalid A8 revoke data';
    end if;

    v_gate := app._a8_begin_api_credential_command(
        p_merchant_id, p_environment, 'dashboard_api_credential_revoke_v0',
        p_idempotency_key, p_request_hash
    );
    if v_gate ->> 'kind' = 'conflict' then return pg_catalog.jsonb_build_object('kind','idempotency_conflict'); end if;
    if v_gate ->> 'kind' = 'in_progress' then return pg_catalog.jsonb_build_object('kind','idempotency_in_progress'); end if;
    if v_gate ->> 'kind' = 'completed' then
        return pg_catalog.jsonb_build_object('kind','ok','replayed',true,'credential',v_gate -> 'response');
    end if;
    v_idempotency_id := (v_gate ->> 'id')::uuid;

    select * into v_credential
      from app.api_credentials c
     where c.id = p_credential_id
       and c.merchant_id = p_merchant_id
       and c.environment = p_environment
     for update;
    if not found then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind','resource_not_found');
    end if;
    if v_credential.status <> 'active' or v_credential.revision <> v_expected_revision then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind','resource_conflict');
    end if;
    if v_credential.revision >= 9223372036854775807 then
        delete from app.request_idempotency where id = v_idempotency_id;
        return pg_catalog.jsonb_build_object('kind','validation_error');
    end if;

    update app.api_credentials
       set status = 'revoked',
           revision = revision + 1,
           revoked_at = v_now
     where id = p_credential_id;

    v_result := app._a8_api_credential_json(p_credential_id);
    perform app.record_audit_event(
        'application_command', 'a8:' || v_idempotency_id::text, p_request_hash, 1,
        'user', p_user_id::text, p_merchant_id, p_environment,
        'api_credential.revoked', 'api_credential', p_credential_id::text,
        null, null, null, null,
        pg_catalog.jsonb_build_object(
            'revisionBefore', v_credential.revision,
            'revisionAfter', v_credential.revision + 1,
            'secretVersion', v_credential.secret_version
        ),
        v_now
    );
    perform app._a8_complete_api_credential_command(v_idempotency_id, p_credential_id, v_result);
    return pg_catalog.jsonb_build_object('kind','ok','replayed',false,'credential',v_result);
end;
$$;

revoke all on function app.list_dashboard_api_credentials(uuid, uuid, text)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.get_dashboard_api_credential(uuid, uuid, text, uuid)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.create_dashboard_api_credential(uuid, uuid, text, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.rotate_dashboard_api_credential_secret(uuid, uuid, text, uuid, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;
revoke all on function app.revoke_dashboard_api_credential(uuid, uuid, text, uuid, text, text, jsonb)
    from public, anon, authenticated, service_role, swiftpay_worker;

grant execute on function app.list_dashboard_api_credentials(uuid, uuid, text) to swiftpay_api;
grant execute on function app.get_dashboard_api_credential(uuid, uuid, text, uuid) to swiftpay_api;
grant execute on function app.create_dashboard_api_credential(uuid, uuid, text, text, text, jsonb) to swiftpay_api;
grant execute on function app.rotate_dashboard_api_credential_secret(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
grant execute on function app.revoke_dashboard_api_credential(uuid, uuid, text, uuid, text, text, jsonb) to swiftpay_api;
