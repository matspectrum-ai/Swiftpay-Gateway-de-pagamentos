create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(42);

-- PostgreSQL 17 does not automatically make a CREATEROLE creator SET-capable
-- for newly created roles. This test-only membership is rolled back with the
-- surrounding transaction and lets us exercise the actual K6 capability role.
grant swiftpay_api to postgres with inherit false;

insert into app.merchants (id, name, lifecycle_status) values
    ('60000000-0000-0000-0000-000000000001'::uuid, 'A1 Active Merchant', 'active'),
    ('60000000-0000-0000-0000-000000000002'::uuid, 'A1 Suspended Merchant', 'suspended');

insert into app.api_credentials (
    id,
    merchant_id,
    environment,
    name,
    public_key,
    secret_verifier,
    secret_version,
    status,
    ip_allowlist,
    last_used_at
) values
    (
        '61000000-0000-0000-0000-000000000001'::uuid,
        '60000000-0000-0000-0000-000000000001'::uuid,
        'sandbox',
        'A1 Active Sandbox',
        'pk_a1_active_sandbox',
        'scrypt-v1$16384$8$1$fixture-salt$fixture-derived-key',
        3,
        'active',
        '["127.0.0.1"]'::jsonb,
        null
    ),
    (
        '61000000-0000-0000-0000-000000000002'::uuid,
        '60000000-0000-0000-0000-000000000001'::uuid,
        'production',
        'A1 Revoked Production',
        'pk_a1_revoked',
        'scrypt-v1$16384$8$1$revoked-salt$revoked-derived-key',
        1,
        'revoked',
        null,
        null
    ),
    (
        '61000000-0000-0000-0000-000000000003'::uuid,
        '60000000-0000-0000-0000-000000000002'::uuid,
        'production',
        'A1 Suspended Merchant Credential',
        'pk_a1_suspended_merchant',
        'scrypt-v1$16384$8$1$suspended-salt$suspended-derived-key',
        7,
        'active',
        '[]'::jsonb,
        null
    );

create temporary table a1_case_results (
    case_name text primary key,
    credential_id uuid,
    merchant_id uuid,
    environment text,
    credential_status text,
    secret_verifier text,
    secret_version integer,
    ip_allowlist jsonb,
    merchant_lifecycle_status text,
    allowed boolean,
    remaining integer,
    retry_after_seconds integer,
    error_state text,
    error_message text
);

create temporary table a1_snapshots (
    snapshot_name text primary key,
    timestamp_value timestamptz
);

create procedure pg_temp.a1_capture_lookup(p_case_name text, p_public_key text)
language plpgsql
security invoker
as $$
declare
    v_credential_id uuid;
    v_merchant_id uuid;
    v_environment text;
    v_credential_status text;
    v_secret_verifier text;
    v_secret_version integer;
    v_ip_allowlist jsonb;
    v_merchant_lifecycle_status text;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_api';
    begin
        select
            c.credential_id,
            c.merchant_id,
            c.environment,
            c.credential_status,
            c.secret_verifier,
            c.secret_version,
            c.ip_allowlist,
            c.merchant_lifecycle_status
        into
            v_credential_id,
            v_merchant_id,
            v_environment,
            v_credential_status,
            v_secret_verifier,
            v_secret_version,
            v_ip_allowlist,
            v_merchant_lifecycle_status
        from app.lookup_api_credential_for_token(p_public_key) c;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.a1_case_results (
        case_name,
        credential_id,
        merchant_id,
        environment,
        credential_status,
        secret_verifier,
        secret_version,
        ip_allowlist,
        merchant_lifecycle_status,
        error_state,
        error_message
    ) values (
        p_case_name,
        v_credential_id,
        v_merchant_id,
        v_environment,
        v_credential_status,
        v_secret_verifier,
        v_secret_version,
        v_ip_allowlist,
        v_merchant_lifecycle_status,
        v_error_state,
        v_error_message
    );
end;
$$;

