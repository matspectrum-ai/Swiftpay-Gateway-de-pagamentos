-- SwiftPay V2 A8: dashboard API credential rotation/revocation and capabilities.

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
       or not (p_command ?& array['expectedRevision','secretVerifier'])
       or exists (
           select 1
             from pg_catalog.jsonb_object_keys(p_command) as k(key)
            where k.key <> all(array['expectedRevision','secretVerifier'])
       ) then
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
       or not (p_command ? 'expectedRevision')
       or exists (
           select 1
             from pg_catalog.jsonb_object_keys(p_command) as k(key)
            where k.key <> 'expectedRevision'
       ) then
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
