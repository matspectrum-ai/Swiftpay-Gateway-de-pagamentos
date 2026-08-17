create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(6);

select has_column(
  'app', 'api_credentials', 'revision',
  'A8 API credentials must persist positive optimistic-concurrency revision'
);

select has_function(
  'app', 'list_dashboard_api_credentials',
  array['uuid','uuid','text'],
  'A8 member-scoped credential list routine must exist with exact signature'
);

select has_function(
  'app', 'get_dashboard_api_credential',
  array['uuid','uuid','text','uuid'],
  'A8 member-scoped credential get routine must exist with exact signature'
);

select has_function(
  'app', 'create_dashboard_api_credential',
  array['uuid','uuid','text','text','text','jsonb'],
  'A8 privileged credential create routine must exist with exact signature'
);

select has_function(
  'app', 'rotate_dashboard_api_credential_secret',
  array['uuid','uuid','text','uuid','text','text','jsonb'],
  'A8 privileged credential rotation routine must exist with exact signature'
);

select has_function(
  'app', 'revoke_dashboard_api_credential',
  array['uuid','uuid','text','uuid','text','text','jsonb'],
  'A8 privileged credential revoke routine must exist with exact signature'
);

select * from finish();
rollback;