create procedure pg_temp.a1_capture_quota(p_case_name text, p_credential_id uuid)
language plpgsql
security invoker
as $$
declare
    v_allowed boolean;
    v_remaining integer;
    v_retry_after_seconds integer;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_api';
    begin
        select q.allowed, q.remaining, q.retry_after_seconds
        into v_allowed, v_remaining, v_retry_after_seconds
        from app.consume_api_token_issuance(p_credential_id) q;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.a1_case_results (
        case_name,
        allowed,
        remaining,
        retry_after_seconds,
        error_state,
        error_message
    ) values (
        p_case_name,
        v_allowed,
        v_remaining,
        v_retry_after_seconds,
        v_error_state,
        v_error_message
    );
end;
$$;

create procedure pg_temp.a1_capture_auth_state(p_case_name text, p_credential_id uuid)
language plpgsql
security invoker
as $$
declare
    v_credential_id uuid;
    v_merchant_id uuid;
    v_environment text;
    v_credential_status text;
    v_secret_version integer;
    v_merchant_lifecycle_status text;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_api';
    begin
        select
            c.credential_id,
            c.merchant_id,
            c.environment,
            c.credential_status,
            c.secret_version,
            c.merchant_lifecycle_status
        into
            v_credential_id,
            v_merchant_id,
            v_environment,
            v_credential_status,
            v_secret_version,
            v_merchant_lifecycle_status
        from app.get_api_credential_auth_state(p_credential_id) c;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.a1_case_results (
        case_name,
        credential_id,
        merchant_id,
        environment,
        credential_status,
        secret_version,
        merchant_lifecycle_status,
        error_state,
        error_message
    ) values (
        p_case_name,
        v_credential_id,
        v_merchant_id,
        v_environment,
        v_credential_status,
        v_secret_version,
        v_merchant_lifecycle_status,
        v_error_state,
        v_error_message
    );
end;
$$;

create procedure pg_temp.a1_capture_sqlstate(p_case_name text, p_sql text)
language plpgsql
security invoker
as $$
declare
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_api';
    begin
        execute p_sql;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.a1_case_results (case_name, error_state, error_message)
    values (p_case_name, v_error_state, v_error_message);
end;
$$;

-- Lookup is a pure server-side projection. It may return the stored verifier to
-- the trusted API process, but it never receives or persists plaintext secret.
call pg_temp.a1_capture_lookup('lookup_active', 'pk_a1_active_sandbox');
select is((select error_state from a1_case_results where case_name = 'lookup_active'), null, 'A1 active credential lookup lives');
select is(
    (
        select credential_id::text || '|' || merchant_id::text || '|' || environment || '|' || credential_status || '|' || secret_version::text || '|' || merchant_lifecycle_status
        from a1_case_results where case_name = 'lookup_active'
    ),
    '61000000-0000-0000-0000-000000000001|60000000-0000-0000-0000-000000000001|sandbox|active|3|active',
    'A1 lookup returns exact credential merchant environment version and lifecycle state'
);
select is(
    (select secret_verifier from a1_case_results where case_name = 'lookup_active'),
    'scrypt-v1$16384$8$1$fixture-salt$fixture-derived-key',
    'A1 lookup returns the opaque verifier only to the trusted API routine caller'
);
select is(
    (select ip_allowlist::text from a1_case_results where case_name = 'lookup_active'),
    '["127.0.0.1"]',
    'A1 lookup returns exact stored IP policy'
);

call pg_temp.a1_capture_lookup('lookup_missing', 'pk_a1_missing');
select is((select error_state from a1_case_results where case_name = 'lookup_missing'), null, 'A1 unknown public key lookup does not raise');
select is((select credential_id from a1_case_results where case_name = 'lookup_missing'), null, 'A1 unknown public key returns no credential row');

call pg_temp.a1_capture_lookup('lookup_revoked', 'pk_a1_revoked');
select is((select error_state from a1_case_results where case_name = 'lookup_revoked'), null, 'A1 revoked credential lookup remains internally resolvable');
select is(
    (select credential_status || '|' || merchant_lifecycle_status from a1_case_results where case_name = 'lookup_revoked'),
    'revoked|active',
    'A1 lookup exposes revoked state for fail-closed application mapping'
);

