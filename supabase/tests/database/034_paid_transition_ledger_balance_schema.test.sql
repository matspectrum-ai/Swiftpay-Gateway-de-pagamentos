create extension if not exists pgtap with schema extensions;

begin;
select plan(25);

select has_column(
  'app', 'payments', 'settlement_policy_version',
  'A3 Payment snapshots settlement policy version'
);
select col_type_is(
  'app', 'payments', 'settlement_policy_version', 'text',
  'A3 settlement policy snapshot is text'
);
select is(
  coalesce((
    select is_nullable
    from information_schema.columns
    where table_schema = 'app'
      and table_name = 'payments'
      and column_name = 'settlement_policy_version'
  ), ''),
  'YES',
  'A3 settlement policy column remains nullable for non-A3/legacy rows'
);

select ok(
  to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)') is not null,
  'A3 trusted sandbox paid-evidence routine exists'
);
select ok(
  to_regprocedure('app.get_api_balance(uuid,text)') is not null,
  'A3 trusted merchant balance read routine exists'
);

select ok(
  coalesce((
    select prosecdef
    from pg_proc
    where oid = to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)')
  ), false),
  'A3 paid-evidence routine is SECURITY DEFINER'
);
select ok(
  coalesce((
    select prosecdef
    from pg_proc
    where oid = to_regprocedure('app.get_api_balance(uuid,text)')
  ), false),
  'A3 balance read routine is SECURITY DEFINER'
);

select is(
  coalesce((
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid = to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)')
  ), ''),
  'search_path=""'::text,
  'A3 paid-evidence routine fixes an empty search_path'
);
select is(
  coalesce((
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid = to_regprocedure('app.get_api_balance(uuid,text)')
  ), ''),
  'search_path=""'::text,
  'A3 balance routine fixes an empty search_path'
);

select is(
  coalesce((
    select provolatile::text
    from pg_proc
    where oid = to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)')
  ), ''),
  'v',
  'A3 paid-evidence routine is VOLATILE'
);
select is(
  coalesce((
    select provolatile::text
    from pg_proc
    where oid = to_regprocedure('app.get_api_balance(uuid,text)')
  ), ''),
  's',
  'A3 balance routine is STABLE'
);
select is(
  coalesce((
    select pg_get_function_result(oid)
    from pg_proc
    where oid = to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)')
  ), ''),
  'jsonb',
  'A3 paid-evidence routine returns jsonb'
);
select is(
  coalesce((
    select pg_get_function_result(oid)
    from pg_proc
    where oid = to_regprocedure('app.get_api_balance(uuid,text)')
  ), ''),
  'jsonb',
  'A3 balance routine returns jsonb'
);

select ok(
  case
    when to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)') is null then false
    else has_function_privilege(
      'swiftpay_worker',
      to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)'),
      'EXECUTE'
    )
  end,
  'A3 swiftpay_worker can execute the composed sandbox paid-evidence command'
);
select ok(
  case
    when to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)') is null then true
    else not has_function_privilege(
      'swiftpay_api',
      to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)'),
      'EXECUTE'
    )
  end,
  'A3 merchant API cannot mark a Payment paid'
);
select ok(
  case
    when to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)') is null then true
    else not has_function_privilege('anon', to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)'), 'EXECUTE')
      and not has_function_privilege('authenticated', to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)'), 'EXECUTE')
      and not has_function_privilege('service_role', to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)'), 'EXECUTE')
      and not has_function_privilege('public', to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)'), 'EXECUTE')
  end,
  'A3 public Data API/service roles cannot execute paid evidence'
);

select ok(
  case
    when to_regprocedure('app.get_api_balance(uuid,text)') is null then false
    else has_function_privilege(
      'swiftpay_api',
      to_regprocedure('app.get_api_balance(uuid,text)'),
      'EXECUTE'
    )
  end,
  'A3 swiftpay_api can execute merchant-scoped balance read'
);
select ok(
  case
    when to_regprocedure('app.get_api_balance(uuid,text)') is null then true
    else not has_function_privilege('swiftpay_worker', to_regprocedure('app.get_api_balance(uuid,text)'), 'EXECUTE')
  end,
  'A3 worker cannot execute merchant API balance read'
);
select ok(
  case
    when to_regprocedure('app.get_api_balance(uuid,text)') is null then true
    else not has_function_privilege('anon', to_regprocedure('app.get_api_balance(uuid,text)'), 'EXECUTE')
      and not has_function_privilege('authenticated', to_regprocedure('app.get_api_balance(uuid,text)'), 'EXECUTE')
      and not has_function_privilege('service_role', to_regprocedure('app.get_api_balance(uuid,text)'), 'EXECUTE')
      and not has_function_privilege('public', to_regprocedure('app.get_api_balance(uuid,text)'), 'EXECUTE')
  end,
  'A3 public Data API/service roles cannot execute balance read'
);

