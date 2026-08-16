create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;
select plan(38);

grant swiftpay_worker to postgres with inherit false;

insert into app.merchants (id, name, lifecycle_status)
values ('a4000000-0000-0000-0000-000000000001'::uuid, 'A4 Webhook Merchant', 'active');

insert into app.webhook_endpoints (
  id, merchant_id, environment, url, status,
  secret_ciphertext, secret_version,
  previous_secret_ciphertext, previous_secret_version, previous_secret_expires_at,
  subscribed_events
) values (
  'a4100000-0000-0000-0000-000000000001'::uuid,
  'a4000000-0000-0000-0000-000000000001'::uuid,
  'sandbox',
  'https://merchant.example.test/swiftpay',
  'active',
  'cipher-v3',
  3,
  null, null, null,
  '["payment.paid"]'::jsonb
);

create temporary table a4_cases (
  case_name text primary key,
  event_id uuid not null,
  delivery_id uuid not null,
  job_id uuid not null
);

create temporary table a4_claims (
  capture_name text primary key,
  result jsonb,
  error_state text,
  error_message text
);

create temporary table a4_resolutions (
  capture_name text primary key,
  resolved boolean,
  error_state text,
  error_message text
);

create procedure pg_temp.a4_record_case(
  p_case_name text,
  p_source_id uuid
)
language plpgsql
security invoker
as $$
declare
  v_event_id uuid;
  v_delivery_id uuid;
  v_job_id uuid;
begin
  select app.record_webhook_event(
    'a4000000-0000-0000-0000-000000000001'::uuid,
    'sandbox',
    'payment.paid',
    'payment',
    p_source_id,
    'payment',
    p_source_id,
    'payment-v1',
    jsonb_build_object(
      'id', p_source_id::text,
      'method', 'pix',
      'amount', 12345,
      'fee', 0,
      'netAmount', 12345,
      'currency', 'BRL',
      'status', 'paid',
      'environment', 'sandbox',
      'pix', jsonb_build_object(
        'txId', 'a4-test-tx',
        'qrCode', 'SWIFTPAY_EMULATOR_QR_A4',
        'copyAndPaste', 'SWIFTPAY_EMULATOR_COPY_A4',
        'expiresAt', '2030-01-01T00:00:00.000Z'
      )
    ),
    '2030-01-02T03:04:05Z'::timestamptz
  ) into v_event_id;

  select d.id, j.id
    into strict v_delivery_id, v_job_id
    from app.webhook_deliveries d
    join app.jobs j
      on j.kind = 'merchant_webhook_delivery'
     and j.resource_type = 'webhook_delivery'
     and j.resource_id = d.id
   where d.webhook_event_id = v_event_id
     and d.webhook_endpoint_id = 'a4100000-0000-0000-0000-000000000001'::uuid;

  insert into pg_temp.a4_cases values (p_case_name, v_event_id, v_delivery_id, v_job_id);
end;
$$;

create procedure pg_temp.a4_capture_claim(
  p_capture_name text,
  p_worker_id text,
  p_limit integer,
  p_lease_seconds integer
)
language plpgsql
security invoker
as $$
declare
  v_result jsonb;
  v_error_state text;
  v_error_message text;
begin
  execute 'set local role swiftpay_worker';
  begin
    execute 'select coalesce(jsonb_agg(x), ''[]''::jsonb) from app.claim_merchant_webhook_deliveries($1,$2,$3) x'
      into v_result
      using p_worker_id, p_limit, p_lease_seconds;
  exception when others then
    get stacked diagnostics
      v_error_state = returned_sqlstate,
      v_error_message = message_text;
  end;
  execute 'reset role';

  insert into pg_temp.a4_claims values
    (p_capture_name, v_result, v_error_state, v_error_message);
end;
$$;

create procedure pg_temp.a4_capture_resolve(
  p_capture_name text,
  p_job_id uuid,
  p_delivery_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_http_status integer,
  p_error_class text,
  p_error_code text,
  p_retry_after_seconds integer
)
language plpgsql
security invoker
as $$
declare
  v_resolved boolean;
  v_error_state text;
  v_error_message text;
begin
  execute 'set local role swiftpay_worker';
  begin
    execute 'select app.resolve_merchant_webhook_delivery($1,$2,$3,$4,$5,$6,$7,$8)'
      into v_resolved
      using p_job_id, p_delivery_id, p_lease_token, p_outcome,
            p_http_status, p_error_class, p_error_code, p_retry_after_seconds;
  exception when others then
    get stacked diagnostics
      v_error_state = returned_sqlstate,
      v_error_message = message_text;
  end;
  execute 'reset role';

  insert into pg_temp.a4_resolutions values
    (p_capture_name, v_resolved, v_error_state, v_error_message);
end;
$$;