call pg_temp.a1_capture_lookup('lookup_suspended_merchant', 'pk_a1_suspended_merchant');
select is(
    (select credential_status || '|' || merchant_lifecycle_status from a1_case_results where case_name = 'lookup_suspended_merchant'),
    'active|suspended',
    'A1 lookup exposes inactive merchant lifecycle separately from credential state'
);
select is((select count(*) from app.api_credential_token_windows), 0::bigint, 'A1 lookup creates no quota window state');
select is((select last_used_at from app.api_credentials where id = '61000000-0000-0000-0000-000000000001'), null, 'A1 lookup does not mutate last_used_at');

-- Successful issuance is a PostgreSQL-backed fixed one-hour window.
call pg_temp.a1_capture_quota('quota_1', '61000000-0000-0000-0000-000000000001');
select is((select error_state from a1_case_results where case_name = 'quota_1'), null, 'A1 first quota consumption lives');
select is((select allowed from a1_case_results where case_name = 'quota_1'), true, 'A1 first quota consumption is allowed');
select is(
    (select remaining::text || '|' || retry_after_seconds::text from a1_case_results where case_name = 'quota_1'),
    '9|0',
    'A1 first quota consumption reports nine remaining and zero retry delay'
);
select is((select issued_count from app.api_credential_token_windows where credential_id = '61000000-0000-0000-0000-000000000001'), 1, 'A1 first quota consumption persists count one');
select ok((select last_used_at is not null from app.api_credentials where id = '61000000-0000-0000-0000-000000000001'), 'A1 allowed quota consumption updates credential last_used_at');

call pg_temp.a1_capture_quota('quota_2', '61000000-0000-0000-0000-000000000001');
call pg_temp.a1_capture_quota('quota_3', '61000000-0000-0000-0000-000000000001');
call pg_temp.a1_capture_quota('quota_4', '61000000-0000-0000-0000-000000000001');
call pg_temp.a1_capture_quota('quota_5', '61000000-0000-0000-0000-000000000001');
call pg_temp.a1_capture_quota('quota_6', '61000000-0000-0000-0000-000000000001');
call pg_temp.a1_capture_quota('quota_7', '61000000-0000-0000-0000-000000000001');
call pg_temp.a1_capture_quota('quota_8', '61000000-0000-0000-0000-000000000001');
call pg_temp.a1_capture_quota('quota_9', '61000000-0000-0000-0000-000000000001');
call pg_temp.a1_capture_quota('quota_10', '61000000-0000-0000-0000-000000000001');
select ok(
    not exists (
        select 1 from a1_case_results
        where case_name in ('quota_2','quota_3','quota_4','quota_5','quota_6','quota_7','quota_8','quota_9','quota_10')
          and (error_state is not null or allowed is distinct from true)
    ),
    'A1 consumptions two through ten are all allowed without errors'
);
select is((select issued_count from app.api_credential_token_windows where credential_id = '61000000-0000-0000-0000-000000000001'), 10, 'A1 tenth successful consumption persists count ten');
select is((select remaining from a1_case_results where case_name = 'quota_10'), 0, 'A1 tenth successful consumption reports zero remaining');

insert into a1_snapshots (snapshot_name, timestamp_value)
select 'after_quota_10', last_used_at
from app.api_credentials
where id = '61000000-0000-0000-0000-000000000001';

call pg_temp.a1_capture_quota('quota_11', '61000000-0000-0000-0000-000000000001');
select is((select error_state from a1_case_results where case_name = 'quota_11'), null, 'A1 denied eleventh quota request is a normal result');
select is((select allowed from a1_case_results where case_name = 'quota_11'), false, 'A1 eleventh quota request is denied');
select is((select remaining from a1_case_results where case_name = 'quota_11'), 0, 'A1 denied quota request reports zero remaining');
select ok((select retry_after_seconds between 1 and 3600 from a1_case_results where case_name = 'quota_11'), 'A1 denied quota request reports bounded positive retry delay');
select is((select issued_count from app.api_credential_token_windows where credential_id = '61000000-0000-0000-0000-000000000001'), 10, 'A1 denied quota request does not increment persisted count');
select is(
    (select last_used_at from app.api_credentials where id = '61000000-0000-0000-0000-000000000001'),
    (select timestamp_value from a1_snapshots where snapshot_name = 'after_quota_10'),
    'A1 denied quota request does not update last_used_at'
);

