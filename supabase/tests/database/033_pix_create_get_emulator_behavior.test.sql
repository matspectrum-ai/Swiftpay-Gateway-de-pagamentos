create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(48);

-- PostgreSQL 17 does not automatically make a CREATEROLE creator SET-capable
-- for newly created roles. This test-only membership is rolled back below.
grant swiftpay_api to postgres with inherit false;

insert into app.merchants (id, name, lifecycle_status) values
    ('80000000-0000-0000-0000-000000000001'::uuid, 'A2 Active Merchant', 'active'),
    ('80000000-0000-0000-0000-000000000002'::uuid, 'A2 Other Merchant', 'active'),
    ('80000000-0000-0000-0000-000000000003'::uuid, 'A2 Suspended Merchant', 'suspended');

insert into app.providers (id, code, name, status) values
    ('81000000-0000-0000-0000-000000000001'::uuid, 'swiftpay_emulator', 'SwiftPay Pix Emulator', 'active');

insert into app.provider_accounts (
    id,
    provider_id,
    merchant_id,
    name,
    environment,
    status,
    credentials_ciphertext,
    capabilities,
    configuration
) values (
    '82000000-0000-0000-0000-000000000001'::uuid,
    '81000000-0000-0000-0000-000000000001'::uuid,
    null,
    'A2 Platform Sandbox Emulator',
    'sandbox',
    'active',
    '{}'::jsonb,
    '{"create_pix_charge":true}'::jsonb,
    '{"emulator":true}'::jsonb
);

create temporary table a2_results (
    case_name text primary key,
    result jsonb,
    error_state text,
    error_message text
);

create procedure pg_temp.a2_capture_prepare(
    p_case_name text,
    p_merchant_id uuid,
    p_environment text,
    p_idempotency_key text,
    p_request_hash text,
    p_request jsonb
)
language plpgsql
security invoker
as $$
declare
    v_result jsonb;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_api';
    begin
        select app.prepare_api_pix_payment(
            p_merchant_id,
            p_environment,
            p_idempotency_key,
            p_request_hash,
            p_request,
            jsonb_build_object(
                'pricingVersion', 'sandbox-zero-fee-v0',
                'feeMode', 'fixed',
                'feeFixedCents', 0,
                'feeBasisPoints', 0,
                'feePercentageComponentCents', 0,
                'merchantFeeCents', 0,
                'merchantNetCents', (p_request ->> 'amount')::bigint,
                'roundingPolicyVersion', 'ceil-bp-v1',
                'refundFeePolicy', 'merchant_fee_non_refundable'
            ),
            'sandbox-emulator-v0'
        ) into v_result;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.a2_results (case_name, result, error_state, error_message)
    values (p_case_name, v_result, v_error_state, v_error_message);
end;
$$;

create procedure pg_temp.a2_capture_claim(
    p_case_name text,
    p_payment_id uuid,
    p_provider_attempt_id uuid
)
language plpgsql
security invoker
as $$
declare
    v_result jsonb;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_api';
    begin
        select app.claim_api_pix_attempt(
            '80000000-0000-0000-0000-000000000001'::uuid,
            'sandbox',
            p_payment_id,
            p_provider_attempt_id
        ) into v_result;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.a2_results (case_name, result, error_state, error_message)
    values (p_case_name, v_result, v_error_state, v_error_message);
end;
$$;

create procedure pg_temp.a2_capture_resolve(
    p_case_name text,
    p_payment_id uuid,
    p_provider_attempt_id uuid,
    p_execution_token uuid,
    p_resolution jsonb
)
language plpgsql
security invoker
as $$
declare
    v_result jsonb;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_api';
    begin
        select app.resolve_api_pix_attempt(
            '80000000-0000-0000-0000-000000000001'::uuid,
            'sandbox',
            p_payment_id,
            p_provider_attempt_id,
            p_execution_token,
            p_resolution
        ) into v_result;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.a2_results (case_name, result, error_state, error_message)
    values (p_case_name, v_result, v_error_state, v_error_message);
end;
$$;

create procedure pg_temp.a2_capture_get(
    p_case_name text,
    p_merchant_id uuid,
    p_environment text,
    p_payment_id uuid
)
language plpgsql
security invoker
as $$
declare
    v_result jsonb;
    v_error_state text;
    v_error_message text;