-- A delivery freezes secret version 3. Rotate the endpoint before dispatch so
-- A4 must use the bounded previous-secret overlap rather than silently switching.
call pg_temp.a4_record_case(
  'retry_then_success',
  'a4200000-0000-0000-0000-000000000001'::uuid
);

select is(
  (select to_jsonb(d) ->> 'signing_secret_version'
     from app.webhook_deliveries d
    where d.id=(select delivery_id from a4_cases where case_name='retry_then_success')),
  '3',
  'A4 fanout snapshots endpoint signing-secret version on the delivery'
);

update app.webhook_endpoints
   set secret_ciphertext='cipher-v4',
       secret_version=4,
       previous_secret_ciphertext='cipher-v3',
       previous_secret_version=3,
       previous_secret_expires_at='2099-01-01T00:00:00Z'::timestamptz
 where id='a4100000-0000-0000-0000-000000000001'::uuid;

-- An unrelated due job must never be consumed by the A4 composed scheduler.
perform app.enqueue_job(
  'provider_event_application',
  'provider_event',
  'a4300000-0000-0000-0000-000000000001'::uuid,
  'a4-unrelated-provider-event',
  '{"provider_event_id":"a4300000-0000-0000-0000-000000000001"}'::jsonb,
  1, 5, now()
);

call pg_temp.a4_capture_claim('first_claim', 'a4-worker-one', 10, 30);

select is((select error_state from a4_claims where capture_name='first_claim'), null,
  'A4 composed claim succeeds through swiftpay_worker');
select is((select jsonb_array_length(result) from a4_claims where capture_name='first_claim'), 1,
  'A4 composed claim returns exactly one eligible webhook delivery');
select is(
  (select result -> 0 -> 'endpoint' ->> 'signingSecretVersion' from a4_claims where capture_name='first_claim'),
  '3',
  'A4 claim preserves the delivery secret-version snapshot after endpoint rotation'
);
select is(
  (select result -> 0 -> 'endpoint' ->> 'signingSecretCiphertext' from a4_claims where capture_name='first_claim'),
  'cipher-v3',
  'A4 claim selects the still-valid previous ciphertext for an in-flight delivery'
);
select is(
  (select result -> 0 -> 'event' ->> 'type' from a4_claims where capture_name='first_claim'),
  'payment.paid',
  'A4 claim returns canonical event type to the trusted worker'
);
select is(
  (select result -> 0 -> 'event' ->> 'payloadVersion' from a4_claims where capture_name='first_claim'),
  'payment-v1',
  'A4 claim returns explicit durable payload version'
);
select is(
  (select (result -> 0 ->> 'attemptNumber')::integer from a4_claims where capture_name='first_claim'),
  1,
  'A4 first dispatch claim reports attempt one'
);
select is(
  (select j.attempt_count::text || '|' || d.attempt_count::text
     from app.jobs j
     join app.webhook_deliveries d on d.id=j.resource_id
    where j.id=(select job_id from a4_cases where case_name='retry_then_success')),
  '1|1',
  'A4 Job and Delivery dispatch counters increment together'
);
select ok(
  (select j.state='leased'
       and d.state='leased'
       and j.lease_token is not null
       and j.lease_token=d.lease_token
       and j.lease_expires_at=d.lease_expires_at
       and j.lease_owner='a4-worker-one'
     from app.jobs j
     join app.webhook_deliveries d on d.id=j.resource_id
    where j.id=(select job_id from a4_cases where case_name='retry_then_success')),
  'A4 Job and Delivery share one current fencing token and lease expiry'
);
select is(
  (select state from app.jobs where dedupe_key='a4-unrelated-provider-event'),
  'pending',
  'A4 composed claim ignores unrelated due job kinds'
);

call pg_temp.a4_capture_claim('competing_claim', 'a4-worker-two', 10, 30);
select is((select error_state from a4_claims where capture_name='competing_claim'), null,
  'A4 competing worker query itself succeeds');
select is((select jsonb_array_length(result) from a4_claims where capture_name='competing_claim'), 0,
  'A4 competing worker cannot obtain the already-valid delivery lease');

-- A stale token cannot overwrite the current claim.
call pg_temp.a4_capture_resolve(
  'stale_resolve',
  (select job_id from a4_cases where case_name='retry_then_success'),
  (select delivery_id from a4_cases where case_name='retry_then_success'),
  'a4400000-0000-0000-0000-000000000099'::uuid,
  'success', 204, null, null, null
);
select is((select error_state from a4_resolutions where capture_name='stale_resolve'), null,
  'A4 stale resolution is fenced without database exception');
select is((select resolved from a4_resolutions where capture_name='stale_resolve'), false,
  'A4 stale/foreign lease token cannot resolve current delivery');