-- Expired fixed window resets atomically on the next successful consumption.
update app.api_credential_token_windows
set window_started_at = clock_timestamp() - interval '3601 seconds',
    issued_count = 10,
    updated_at = clock_timestamp() - interval '3601 seconds'
where credential_id = '61000000-0000-0000-0000-000000000001';
update app.api_credentials
set last_used_at = null
where id = '61000000-0000-0000-0000-000000000001';

call pg_temp.a1_capture_quota('quota_reset', '61000000-0000-0000-0000-000000000001');
select is((select allowed from a1_case_results where case_name = 'quota_reset'), true, 'A1 expired window resets and allows a new issuance');
select is(
    (select remaining::text || '|' || retry_after_seconds::text from a1_case_results where case_name = 'quota_reset'),
    '9|0',
    'A1 reset window reports canonical remaining and retry values'
);
select is((select issued_count from app.api_credential_token_windows where credential_id = '61000000-0000-0000-0000-000000000001'), 1, 'A1 reset window persists count one');
select ok(
    (select window_started_at >= clock_timestamp() - interval '10 seconds' from app.api_credential_token_windows where credential_id = '61000000-0000-0000-0000-000000000001'),
    'A1 reset window receives a current start timestamp'
);
select ok((select last_used_at is not null from app.api_credentials where id = '61000000-0000-0000-0000-000000000001'), 'A1 reset-window success updates last_used_at');

-- Bearer revalidation projection reflects current canonical DB state.
call pg_temp.a1_capture_auth_state('state_active', '61000000-0000-0000-0000-000000000001');
select is((select error_state from a1_case_results where case_name = 'state_active'), null, 'A1 active bearer state lookup lives');
select is(
    (
        select credential_id::text || '|' || merchant_id::text || '|' || environment || '|' || credential_status || '|' || secret_version::text || '|' || merchant_lifecycle_status
        from a1_case_results where case_name = 'state_active'
    ),
    '61000000-0000-0000-0000-000000000001|60000000-0000-0000-0000-000000000001|sandbox|active|3|active',
    'A1 bearer state returns exact current credential identity version and merchant lifecycle'
);

call pg_temp.a1_capture_auth_state('state_missing', '61000000-0000-0000-0000-000000000099');
select is((select error_state from a1_case_results where case_name = 'state_missing'), null, 'A1 missing bearer credential lookup does not raise');
select is((select credential_id from a1_case_results where case_name = 'state_missing'), null, 'A1 missing bearer credential returns no row');

call pg_temp.a1_capture_auth_state('state_revoked', '61000000-0000-0000-0000-000000000002');
select is((select credential_status from a1_case_results where case_name = 'state_revoked'), 'revoked', 'A1 bearer state exposes immediate credential revocation');

call pg_temp.a1_capture_auth_state('state_suspended_merchant', '61000000-0000-0000-0000-000000000003');
select is((select merchant_lifecycle_status from a1_case_results where case_name = 'state_suspended_merchant'), 'suspended', 'A1 bearer state exposes immediate merchant suspension');

call pg_temp.a1_capture_sqlstate('api_direct_credentials', $$select count(*) from app.api_credentials$$);
select is((select error_state from a1_case_results where case_name = 'api_direct_credentials'), '42501', 'A1 trusted API still cannot read credential table directly');

-- Authentication primitives never create financial or asynchronous domain state.
select is((select count(*) from app.payments), 0::bigint, 'A1 auth behavior creates no Payment state');
select is((select count(*) from app.ledger_transactions), 0::bigint, 'A1 auth behavior creates no ledger state');
select is((select count(*) from app.jobs), 0::bigint, 'A1 auth behavior creates no job state');
select is((select count(*) from app.webhook_events), 0::bigint, 'A1 auth behavior creates no merchant webhook state');
select is((select count(*) from app.audit_events), 0::bigint, 'A1 auth behavior creates no operational audit event state');

select * from finish();
rollback;