begin
    execute 'set local role swiftpay_api';
    begin
        select app.get_api_payment(
            p_merchant_id,
            p_environment,
            p_payment_id
        ) into v_result;
    exception when others then
        get stacked diagnostics
            v_error_state = returned_sqlstate,
            v_error_message = message_text;
    end;
    execute 'reset role';

    insert into pg_temp.a2_results (case_name, result, error_state, error_message)
    values (p_case_name, v_result, v_error_state, v_error_message);
end;
$$;

-- First durable create: idempotency + Payment + ProviderAttempt before execution.
call pg_temp.a2_capture_prepare(
    'success_first',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'idem-a2-db-success',
    repeat('a', 64),
    '{
      "method":"pix",
      "amount":10101,
      "currency":"BRL",
      "description":"Pedido A2 DB",
      "externalId":"order-a2-db-001",
      "pixExpirationMinutes":30,
      "customerName":"Cliente A2",
      "customerEmail":"cliente-a2@example.test"
    }'::jsonb
);

select is((select error_state from a2_results where case_name = 'success_first'), null,
    'A2 first prepare completes without database error');
select is((select result ->> 'kind' from a2_results where case_name = 'success_first'), 'prepared',
    'A2 first prepare returns prepared');
select is((select count(*) from app.request_idempotency), 1::bigint,
    'A2 first prepare creates one request idempotency row');
select is((select count(*) from app.payments), 1::bigint,
    'A2 first prepare creates one Payment');
select is((select count(*) from app.provider_attempts), 1::bigint,
    'A2 first prepare creates one ProviderAttempt');
select is(
    (select state || '|' || operation || '|' || request_hash || '|' || resource_type
       from app.request_idempotency where idempotency_key = 'idem-a2-db-success'),
    'in_progress|create_payment|' || repeat('a', 64) || '|payment',
    'A2 first prepare persists the canonical in-progress idempotency identity'
);
select ok(
    (select resource_id = (select id from app.payments limit 1)
       from app.request_idempotency where idempotency_key = 'idem-a2-db-success'),
    'A2 idempotency row links to the created Payment'
);
select is(
    (select amount_cents::text || '|' || currency || '|' || collection_status || '|' ||
            source || '|' || coalesce(external_id, '') || '|' || coalesce(description, '')
       from app.payments limit 1),
    '10101|BRL|creating|api|order-a2-db-001|Pedido A2 DB',
    'A2 Payment stores canonical merchant request fields in creating state'
);
select is(
    (select pricing_version || '|' || fee_mode || '|' || fee_fixed_cents::text || '|' ||
            fee_basis_points::text || '|' || fee_percentage_component_cents::text || '|' ||
            merchant_fee_cents::text || '|' || merchant_net_cents::text || '|' ||
            rounding_policy_version || '|' || refund_fee_policy || '|' || routing_policy_version
       from app.payments limit 1),
    'sandbox-zero-fee-v0|fixed|0|0|0|0|10101|ceil-bp-v1|merchant_fee_non_refundable|sandbox-emulator-v0',
    'A2 Payment persists the complete zero-fee pricing and routing snapshot'
);
select ok(
    (select expires_at between clock_timestamp() + interval '29 minutes'
                          and clock_timestamp() + interval '31 minutes'
       from app.payments limit 1),
    'A2 Payment snapshots requested Pix expiration'
);
select ok(
    (select pa.state = 'prepared'
         and pa.attempt_number = 1
         and pa.operation = 'create_pix_charge'
         and pa.provider_id = '81000000-0000-0000-0000-000000000001'::uuid
         and pa.provider_account_id = '82000000-0000-0000-0000-000000000001'::uuid
         and pa.client_reference = pa.id::text
         and pa.request_fingerprint = repeat('a', 64)
       from app.provider_attempts pa limit 1),
    'A2 ProviderAttempt is prepared against exactly the sandbox emulator account with stable identity'
);
select is(
    (select count(*)::text || '|' ||
            (select count(*) from app.ledger_transactions)::text || '|' ||
            (select count(*) from app.jobs)::text || '|' ||
            (select count(*) from app.webhook_events)::text
       from app.payments),
    '1|0|0|0',
    'A2 prepare creates no ledger job or merchant-webhook side effects'
);