call pg_temp.a4_capture_resolve(
  'retry_resolve',
  (select job_id from a4_cases where case_name='retry_then_success'),
  (select delivery_id from a4_cases where case_name='retry_then_success'),
  (select (result -> 0 ->> 'leaseToken')::uuid from a4_claims where capture_name='first_claim'),
  'retry', 500, 'transient', 'http_500', 5
);
select is((select error_state from a4_resolutions where capture_name='retry_resolve'), null,
  'A4 retry resolution completes without database error');
select is((select resolved from a4_resolutions where capture_name='retry_resolve'), true,
  'A4 valid retry resolution accepts the current fencing token');
select is(
  (select j.state || '|' || d.state
     from app.jobs j join app.webhook_deliveries d on d.id=j.resource_id
    where j.id=(select job_id from a4_cases where case_name='retry_then_success')),
  'pending|pending',
  'A4 retry returns Job and Delivery to pending together'
);
select ok(
  (select j.lease_token is null and d.lease_token is null
       and abs(extract(epoch from (j.available_at-d.next_attempt_at))) < 0.001
     from app.jobs j join app.webhook_deliveries d on d.id=j.resource_id
    where j.id=(select job_id from a4_cases where case_name='retry_then_success')),
  'A4 retry clears leases and synchronizes next due time'
);
select is(
  (select d.last_http_status::text || '|' || d.last_error_class || '|' || coalesce(to_jsonb(d)->>'last_error_code','')
     from app.webhook_deliveries d
    where d.id=(select delivery_id from a4_cases where case_name='retry_then_success')),
  '500|transient|http_500',
  'A4 retry persists bounded HTTP/error evidence'
);

-- Make the deterministic retry due without sleeping the pgTAP lane.
update app.jobs set available_at=now()-interval '1 second'
 where id=(select job_id from a4_cases where case_name='retry_then_success');
update app.webhook_deliveries set next_attempt_at=now()-interval '1 second'
 where id=(select delivery_id from a4_cases where case_name='retry_then_success');

call pg_temp.a4_capture_claim('second_claim', 'a4-worker-two', 10, 30);
select is((select jsonb_array_length(result) from a4_claims where capture_name='second_claim'), 1,
  'A4 retry becomes claimable by exactly one worker when due');
select is((select (result -> 0 ->> 'attemptNumber')::integer from a4_claims where capture_name='second_claim'), 2,
  'A4 retry claim advances the durable dispatch attempt number exactly once');

call pg_temp.a4_capture_resolve(
  'success_resolve',
  (select job_id from a4_cases where case_name='retry_then_success'),
  (select delivery_id from a4_cases where case_name='retry_then_success'),
  (select (result -> 0 ->> 'leaseToken')::uuid from a4_claims where capture_name='second_claim'),
  'success', 204, null, null, null
);
select is((select resolved from a4_resolutions where capture_name='success_resolve'), true,
  'A4 current second lease can persist HTTP success');
select is(
  (select j.state || '|' || d.state
     from app.jobs j join app.webhook_deliveries d on d.id=j.resource_id
    where j.id=(select job_id from a4_cases where case_name='retry_then_success')),
  'completed|succeeded',
  'A4 success completes Job and succeeds Delivery atomically'
);
select ok(
  (select j.completed_at is not null
       and d.succeeded_at is not null
       and d.last_http_status=204
       and j.lease_token is null
       and d.lease_token is null
     from app.jobs j join app.webhook_deliveries d on d.id=j.resource_id
    where j.id=(select job_id from a4_cases where case_name='retry_then_success')),
  'A4 successful terminal evidence and lease cleanup are durable'
);

call pg_temp.a4_capture_claim('post_success_claim', 'a4-worker-three', 10, 30);
select is((select jsonb_array_length(result) from a4_claims where capture_name='post_success_claim'), 0,
  'A4 succeeded delivery is not automatically claimable again');

-- Disable after fanout: no HTTP dispatch attempt should be created.
update app.webhook_endpoints
   set status='active',
       secret_ciphertext='cipher-v4', secret_version=4,
       previous_secret_ciphertext=null, previous_secret_version=null, previous_secret_expires_at=null
 where id='a4100000-0000-0000-0000-000000000001'::uuid;
call pg_temp.a4_record_case('disabled_after_fanout', 'a4200000-0000-0000-0000-000000000002'::uuid);
update app.webhook_endpoints set status='disabled'
 where id='a4100000-0000-0000-0000-000000000001'::uuid;
call pg_temp.a4_capture_claim('disabled_claim', 'a4-worker-one', 10, 30);
select is((select jsonb_array_length(result) from a4_claims where capture_name='disabled_claim'), 0,
  'A4 disabled endpoint produces no transport claim');
select is(
  (select j.state || '|' || d.state || '|' || j.attempt_count::text || '|' || d.attempt_count::text
     from app.jobs j join app.webhook_deliveries d on d.id=j.resource_id
    where j.id=(select job_id from a4_cases where case_name='disabled_after_fanout')),
  'completed|disabled|0|0',
  'A4 endpoint disable completes the job and disables delivery without consuming an attempt'
);

