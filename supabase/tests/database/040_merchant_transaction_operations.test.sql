create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(4);

select has_function(
  'app', 'list_dashboard_transactions',
  array['uuid','uuid','text','text','text','timestamp with time zone','timestamp with time zone','timestamp with time zone','uuid','integer'],
  'A9 transaction list routine must exist with exact signature'
);

select has_function(
  'app', 'get_dashboard_transaction',
  array['uuid','uuid','text','uuid'],
  'A9 transaction detail routine must exist with exact signature'
);

select has_index(
  'app', 'payments', 'payments_dashboard_status_created_idx',
  'A9 status-filter keyset index must exist'
);

select has_index(
  'app', 'payments', 'payments_dashboard_external_id_created_idx',
  'A9 externalId keyset expression index must exist'
);

select * from finish();
rollback;