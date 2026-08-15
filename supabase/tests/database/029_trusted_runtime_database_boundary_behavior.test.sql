create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(35);

-- Test harness only: PostgreSQL 17 gives a non-superuser CREATEROLE creator
-- ADMIN but SET FALSE on newly created roles. Granting membership here enables
-- real SET ROLE probes; the enclosing transaction rolls this membership back.
grant swiftpay_api, swiftpay_worker to postgres with inherit false;

-- Canonical fixtures for the trusted API context boundary.
insert into app.merchants (id, name, lifecycle_status) values
    ('30000000-0000-0000-0000-000000000001'::uuid, 'K4 Active Merchant', 'active'),
    ('30000000-0000-0000-0000-000000000002'::uuid, 'K4 Suspended Merchant', 'suspended');

insert into auth.users (
    id, aud, role, email, raw_user_meta_data, raw_app_meta_data,
    is_anonymous, deleted_at, created_at, updated_at
) values
    ('31000000-0000-0000-0000-000000000001'::uuid, 'authenticated', 'authenticated', 'k4-admin@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
    ('31000000-0000-0000-0000-000000000002'::uuid, 'authenticated', 'authenticated', 'k4-owner@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now()),
    ('31000000-0000-0000-0000-000000000003'::uuid, 'authenticated', 'authenticated', 'k4-disabled@example.test', '{}'::jsonb, '{}'::jsonb, false, null, now(), now());

insert into app.merchant_members (merchant_id, user_id, role, status) values
    ('30000000-0000-0000-0000-000000000001'::uuid, '31000000-0000-0000-0000-000000000001'::uuid, 'admin', 'active'),
    ('30000000-0000-0000-0000-000000000002'::uuid, '31000000-0000-0000-0000-000000000002'::uuid, 'owner', 'active'),
    ('30000000-0000-0000-0000-000000000001'::uuid, '31000000-0000-0000-0000-000000000003'::uuid, 'admin', 'disabled');

create temporary table k4_case_results (
    case_name text primary key,
    merchant_id uuid,
    environment text,
    membership_role text,
    boolean_result boolean,
    job_id uuid,
    lease_token uuid,
    job_state text,
    error_state text,
    error_message text
);

-- Execute the positive/error context matrix under the actual swiftpay_api role,
-- but reset to postgres before persisting test observations. This avoids giving
-- the capability role any test-only table or pgTAP privileges.
create procedure pg_temp.k4_capture_context(
    p_case_name text,
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_required_role text,
    p_spoof_merchant text default null,
    p_spoof_environment text default null
)
language plpgsql
security invoker
as $$
declare
    v_merchant_id uuid;
    v_environment text;
    v_membership_role text;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_api';

    if p_spoof_merchant is not null then
        perform pg_catalog.set_config('app.merchant_id', p_spoof_merchant, true);
    end if;
    if p_spoof_environment is not null then
        perform pg_catalog.set_config('app.environment', p_spoof_environment, true);
    end if;

    begin
        select c.merchant_id, c.environment, c.membership_role
        into v_merchant_id, v_environment, v_membership_role
        from app.require_dashboard_merchant_context(
            p_user_id,
            p_merchant_id,
            p_environment,
            p_required_role
        ) c;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;

    execute 'reset role';

    insert into pg_temp.k4_case_results (
        case_name, merchant_id, environment, membership_role, error_state, error_message
    ) values (
        p_case_name, v_merchant_id, v_environment, v_membership_role, v_error_state, v_error_message
    );
end;
$$;

-- Generic actual-permission probe under a frozen runtime role.
create procedure pg_temp.k4_capture_sqlstate(
    p_case_name text,
    p_role_name text,
    p_sql text
)
language plpgsql
security invoker
as $$
declare
    v_error_state text;
    v_error_message text;
begin
    execute pg_catalog.format('set local role %I', p_role_name);
    begin
        execute p_sql;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.k4_case_results (case_name, error_state, error_message)
    values (p_case_name, v_error_state, v_error_message);
end;
$$;

call pg_temp.k4_capture_context(
    'valid_sandbox',
    '31000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'sandbox',
    'member'
);
select is((select error_state from k4_case_results where case_name = 'valid_sandbox'), null, 'trusted API valid sandbox context does not fail');
select is(
    (select merchant_id::text || '|' || environment || '|' || membership_role from k4_case_results where case_name = 'valid_sandbox'),
    '30000000-0000-0000-0000-000000000001|sandbox|admin',
    'trusted API context returns exact merchant environment and actual membership role'
);

call pg_temp.k4_capture_context(
    'suspended_production',
    '31000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000002',
    'production',
    'owner'
);
select is((select error_state from k4_case_results where case_name = 'suspended_production'), null, 'dashboard membership context remains independent of merchant lifecycle');
select is(
    (select merchant_id::text || '|' || environment || '|' || membership_role from k4_case_results where case_name = 'suspended_production'),
    '30000000-0000-0000-0000-000000000002|production|owner',
    'trusted API resolves production context for suspended merchant owner'
);

call pg_temp.k4_capture_context('invalid_environment', '31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'staging', 'member');
select is((select error_state from k4_case_results where case_name = 'invalid_environment'), '23514', 'unknown environment is rejected as invalid request');

call pg_temp.k4_capture_context('null_environment', '31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', null, 'member');
select is((select error_state from k4_case_results where case_name = 'null_environment'), '23514', 'null environment is rejected as invalid request');

call pg_temp.k4_capture_context('cross_merchant', '31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'sandbox', 'member');
select is((select error_state from k4_case_results where case_name = 'cross_merchant'), '42501', 'trusted API cannot cross canonical merchant membership boundary');

call pg_temp.k4_capture_context('disabled_membership', '31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'sandbox', 'member');
select is((select error_state from k4_case_results where case_name = 'disabled_membership'), '42501', 'trusted API sees immediate disabled membership denial');

call pg_temp.k4_capture_context('insufficient_role', '31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'sandbox', 'owner');
select is((select error_state from k4_case_results where case_name = 'insufficient_role'), '42501', 'trusted API cannot elevate membership role through required_role input');

-- Arbitrary custom GUCs are observational only and cannot rewrite authorization.
call pg_temp.k4_capture_context(
    'guc_valid_ignored',
    '31000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'sandbox',
    'member',
    '30000000-0000-0000-0000-000000000002',
    'production'
);
select is((select error_state from k4_case_results where case_name = 'guc_valid_ignored'), null, 'spoof GUC values do not break valid canonical context');
select is(
    (select merchant_id::text || '|' || environment || '|' || membership_role from k4_case_results where case_name = 'guc_valid_ignored'),
    '30000000-0000-0000-0000-000000000001|sandbox|admin',
    'context helper ignores spoof merchant and environment GUC values'
);

call pg_temp.k4_capture_context(
    'guc_cross_merchant_denied',
    '31000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000002',
    'sandbox',
    'member',
    '30000000-0000-0000-0000-000000000001',
    'sandbox'
);
select is((select error_state from k4_case_results where case_name = 'guc_cross_merchant_denied'), '42501', 'authorized-looking GUC cannot forge cross-merchant access');

-- Pure context resolution must not mutate domain/financial/async state.
select is((select count(*) from app.audit_events), 0::bigint, 'K4 context checks do not append audit events');
select is((select count(*) from app.payments), 0::bigint, 'K4 context checks do not create payments');
select is((select count(*) from app.ledger_transactions), 0::bigint, 'K4 context checks do not post ledger transactions');
select is((select count(*) from app.jobs), 0::bigint, 'K4 context checks do not enqueue jobs');
select is((select count(*) from app.webhook_events), 0::bigint, 'K4 context checks do not create merchant webhook events');

-- Actual API role blast-radius probes.
call pg_temp.k4_capture_sqlstate('api_direct_table', 'swiftpay_api', 'select count(*) from app.merchants');
select is((select error_state from k4_case_results where case_name = 'api_direct_table'), '42501', 'swiftpay_api cannot read app tables directly');

call pg_temp.k4_capture_sqlstate('api_worker_claim', 'swiftpay_api', $$select * from app.claim_jobs('k4-api', 1, 60)$$);
select is((select error_state from k4_case_results where case_name = 'api_worker_claim'), '42501', 'swiftpay_api cannot execute worker lease functions');

call pg_temp.k4_capture_sqlstate(
    'api_financial_primitive',
    'swiftpay_api',
    $$select app.post_ledger_transaction('sandbox','k4_test','32000000-0000-0000-0000-000000000001'::uuid,'k4_test','[]'::jsonb)$$
);
select is((select error_state from k4_case_results where case_name = 'api_financial_primitive'), '42501', 'swiftpay_api cannot execute financial ledger primitive');

-- Actual worker role blast-radius probes.
call pg_temp.k4_capture_sqlstate(
    'worker_dashboard_context',
    'swiftpay_worker',
    $$select * from app.require_dashboard_merchant_context('31000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','sandbox','member')$$
);
select is((select error_state from k4_case_results where case_name = 'worker_dashboard_context'), '42501', 'swiftpay_worker cannot execute dashboard context helper');

call pg_temp.k4_capture_sqlstate(
    'worker_raw_membership',
    'swiftpay_worker',
    $$select app.require_merchant_membership('31000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','member')$$
);
select is((select error_state from k4_case_results where case_name = 'worker_raw_membership'), '42501', 'swiftpay_worker cannot execute raw K3 membership helper');

call pg_temp.k4_capture_sqlstate('worker_direct_table', 'swiftpay_worker', 'select count(*) from app.jobs');
select is((select error_state from k4_case_results where case_name = 'worker_direct_table'), '42501', 'swiftpay_worker cannot read app tables directly');

call pg_temp.k4_capture_sqlstate(
    'worker_financial_primitive',
    'swiftpay_worker',
    $$select app.post_ledger_transaction('sandbox','k4_test','32000000-0000-0000-0000-000000000002'::uuid,'k4_test','[]'::jsonb)$$
);
select is((select error_state from k4_case_results where case_name = 'worker_financial_primitive'), '42501', 'swiftpay_worker cannot execute financial ledger primitive');

-- Worker positive capability: claim + complete one durable job without table DML.
insert into pg_temp.k4_case_results (case_name, job_id)
select
    'complete_seed',
    app.enqueue_job(
        'k4_complete_probe',
        'k4_test',
        '32000000-0000-0000-0000-000000000010'::uuid,
        'k4-complete-probe',
        '{}'::jsonb,
        1,
        3,
        now()
    );

do $$
declare
    v_job_id uuid;
    v_token uuid;
    v_state text;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_worker';
    begin
        select j.id, j.lease_token, j.state
        into v_job_id, v_token, v_state
        from app.claim_jobs('k4-worker-complete', 1, 60) j;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.k4_case_results (
        case_name, job_id, lease_token, job_state, error_state, error_message
    ) values (
        'worker_claim_complete', v_job_id, v_token, v_state, v_error_state, v_error_message
    );
end;
$$;

select is((select error_state from k4_case_results where case_name = 'worker_claim_complete'), null, 'swiftpay_worker can execute claim_jobs');
select is(
    (select job_id from k4_case_results where case_name = 'worker_claim_complete'),
    (select job_id from k4_case_results where case_name = 'complete_seed'),
    'worker claim returns the seeded durable job'
);
select ok((select lease_token is not null from k4_case_results where case_name = 'worker_claim_complete'), 'worker claim receives lease fencing token');
select is((select job_state from k4_case_results where case_name = 'worker_claim_complete'), 'leased', 'worker claim transitions job to leased');

do $$
declare
    v_job_id uuid;
    v_token uuid;
    v_result boolean;
    v_error_state text;
    v_error_message text;
begin
    select job_id, lease_token
    into v_job_id, v_token
    from pg_temp.k4_case_results
    where case_name = 'worker_claim_complete';

    execute 'set local role swiftpay_worker';
    begin
        select app.complete_job(v_job_id, v_token) into v_result;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.k4_case_results (
        case_name, boolean_result, error_state, error_message
    ) values (
        'worker_complete', v_result, v_error_state, v_error_message
    );
end;
$$;

select is((select error_state from k4_case_results where case_name = 'worker_complete'), null, 'swiftpay_worker can execute complete_job');
select is((select boolean_result from k4_case_results where case_name = 'worker_complete'), true, 'worker completes job with matching lease token');
select is(
    (select state from app.jobs where id = (select job_id from k4_case_results where case_name = 'complete_seed')),
    'completed',
    'completed worker job is durably completed'
);

-- Worker positive capability: claim + reschedule a separate job.
insert into pg_temp.k4_case_results (case_name, job_id)
select
    'reschedule_seed',
    app.enqueue_job(
        'k4_reschedule_probe',
        'k4_test',
        '32000000-0000-0000-0000-000000000011'::uuid,
        'k4-reschedule-probe',
        '{}'::jsonb,
        1,
        3,
        now()
    );

do $$
declare
    v_job_id uuid;
    v_token uuid;
    v_result boolean;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_worker';
    begin
        select j.id, j.lease_token
        into v_job_id, v_token
        from app.claim_jobs('k4-worker-reschedule', 1, 60) j;

        select app.reschedule_job(v_job_id, v_token, 'transient', 'K4_TEST', 5)
        into v_result;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.k4_case_results (
        case_name, job_id, lease_token, boolean_result, error_state, error_message
    ) values (
        'worker_reschedule', v_job_id, v_token, v_result, v_error_state, v_error_message
    );
end;
$$;

select is((select error_state from k4_case_results where case_name = 'worker_reschedule'), null, 'swiftpay_worker can claim and execute reschedule_job');
select is((select boolean_result from k4_case_results where case_name = 'worker_reschedule'), true, 'worker reschedules job with matching lease token');
select is(
    (select state from app.jobs where id = (select job_id from k4_case_results where case_name = 'reschedule_seed')),
    'pending',
    'rescheduled worker job returns to pending state'
);
select is(
    (
        select last_error_class || '|' || last_error_code
        from app.jobs
        where id = (select job_id from k4_case_results where case_name = 'reschedule_seed')
    ),
    'transient|K4_TEST',
    'rescheduled worker job records normalized retry diagnostics'
);

select * from finish();
rollback;