-- Expired previous secret remains a claimable dispatch projection, but the
-- worker receives no ciphertext and must terminally resolve without network.
update app.webhook_endpoints
   set status='active',
       secret_ciphertext='cipher-v5', secret_version=5,
       previous_secret_ciphertext=null, previous_secret_version=null, previous_secret_expires_at=null
 where id='a4100000-0000-0000-0000-000000000001'::uuid;
call pg_temp.a4_record_case('expired_secret', 'a4200000-0000-0000-0000-000000000003'::uuid);
update app.webhook_endpoints
   set secret_ciphertext='cipher-v6', secret_version=6,
       previous_secret_ciphertext='cipher-v5', previous_secret_version=5,
       previous_secret_expires_at='2000-01-01T00:00:00Z'::timestamptz
 where id='a4100000-0000-0000-0000-000000000001'::uuid;
call pg_temp.a4_capture_claim('expired_secret_claim', 'a4-worker-one', 10, 30);
select is(
  (select result -> 0 -> 'endpoint' ->> 'signingSecretVersion' from a4_claims where capture_name='expired_secret_claim'),
  '5',
  'A4 expired historical secret claim preserves immutable delivery version'
);
select is(
  (select result -> 0 -> 'endpoint' ->> 'signingSecretCiphertext' from a4_claims where capture_name='expired_secret_claim'),
  null,
  'A4 expired historical secret returns no usable ciphertext to worker'
);
call pg_temp.a4_capture_resolve(
  'expired_secret_terminal',
  (select job_id from a4_cases where case_name='expired_secret'),
  (select delivery_id from a4_cases where case_name='expired_secret'),
  (select (result -> 0 ->> 'leaseToken')::uuid from a4_claims where capture_name='expired_secret_claim'),
  'terminal', null, 'configuration', 'signing_secret_unavailable', null
);
select is((select resolved from a4_resolutions where capture_name='expired_secret_terminal'), true,
  'A4 missing historical signing material can be terminally fenced');
select is(
  (select j.state || '|' || d.state
     from app.jobs j join app.webhook_deliveries d on d.id=j.resource_id
    where j.id=(select job_id from a4_cases where case_name='expired_secret')),
  'dead|exhausted',
  'A4 terminal signing configuration failure dead-letters job and exhausts delivery'
);

-- Attempt ceiling uses the existing max_attempts=8 job contract.
update app.webhook_endpoints
   set secret_ciphertext='cipher-v6', secret_version=6,
       previous_secret_ciphertext=null, previous_secret_version=null, previous_secret_expires_at=null
 where id='a4100000-0000-0000-0000-000000000001'::uuid;
call pg_temp.a4_record_case('attempt_ceiling', 'a4200000-0000-0000-0000-000000000004'::uuid);
update app.jobs set attempt_count=7
 where id=(select job_id from a4_cases where case_name='attempt_ceiling');
update app.webhook_deliveries set attempt_count=7
 where id=(select delivery_id from a4_cases where case_name='attempt_ceiling');
call pg_temp.a4_capture_claim('attempt_eight_claim', 'a4-worker-one', 10, 30);
select is((select (result -> 0 ->> 'attemptNumber')::integer from a4_claims where capture_name='attempt_eight_claim'), 8,
  'A4 final allowed dispatch claim is attempt eight');
call pg_temp.a4_capture_resolve(
  'attempt_eight_retry',
  (select job_id from a4_cases where case_name='attempt_ceiling'),
  (select delivery_id from a4_cases where case_name='attempt_ceiling'),
  (select (result -> 0 ->> 'leaseToken')::uuid from a4_claims where capture_name='attempt_eight_claim'),
  'retry', 503, 'transient', 'http_503', 7200
);
select is((select resolved from a4_resolutions where capture_name='attempt_eight_retry'), true,
  'A4 attempt-eight retry request resolves deterministically at the database boundary');
select is(
  (select j.state || '|' || d.state
     from app.jobs j join app.webhook_deliveries d on d.id=j.resource_id
    where j.id=(select job_id from a4_cases where case_name='attempt_ceiling')),
  'dead|exhausted',
  'A4 retry request at attempt ceiling becomes dead/exhausted rather than pending'
);

select is((select count(*)::bigint from app.ledger_transactions), 0::bigint,
  'A4 delivery claim/resolve creates no ledger transaction');
select is((select count(*)::bigint from app.ledger_entries), 0::bigint,
  'A4 delivery claim/resolve creates no ledger entries');
select is((select count(*)::bigint from app.payments), 0::bigint,
  'A4 delivery claim/resolve creates or mutates no Payment resource in this isolated fixture');

select * from finish();
rollback;
