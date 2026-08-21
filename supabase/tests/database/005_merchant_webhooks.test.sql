create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(37);

select has_table('app', 'webhook_endpoints', 'merchant webhook endpoints must persist');
select has_table('app', 'webhook_events', 'logical merchant webhook events must persist');
select has_table('app', 'webhook_deliveries', 'endpoint deliveries must persist before HTTP execution');

select has_column('app', 'webhook_endpoints', 'merchant_id', 'endpoint merchant ownership must be explicit');
select has_column('app', 'webhook_endpoints', 'environment', 'endpoint environment must be explicit');
select has_column('app', 'webhook_endpoints', 'secret_ciphertext', 'signing secret material must be independent durable secret material');
select has_column('app', 'webhook_endpoints', 'secret_version', 'endpoint secret version must be explicit');
select has_column('app', 'webhook_endpoints', 'subscribed_events', 'endpoint event subscription set must persist');

select has_column('app', 'webhook_events', 'source_type', 'logical webhook source type must persist');
select has_column('app', 'webhook_events', 'source_id', 'logical webhook source id must persist');
select has_column('app', 'webhook_events', 'payload_version', 'public webhook payload version must persist');
select has_column('app', 'webhook_events', 'payload_snapshot', 'exact public payload snapshot must persist before delivery');

select has_column('app', 'webhook_deliveries', 'webhook_event_id', 'delivery must reference one logical event');
select has_column('app', 'webhook_deliveries', 'webhook_endpoint_id', 'delivery must reference one endpoint');
select has_column('app', 'webhook_deliveries', 'state', 'delivery state must be durable');
select has_column('app', 'webhook_deliveries', 'attempt_count', 'actual HTTP attempt count must be durable');
select has_column('app', 'webhook_deliveries', 'next_attempt_at', 'next retry time must be durable');
select has_column('app', 'webhook_deliveries', 'lease_token', 'delivery worker fencing token must persist');
select has_column('app', 'webhook_deliveries', 'lease_expires_at', 'delivery lease expiry must persist');
select has_column('app', 'webhook_deliveries', 'last_http_status', 'last observed HTTP status must persist');
select has_column('app', 'webhook_deliveries', 'succeeded_at', 'successful delivery time must persist');

select has_index('app', 'webhook_events', 'webhook_events_source_uq', 'duplicate canonical source cannot mint a second logical merchant event');
select has_index('app', 'webhook_deliveries', 'webhook_deliveries_event_endpoint_uq', 'one logical delivery row per event/endpoint must be enforced');
select has_index('app', 'webhook_endpoints', 'webhook_endpoints_active_idx', 'active endpoint fanout must have a targeted index');

select has_function(
  'app', 'record_webhook_event',
  array['uuid','text','text','text','uuid','text','uuid','text','jsonb','timestamp with time zone'],
  'trusted event persistence/fanout boundary must exist'
);

insert into app.merchants (id, name, lifecycle_status)
values ('00000000-0000-0000-0000-000000005001', 'Webhook Merchant', 'active');

select lives_ok(
  $$insert into app.webhook_endpoints (
      id, merchant_id, environment, url, status,
      secret_ciphertext, secret_version, subscribed_events
    ) values (
      '00000000-0000-0000-0000-000000005010',
      '00000000-0000-0000-0000-000000005001',
      'sandbox', 'https://merchant.example/webhooks', 'active',
      'ciphertext-not-a-resource-id', 1, '["payment.paid"]'::jsonb
    )$$,
  'a valid merchant endpoint with independent signing secret material can persist'
);

select lives_ok(
  $$select app.record_webhook_event(
      '00000000-0000-0000-0000-000000005001'::uuid,
      'sandbox',
      'payment.paid',
      'payment',
      '00000000-0000-0000-0000-000000005100'::uuid,
      'provider_event',
      '00000000-0000-0000-0000-000000005200'::uuid,
      '1',
      '{"id":"evt_public","object":"event","type":"payment.paid","data":{"id":"pay_public"}}'::jsonb,
      now()
    )$$,
  'recording one logical merchant event succeeds'
);

select is(
  (select count(*)::bigint from app.webhook_events
    where merchant_id='00000000-0000-0000-0000-000000005001'
      and source_type='provider_event'
      and source_id='00000000-0000-0000-0000-000000005200'),
  1::bigint,
  'WEBHOOK-004: canonical source creates exactly one logical event'
);

select is(
  (select count(*)::bigint from app.webhook_deliveries),
  1::bigint,
  'event fanout creates one durable delivery before HTTP execution'
);

select is(
  (select count(*)::bigint from app.jobs
    where kind='merchant_webhook_delivery'),
  1::bigint,
  'durable delivery creates one worker job before HTTP execution'
);

select is(
  (select attempt_count from app.webhook_deliveries limit 1),
  0,
  'persisting event/delivery records no HTTP attempt before worker execution'
);

select lives_ok(
  $$select app.record_webhook_event(
      '00000000-0000-0000-0000-000000005001'::uuid,
      'sandbox',
      'payment.paid',
      'payment',
      '00000000-0000-0000-0000-000000005100'::uuid,
      'provider_event',
      '00000000-0000-0000-0000-000000005200'::uuid,
      '1',
      '{"id":"evt_public","object":"event","type":"payment.paid","data":{"id":"pay_public"}}'::jsonb,
      now()
    )$$,
  're-recording identical canonical source is idempotent'
);

select is((select count(*)::bigint from app.webhook_events), 1::bigint, 'idempotent replay keeps one logical event');
select is((select count(*)::bigint from app.webhook_deliveries), 1::bigint, 'idempotent replay keeps one delivery');
select is((select count(*)::bigint from app.jobs where kind='merchant_webhook_delivery'), 1::bigint, 'idempotent replay keeps one delivery job');

select throws_ok(
  $$insert into app.webhook_endpoints (
      merchant_id, environment, url, status,
      secret_ciphertext, secret_version, subscribed_events
    ) values (
      '00000000-0000-0000-0000-000000005001',
      'sandbox', 'https://merchant.example/invalid', 'active',
      'ciphertext', 0, '[]'::jsonb
    )$$,
  '23514', null,
  'webhook secret version must be positive'
);

select throws_ok(
  $$update app.webhook_deliveries set attempt_count=-1$$,
  '23514', null,
  'delivery attempt count cannot become negative'
);

select * from finish();
rollback;
