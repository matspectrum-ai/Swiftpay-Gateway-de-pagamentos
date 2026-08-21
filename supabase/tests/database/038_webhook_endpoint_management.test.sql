create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(10);

select has_column(
  'app', 'webhook_endpoints', 'revision',
  'A7 endpoint optimistic-concurrency revision must persist'
);

select has_column(
  'app', 'webhook_deliveries', 'endpoint_url_snapshot',
  'A7 durable delivery must snapshot target URL at fanout'
);

select has_table(
  'app', 'webhook_endpoint_secret_versions',
  'A7 must retain versioned signing-secret ciphertext history'
);

select has_function(
  'app', 'list_dashboard_webhook_endpoints',
  array['uuid','uuid','text'],
  'A7 member-scoped endpoint list routine must exist'
);

select has_function(
  'app', 'get_dashboard_webhook_endpoint',
  array['uuid','uuid','text','uuid'],
  'A7 member-scoped endpoint get routine must exist'
);

select has_function(
  'app', 'create_dashboard_webhook_endpoint',
  array['uuid','uuid','text','text','text','jsonb'],
  'A7 admin endpoint create routine must exist'
);

select has_function(
  'app', 'update_dashboard_webhook_endpoint',
  array['uuid','uuid','text','uuid','text','text','jsonb'],
  'A7 admin endpoint update routine must exist'
);

select has_function(
  'app', 'disable_dashboard_webhook_endpoint',
  array['uuid','uuid','text','uuid','text','text','jsonb'],
  'A7 admin endpoint disable routine must exist'
);

select has_function(
  'app', 'enable_dashboard_webhook_endpoint',
  array['uuid','uuid','text','uuid','text','text','jsonb'],
  'A7 admin endpoint re-enable routine must exist'
);

select has_function(
  'app', 'rotate_dashboard_webhook_endpoint_secret',
  array['uuid','uuid','text','uuid','text','text','jsonb'],
  'A7 admin secret-rotation routine must exist'
);

select * from finish();
rollback;