-- Same key + same hash reuses the same logical prepared resource.
call pg_temp.a2_capture_prepare(
    'success_replay_prepared',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'idem-a2-db-success',
    repeat('a', 64),
    '{
      "method":"pix",
      "amount":10101,
      "currency":"BRL",
      "description":"Pedido A2 DB",
      "externalId":"order-a2-db-001",
      "pixExpirationMinutes":30,
      "customerName":"Cliente A2",
      "customerEmail":"cliente-a2@example.test"
    }'::jsonb
);
select is((select error_state from a2_results where case_name = 'success_replay_prepared'), null,
    'A2 prepared replay completes without database error');
select is((select result ->> 'kind' from a2_results where case_name = 'success_replay_prepared'), 'prepared',
    'A2 same-key same-hash prepared replay remains claimable');
select is(
    (select count(*)::text || '|' ||
            (select count(*) from app.provider_attempts)::text
       from app.payments),
    '1|1',
    'A2 prepared replay creates no second Payment or ProviderAttempt'
);

-- Same key + different canonical hash is a normal deterministic conflict.
call pg_temp.a2_capture_prepare(
    'success_conflict',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'idem-a2-db-success',
    repeat('b', 64),
    '{"method":"pix","amount":20202,"currency":"BRL","pixExpirationMinutes":30}'::jsonb
);
select is((select error_state from a2_results where case_name = 'success_conflict'), null,
    'A2 idempotency conflict is returned as a normal result');
select is((select result ->> 'kind' from a2_results where case_name = 'success_conflict'), 'conflict',
    'A2 same key with different hash returns conflict');
select is((select count(*) from app.payments), 1::bigint,
    'A2 idempotency conflict creates no second Payment');

-- Trusted DB boundary fails closed outside sandbox/active merchant.
call pg_temp.a2_capture_prepare(
    'production_forbidden',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'production',
    'idem-a2-db-production',
    repeat('c', 64),
    '{"method":"pix","amount":100,"currency":"BRL","pixExpirationMinutes":30}'::jsonb
);
select ok((select error_state is not null from a2_results where case_name = 'production_forbidden'),
    'A2 trusted prepare rejects Production even if called directly');

call pg_temp.a2_capture_prepare(
    'suspended_forbidden',
    '80000000-0000-0000-0000-000000000003'::uuid,
    'sandbox',
    'idem-a2-db-suspended',
    repeat('d', 64),
    '{"method":"pix","amount":100,"currency":"BRL","pixExpirationMinutes":30}'::jsonb
);
select ok((select error_state is not null from a2_results where case_name = 'suspended_forbidden'),
    'A2 trusted prepare rejects a suspended merchant');

-- Atomic execution claim.
call pg_temp.a2_capture_claim(
    'success_claim_first',
    (select (result -> 'payment' ->> 'id')::uuid from a2_results where case_name = 'success_first'),
    (select (result -> 'providerAttempt' ->> 'id')::uuid from a2_results where case_name = 'success_first')
);
select is((select error_state from a2_results where case_name = 'success_claim_first'), null,
    'A2 first attempt claim completes without database error');
select is((select result ->> 'claimed' from a2_results where case_name = 'success_claim_first'), 'true',
    'A2 first attempt claim wins');
select ok(
    (select (result ->> 'executionToken')::uuid is not null
       from a2_results where case_name = 'success_claim_first'),
    'A2 winning claim returns a UUID execution token'
);
select ok(
    (select state = 'executing'
         and execution_token = (select (result ->> 'executionToken')::uuid
                                  from a2_results where case_name = 'success_claim_first')
         and started_at is not null
         and lease_expires_at between clock_timestamp() + interval '29 seconds'
                                  and clock_timestamp() + interval '31 seconds'
       from app.provider_attempts limit 1),
    'A2 winning claim atomically owns a thirty-second executing lease'
);

call pg_temp.a2_capture_claim(
    'success_claim_second',
    (select id from app.payments limit 1),
    (select id from app.provider_attempts limit 1)
);
select is((select error_state from a2_results where case_name = 'success_claim_second'), null,
    'A2 losing attempt claim is a normal result');
select is((select result ->> 'claimed' from a2_results where case_name = 'success_claim_second'), 'false',
    'A2 a second claim cannot own the same executing attempt');

