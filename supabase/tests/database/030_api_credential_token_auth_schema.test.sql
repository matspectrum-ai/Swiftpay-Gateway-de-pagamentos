create extension if not exists pgtap with schema extensions;

begin;
select plan(35);

select has_table('app', 'api_credential_token_windows', 'A1 token issuance window table exists');

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'api_credential_token_windows'
      and column_name = 'credential_id' and data_type = 'uuid' and is_nullable = 'NO'
  ),
  'A1 token window credential_id is required uuid'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'api_credential_token_windows'
      and column_name = 'window_started_at' and data_type = 'timestamp with time zone' and is_nullable = 'NO'
  ),
  'A1 token window start is required timestamptz'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'api_credential_token_windows'
      and column_name = 'issued_count' and data_type = 'integer' and is_nullable = 'NO'
  ),
  'A1 token window issued_count is required integer'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'app' and table_name = 'api_credential_token_windows'
      and column_name = 'updated_at' and data_type = 'timestamp with time zone' and is_nullable = 'NO'
  ),
  'A1 token window updated_at is required timestamptz'
);

select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and t.relname = 'api_credential_token_windows'
      and c.contype = 'p'
      and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (credential_id)'
  ),
  'A1 token window is keyed exactly by credential_id'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and t.relname = 'api_credential_token_windows'
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) like 'FOREIGN KEY (credential_id) REFERENCES app.api_credentials(id)%'
  ),
  'A1 token window credential references canonical API credential'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and t.relname = 'api_credential_token_windows'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%issued_count >= 0%'
  ),
  'A1 token window count cannot be negative'
);

select ok(to_regprocedure('app.lookup_api_credential_for_token(text)') is not null,
  'A1 credential lookup function exists');
select ok(to_regprocedure('app.consume_api_token_issuance(uuid)') is not null,
  'A1 issuance quota function exists');
select ok(to_regprocedure('app.get_api_credential_auth_state(uuid)') is not null,
  'A1 bearer revalidation function exists');

select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('app.lookup_api_credential_for_token(text)')), false),
  'A1 credential lookup is SECURITY DEFINER'
);
select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('app.consume_api_token_issuance(uuid)')), false),
  'A1 issuance quota is SECURITY DEFINER'
);
select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('app.get_api_credential_auth_state(uuid)')), false),
  'A1 bearer state lookup is SECURITY DEFINER'
);

select is(
  coalesce((select proconfig::text from pg_proc where oid = to_regprocedure('app.lookup_api_credential_for_token(text)')), ''),
  '{search_path=""}'::text,
  'A1 credential lookup fixes an empty search_path'
);
select is(
  coalesce((select proconfig::text from pg_proc where oid = to_regprocedure('app.consume_api_token_issuance(uuid)')), ''),
  '{search_path=""}'::text,
  'A1 issuance quota fixes an empty search_path'
);
select is(
  coalesce((select proconfig::text from pg_proc where oid = to_regprocedure('app.get_api_credential_auth_state(uuid)')), ''),
  '{search_path=""}'::text,
  'A1 bearer state lookup fixes an empty search_path'
);

select is(
  coalesce((select provolatile::text from pg_proc where oid = to_regprocedure('app.lookup_api_credential_for_token(text)')), ''),
  's',
  'A1 credential lookup is STABLE'
);
select is(
  coalesce((select provolatile::text from pg_proc where oid = to_regprocedure('app.consume_api_token_issuance(uuid)')), ''),
  'v',
  'A1 issuance quota is VOLATILE'
);
select is(
  coalesce((select provolatile::text from pg_proc where oid = to_regprocedure('app.get_api_credential_auth_state(uuid)')), ''),
  's',
  'A1 bearer state lookup is STABLE'
);

select ok(
  case when to_regprocedure('app.lookup_api_credential_for_token(text)') is null then false
       else has_function_privilege('swiftpay_api', to_regprocedure('app.lookup_api_credential_for_token(text)'), 'EXECUTE') end,
  'A1 swiftpay_api can execute credential lookup'
);
select ok(
  case when to_regprocedure('app.consume_api_token_issuance(uuid)') is null then false
       else has_function_privilege('swiftpay_api', to_regprocedure('app.consume_api_token_issuance(uuid)'), 'EXECUTE') end,
  'A1 swiftpay_api can execute issuance quota'
);
select ok(
  case when to_regprocedure('app.get_api_credential_auth_state(uuid)') is null then false
       else has_function_privilege('swiftpay_api', to_regprocedure('app.get_api_credential_auth_state(uuid)'), 'EXECUTE') end,
  'A1 swiftpay_api can execute bearer state lookup'
);

