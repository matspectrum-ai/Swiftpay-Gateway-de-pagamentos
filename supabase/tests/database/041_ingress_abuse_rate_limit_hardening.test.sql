create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(6);

select has_table(
  'app', 'api_abuse_windows',
  'A14 distributed abuse-window table must exist in private app schema'
);

select has_column(
  'app', 'api_abuse_windows', 'subject_hash',
  'A14 abuse state must persist only an opaque subject hash'
);

select has_index(
  'app', 'api_abuse_windows', 'api_abuse_windows_updated_at_idx',
  'A14 abuse state must have bounded-pruning updated_at index'
);

select has_function(
  'app', 'consume_api_abuse_quota', array['text','text'],
  'A14 trusted API quota routine must exist with exact signature'
);

select is(
  (
    select count(*)::integer
    from information_schema.routine_privileges
    where routine_schema = 'app'
      and routine_name = 'consume_api_abuse_quota'
      and grantee = 'swiftpay_api'
      and privilege_type = 'EXECUTE'
  ),
  1,
  'A14 swiftpay_api must receive exactly the quota routine EXECUTE capability'
);

select is(
  (
    select count(*)::integer
    from information_schema.routine_privileges
    where routine_schema = 'app'
      and routine_name = 'consume_api_abuse_quota'
      and grantee in ('PUBLIC','anon','authenticated','service_role','swiftpay_worker')
      and privilege_type = 'EXECUTE'
  ),
  0,
  'A14 quota routine must not be executable by public/Data API/service-role/worker identities'
);

select * from finish();
rollback;