select ok(
  coalesce((
    select count(*) = 21
      and bool_and(p.oid = any(array[
        to_regprocedure('app.require_dashboard_merchant_context(uuid,uuid,text,text)')::oid,
        to_regprocedure('app.lookup_api_credential_for_token(text)')::oid,
        to_regprocedure('app.consume_api_token_issuance(uuid)')::oid,
        to_regprocedure('app.get_api_credential_auth_state(uuid)')::oid,
        to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)')::oid,
        to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)')::oid,
        to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)')::oid,
        to_regprocedure('app.get_api_payment(uuid,text,uuid)')::oid,
        to_regprocedure('app.get_api_balance(uuid,text)')::oid,
        to_regprocedure('app.list_dashboard_webhook_endpoints(uuid,uuid,text)')::oid,
        to_regprocedure('app.get_dashboard_webhook_endpoint(uuid,uuid,text,uuid)')::oid,
        to_regprocedure('app.create_dashboard_webhook_endpoint(uuid,uuid,text,text,text,jsonb)')::oid,
        to_regprocedure('app.update_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)')::oid,
        to_regprocedure('app.disable_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)')::oid,
        to_regprocedure('app.enable_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)')::oid,
        to_regprocedure('app.rotate_dashboard_webhook_endpoint_secret(uuid,uuid,text,uuid,text,text,jsonb)')::oid,
        to_regprocedure('app.list_dashboard_api_credentials(uuid,uuid,text)')::oid,
        to_regprocedure('app.get_dashboard_api_credential(uuid,uuid,text,uuid)')::oid,
        to_regprocedure('app.create_dashboard_api_credential(uuid,uuid,text,text,text,jsonb)')::oid,
        to_regprocedure('app.rotate_dashboard_api_credential_secret(uuid,uuid,text,uuid,text,text,jsonb)')::oid,
        to_regprocedure('app.revoke_dashboard_api_credential(uuid,uuid,text,uuid,text,text,jsonb)')::oid
      ]::oid[]))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname = 'app'
      and acl.grantee = (select oid from pg_roles where rolname = 'swiftpay_api')
      and acl.privilege_type = 'EXECUTE'
  ), false),
  'A3 financial read remains inside the exact A8 twenty-one-routine API allowlist'
);

select ok(
  coalesce((
    select count(*) = 6
      and bool_and(p.oid = any(array[
        to_regprocedure('app.claim_jobs(text,integer,integer)')::oid,
        to_regprocedure('app.complete_job(uuid,uuid)')::oid,
        to_regprocedure('app.reschedule_job(uuid,uuid,text,text,integer)')::oid,
        to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)')::oid,
        to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)')::oid,
        to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)')::oid
      ]::oid[]))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname = 'app'
      and acl.grantee = (select oid from pg_roles where rolname = 'swiftpay_worker')
      and acl.privilege_type = 'EXECUTE'
  ), false),
  'A3 paid capability remains present inside the exact A4 six-routine worker allowlist'
);

select ok(
  not has_function_privilege('swiftpay_api', 'app.ensure_account(uuid,uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('swiftpay_worker', 'app.ensure_account(uuid,uuid,text,text,text)', 'EXECUTE'),
  'A3 raw ensure_account remains unavailable to both runtime capability roles'
);
select ok(
  not has_function_privilege('swiftpay_api', 'app.post_ledger_transaction(text,text,uuid,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('swiftpay_worker', 'app.post_ledger_transaction(text,text,uuid,text,jsonb)', 'EXECUTE'),
  'A3 raw post_ledger_transaction remains unavailable to both runtime capability roles'
);
select ok(
  not has_function_privilege(
    'swiftpay_api',
    'app.record_webhook_event(uuid,text,text,text,uuid,text,uuid,text,jsonb,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'swiftpay_worker',
    'app.record_webhook_event(uuid,text,text,text,uuid,text,uuid,text,jsonb,timestamp with time zone)',
    'EXECUTE'
  ),
  'A3 raw record_webhook_event remains unavailable to both runtime capability roles'
);

select ok(
  not has_table_privilege('swiftpay_api', 'app.accounts', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_api', 'app.ledger_transactions', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_api', 'app.ledger_entries', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_api', 'app.provider_events', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_api', 'app.webhook_events', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.accounts', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.ledger_transactions', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.ledger_entries', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.provider_events', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.webhook_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'A3 runtime roles retain zero direct DML over financial/evidence/outbox tables'
);

select * from finish();
rollback;