select ok(
  case when to_regprocedure('app.lookup_api_credential_for_token(text)') is null then true
       else not has_function_privilege('swiftpay_worker', to_regprocedure('app.lookup_api_credential_for_token(text)'), 'EXECUTE') end,
  'A1 worker cannot execute credential lookup'
);
select ok(
  case when to_regprocedure('app.consume_api_token_issuance(uuid)') is null then true
       else not has_function_privilege('swiftpay_worker', to_regprocedure('app.consume_api_token_issuance(uuid)'), 'EXECUTE') end,
  'A1 worker cannot execute issuance quota'
);
select ok(
  case when to_regprocedure('app.get_api_credential_auth_state(uuid)') is null then true
       else not has_function_privilege('swiftpay_worker', to_regprocedure('app.get_api_credential_auth_state(uuid)'), 'EXECUTE') end,
  'A1 worker cannot execute bearer state lookup'
);

select ok(
  case when to_regprocedure('app.lookup_api_credential_for_token(text)') is null then true
       else not has_function_privilege('anon', to_regprocedure('app.lookup_api_credential_for_token(text)'), 'EXECUTE')
        and not has_function_privilege('authenticated', to_regprocedure('app.lookup_api_credential_for_token(text)'), 'EXECUTE')
        and not has_function_privilege('service_role', to_regprocedure('app.lookup_api_credential_for_token(text)'), 'EXECUTE')
        and not has_function_privilege('public', to_regprocedure('app.lookup_api_credential_for_token(text)'), 'EXECUTE') end,
  'A1 Data API/PUBLIC cannot execute credential lookup'
);
select ok(
  case when to_regprocedure('app.consume_api_token_issuance(uuid)') is null then true
       else not has_function_privilege('anon', to_regprocedure('app.consume_api_token_issuance(uuid)'), 'EXECUTE')
        and not has_function_privilege('authenticated', to_regprocedure('app.consume_api_token_issuance(uuid)'), 'EXECUTE')
        and not has_function_privilege('service_role', to_regprocedure('app.consume_api_token_issuance(uuid)'), 'EXECUTE')
        and not has_function_privilege('public', to_regprocedure('app.consume_api_token_issuance(uuid)'), 'EXECUTE') end,
  'A1 Data API/PUBLIC cannot execute issuance quota'
);
select ok(
  case when to_regprocedure('app.get_api_credential_auth_state(uuid)') is null then true
       else not has_function_privilege('anon', to_regprocedure('app.get_api_credential_auth_state(uuid)'), 'EXECUTE')
        and not has_function_privilege('authenticated', to_regprocedure('app.get_api_credential_auth_state(uuid)'), 'EXECUTE')
        and not has_function_privilege('service_role', to_regprocedure('app.get_api_credential_auth_state(uuid)'), 'EXECUTE')
        and not has_function_privilege('public', to_regprocedure('app.get_api_credential_auth_state(uuid)'), 'EXECUTE') end,
  'A1 Data API/PUBLIC cannot execute bearer state lookup'
);

select ok(not has_table_privilege('swiftpay_api', 'app.api_credentials', 'SELECT,INSERT,UPDATE,DELETE'),
  'A1 swiftpay_api retains no direct API credential DML');
select ok(
  case when to_regclass('app.api_credential_token_windows') is null then true
       else not has_table_privilege('swiftpay_api', 'app.api_credential_token_windows', 'SELECT,INSERT,UPDATE,DELETE') end,
  'A1 swiftpay_api has no direct token-window DML'
);
select ok(not has_table_privilege('swiftpay_worker', 'app.api_credentials', 'SELECT,INSERT,UPDATE,DELETE'),
  'A1 worker retains no direct API credential DML');
select ok(
  case when to_regclass('app.api_credential_token_windows') is null then true
       else not has_table_privilege('swiftpay_worker', 'app.api_credential_token_windows', 'SELECT,INSERT,UPDATE,DELETE') end,
  'A1 worker has no direct token-window DML'
);

select is((select count(*) from app.payments), 0::bigint, 'A1 structural test creates no Payment state');
select is((select count(*) from app.ledger_transactions), 0::bigint, 'A1 structural test creates no ledger state');

select * from finish();
rollback;