call pg_temp.a2_capture_prepare(
    'success_replay_executing',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'idem-a2-db-success',
    repeat('a', 64),
    '{
      "method":"pix",
      "amount":10101,
      "currency":"BRL",
      "description":"Pedido A2 DB",
      "externalId":"order-a2-db-001",
      "pixExpirationMinutes":30,
      "customerName":"Cliente A2",
      "customerEmail":"cliente-a2@example.test"
    }'::jsonb
);
select is((select result ->> 'kind' from a2_results where case_name = 'success_replay_executing'), 'executing',
    'A2 same-key replay observes executing and cannot trigger another create');

-- Merchant/environment-scoped read while still creating.
call pg_temp.a2_capture_get(
    'get_owner_creating',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    (select id from app.payments limit 1)
);
select ok(
    (select error_state is null
         and result ->> 'status' = 'creating'
         and result -> 'pix' = 'null'::jsonb
       from a2_results where case_name = 'get_owner_creating'),
    'A2 owner GET returns merchant-safe creating Payment with no Pix payload'
);

call pg_temp.a2_capture_get(
    'get_foreign',
    '80000000-0000-0000-0000-000000000002'::uuid,
    'sandbox',
    (select id from app.payments limit 1)
);
select ok(
    (select error_state is null and result is null
       from a2_results where case_name = 'get_foreign'),
    'A2 foreign merchant GET is indistinguishable from absence'
);

call pg_temp.a2_capture_get(
    'get_wrong_environment',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'production',
    (select id from app.payments limit 1)
);
select ok(
    (select error_state is null and result is null
       from a2_results where case_name = 'get_wrong_environment'),
    'A2 wrong-environment GET is indistinguishable from absence'
);

-- Resolution ownership is exact: a stale/wrong execution token cannot mutate state.
call pg_temp.a2_capture_resolve(
    'success_resolve_wrong_token',
    (select id from app.payments limit 1),
    (select id from app.provider_attempts limit 1),
    '89999999-9999-9999-9999-999999999999'::uuid,
    '{"certainty":"definitive_rejection","errorClass":"definitive_rejection","errorCode":"wrong-token-probe"}'::jsonb
);
select ok((select error_state is not null from a2_results where case_name = 'success_resolve_wrong_token'),
    'A2 resolution rejects a non-current execution token');
select is((select state from app.provider_attempts limit 1), 'executing',
    'A2 rejected resolution token leaves the attempt executing');
select is((select collection_status from app.payments limit 1), 'creating',
    'A2 rejected resolution token leaves the Payment creating');

-- Successful emulator resolution.
call pg_temp.a2_capture_resolve(
    'success_resolve',
    (select id from app.payments limit 1),
    (select id from app.provider_attempts limit 1),
    (select (result ->> 'executionToken')::uuid from a2_results where case_name = 'success_claim_first'),
    jsonb_build_object(
        'certainty', 'success',
        'providerPaymentId', 'swiftpay-emulator-payment:success',
        'txId', 'swiftpay-emulator-tx:success',
        'copyAndPaste', 'SWIFTPAY_EMULATOR_COPY_SUCCESS',
        'qrCode', 'SWIFTPAY_EMULATOR_QR_SUCCESS',
        'expiresAt', to_char((clock_timestamp() + interval '30 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
);
select is((select error_state from a2_results where case_name = 'success_resolve'), null,
    'A2 success resolution completes without database error');
select ok(
    (select result ->> 'status' = 'pending'
         and result -> 'pix' ->> 'txId' = 'swiftpay-emulator-tx:success'
         and result -> 'pix' ->> 'copyAndPaste' = 'SWIFTPAY_EMULATOR_COPY_SUCCESS'
         and result -> 'pix' ->> 'qrCode' = 'SWIFTPAY_EMULATOR_QR_SUCCESS'
       from a2_results where case_name = 'success_resolve'),
    'A2 success resolution returns a pending public Payment with normalized Pix data'
);
select ok(
    (select not (result ? 'provider')
         and not (result ? 'providerId')
         and not (result ? 'providerAccountId')
         and not (result ? 'providerPaymentId')
         and not (result ? 'providerCost')
         and not (result ? 'routingPolicy')
         and not (result ? 'executionToken')
       from a2_results where case_name = 'success_resolve'),
    'A2 public Payment projection exposes no provider routing cost or execution internals'
);
select ok(
    (select state = 'succeeded'
         and provider_payment_id = 'swiftpay-emulator-payment:success'
         and provider_txid = 'swiftpay-emulator-tx:success'
         and pix_copy_paste = 'SWIFTPAY_EMULATOR_COPY_SUCCESS'
         and pix_qr_reference = 'SWIFTPAY_EMULATOR_QR_SUCCESS'
         and finished_at is not null
       from app.provider_attempts limit 1),
    'A2 success resolution durably persists provider identity and Pix evidence'
);
select is((select collection_status from app.payments limit 1), 'pending',
    'A2 success resolution moves Payment creating to pending');
select ok(
    (select state = 'completed'
         and http_status_snapshot = 201
         and response_snapshot = (select result from a2_results where case_name = 'success_resolve')
         and completed_at is not null
       from app.request_idempotency where idempotency_key = 'idem-a2-db-success'),
    'A2 success resolution completes idempotency with the canonical 201 response snapshot'
);

call pg_temp.a2_capture_prepare(
    'success_replay_completed',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'idem-a2-db-success',
    repeat('a', 64),
    '{
      "method":"pix",
      "amount":10101,
      "currency":"BRL",
      "description":"Pedido A2 DB",
      "externalId":"order-a2-db-001",
      "pixExpirationMinutes":30,
      "customerName":"Cliente A2",
      "customerEmail":"cliente-a2@example.test"
    }'::jsonb
);
select ok(
    (select error_state is null
         and result ->> 'kind' = 'completed'
         and (result ->> 'httpStatus')::integer = 201
         and result -> 'payment' = (select response_snapshot from app.request_idempotency where idempotency_key = 'idem-a2-db-success')
       from a2_results where case_name = 'success_replay_completed'),
    'A2 completed replay returns the original completed Payment snapshot'
);

-- execution_unknown keeps the same local Payment unresolved and requires recovery.
call pg_temp.a2_capture_prepare(
    'unknown_first',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'idem-a2-db-unknown',
    repeat('e', 64),
    '{"method":"pix","amount":30303,"currency":"BRL","pixExpirationMinutes":30}'::jsonb
);
call pg_temp.a2_capture_claim(
    'unknown_claim',
    (select (result -> 'payment' ->> 'id')::uuid from a2_results where case_name = 'unknown_first'),
    (select (result -> 'providerAttempt' ->> 'id')::uuid from a2_results where case_name = 'unknown_first')
);
call pg_temp.a2_capture_resolve(
    'unknown_resolve',
    (select (result -> 'payment' ->> 'id')::uuid from a2_results where case_name = 'unknown_first'),
    (select (result -> 'providerAttempt' ->> 'id')::uuid from a2_results where case_name = 'unknown_first'),
    (select (result ->> 'executionToken')::uuid from a2_results where case_name = 'unknown_claim'),
    '{"certainty":"execution_unknown","errorClass":"execution_unknown"}'::jsonb
);
select ok(
    (select error_state is null from a2_results where case_name = 'unknown_first')
    and (select error_state is null from a2_results where case_name = 'unknown_claim')
    and (select error_state is null from a2_results where case_name = 'unknown_resolve'),
    'A2 execution-unknown path prepares claims and resolves without database error'
);
select ok(
    (select state = 'execution_unknown'
         and last_error_class = 'execution_unknown'
         and recovery_required_at is not null
         and finished_at is null
       from app.provider_attempts
       where payment_id = (select (result -> 'payment' ->> 'id')::uuid
                             from a2_results where case_name = 'unknown_first')),
    'A2 ambiguous execution becomes execution_unknown with explicit recovery requirement'
);
select ok(
    (select collection_status = 'creating'
       from app.payments
       where id = (select (result -> 'payment' ->> 'id')::uuid
                     from a2_results where case_name = 'unknown_first'))
    and
    (select state = 'in_progress'
         and response_snapshot is null
         and completed_at is null
       from app.request_idempotency where idempotency_key = 'idem-a2-db-unknown'),
    'A2 execution_unknown keeps Payment creating and idempotency in progress'
);

call pg_temp.a2_capture_prepare(
    'unknown_replay',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'idem-a2-db-unknown',
    repeat('e', 64),
    '{"method":"pix","amount":30303,"currency":"BRL","pixExpirationMinutes":30}'::jsonb
);
select is((select result ->> 'kind' from a2_results where case_name = 'unknown_replay'), 'execution_unknown',
    'A2 unknown replay returns the same unknown logical Payment without a new attempt');

-- Definitive rejection is a terminal local Payment resource, not an HTTP create failure.
call pg_temp.a2_capture_prepare(
    'rejected_first',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'idem-a2-db-rejected',
    repeat('f', 64),
    '{"method":"pix","amount":40404,"currency":"BRL","pixExpirationMinutes":30}'::jsonb
);
call pg_temp.a2_capture_claim(
    'rejected_claim',
    (select (result -> 'payment' ->> 'id')::uuid from a2_results where case_name = 'rejected_first'),
    (select (result -> 'providerAttempt' ->> 'id')::uuid from a2_results where case_name = 'rejected_first')
);
call pg_temp.a2_capture_resolve(
    'rejected_resolve',
    (select (result -> 'payment' ->> 'id')::uuid from a2_results where case_name = 'rejected_first'),
    (select (result -> 'providerAttempt' ->> 'id')::uuid from a2_results where case_name = 'rejected_first'),
    (select (result ->> 'executionToken')::uuid from a2_results where case_name = 'rejected_claim'),
    '{"certainty":"definitive_rejection","errorClass":"definitive_rejection","errorCode":"emulator_rejected"}'::jsonb
);
select ok(
    (select error_state is null from a2_results where case_name = 'rejected_first')
    and (select error_state is null from a2_results where case_name = 'rejected_claim')
    and (select error_state is null from a2_results where case_name = 'rejected_resolve'),
    'A2 definitive-rejection path prepares claims and resolves without database error'
);
select ok(
    (select state = 'definitively_failed'
         and last_error_class = 'definitive_rejection'
         and last_error_code = 'emulator_rejected'
         and finished_at is not null
       from app.provider_attempts
       where payment_id = (select (result -> 'payment' ->> 'id')::uuid
                             from a2_results where case_name = 'rejected_first'))
    and
    (select collection_status = 'failed'
       from app.payments
       where id = (select (result -> 'payment' ->> 'id')::uuid
                     from a2_results where case_name = 'rejected_first'))
    and
    (select state = 'completed'
         and http_status_snapshot = 201
         and response_snapshot ->> 'status' = 'failed'
       from app.request_idempotency where idempotency_key = 'idem-a2-db-rejected'),
    'A2 definitive rejection atomically closes attempt Payment and 201 idempotency snapshot'
);

-- Router must fail closed if the A2 fixture becomes ambiguous.
insert into app.provider_accounts (
    id, provider_id, merchant_id, name, environment, status,
    credentials_ciphertext, capabilities, configuration
) values (
    '82000000-0000-0000-0000-000000000002'::uuid,
    '81000000-0000-0000-0000-000000000001'::uuid,
    null,
    'A2 Ambiguous Emulator Account',
    'sandbox',
    'active',
    '{}'::jsonb,
    '{"create_pix_charge":true}'::jsonb,
    '{"emulator":true}'::jsonb
);
call pg_temp.a2_capture_prepare(
    'ambiguous_router',
    '80000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'idem-a2-db-ambiguous-router',
    repeat('1', 64),
    '{"method":"pix","amount":50505,"currency":"BRL","pixExpirationMinutes":30}'::jsonb
);
select ok(
    (select error_state is not null from a2_results where case_name = 'ambiguous_router')
    and not exists (
        select 1 from app.request_idempotency where idempotency_key = 'idem-a2-db-ambiguous-router'
    ),
    'A2 zero-or-multiple eligible emulator accounts fail closed before creating financial state'
);

select is(
    (select count(*)::text || '|' ||
            (select count(*) from app.ledger_transactions)::text || '|' ||
            (select count(*) from app.jobs)::text || '|' ||
            (select count(*) from app.webhook_events)::text
       from app.payments),
    '3|0|0|0',
    'A2 success unknown and rejection paths still create no ledger job or merchant-webhook effects'
);

select * from finish();
rollback;