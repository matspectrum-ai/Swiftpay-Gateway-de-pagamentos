create extension if not exists pgtap with schema extensions;

begin;
select plan(25);

select has_column(
  'app', 'webhook_deliveries', 'signing_secret_version',
  'A4 delivery snapshots signing-secret version'
);
select col_type_is(
  'app', 'webhook_deliveries', 'signing_secret_version', 'integer',
  'A4 signing-secret snapshot is an integer version'
);
select col_not_null(
  'app', 'webhook_deliveries', 'signing_secret_version',
  'A4 signing-secret snapshot is mandatory after migration backfill'
);
select has_constraint(
  'app', 'webhook_deliveries', 'webhook_deliveries_signing_secret_version_ck',
  'A4 signing-secret version must have an explicit positive constraint'
);
select has_column(
  'app', 'webhook_deliveries', 'last_error_code',
  'A4 delivery persists bounded structured failure code'
);
select col_type_is(
  'app', 'webhook_deliveries', 'last_error_code', 'text',
  'A4 delivery failure code is text'
);

select ok(
  to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)') is not null,
  'A4 composed merchant webhook claim routine exists'
);
select ok(
  to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)') is not null,
  'A4 composed merchant webhook resolution routine exists'
);

select ok(
  coalesce((
    select prosecdef
    from pg_proc
    where oid = to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)')
  ), false),
  'A4 composed claim is SECURITY DEFINER'
);
select ok(
  coalesce((
    select prosecdef
    from pg_proc
    where oid = to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)')
  ), false),
  'A4 composed resolution is SECURITY DEFINER'
);
select is(
  coalesce((
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid = to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)')
  ), ''),
  'search_path=""'::text,
  'A4 composed claim fixes empty search_path'
);
select is(
  coalesce((
    select array_to_string(proconfig, ',')
    from pg_proc
    where oid = to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)')
  ), ''),
  'search_path=""'::text,
  'A4 composed resolution fixes empty search_path'
);
select is(
  coalesce((
    select pg_get_function_result(oid)
    from pg_proc
    where oid = to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)')
  ), ''),
  'SETOF jsonb',
  'A4 composed claim returns an internal JSON projection set'
);
select is(
  coalesce((
    select pg_get_function_result(oid)
    from pg_proc
    where oid = to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)')
  ), ''),
  'boolean',
  'A4 composed resolution returns fenced success boolean'
);

select ok(
  case
    when to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)') is null then false
    else has_function_privilege(
      'swiftpay_worker',
      to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)'),
      'EXECUTE'
    )
  end,
  'A4 swiftpay_worker may execute composed webhook claims'
);
select ok(
  case
    when to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)') is null then false
    else has_function_privilege(
      'swiftpay_worker',
      to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)'),
      'EXECUTE'
    )
  end,
  'A4 swiftpay_worker may execute composed webhook resolution'
);

select ok(
  case
    when to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)') is null then true
    else not has_function_privilege('swiftpay_api', to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)'), 'EXECUTE')
      and not has_function_privilege('anon', to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)'), 'EXECUTE')
      and not has_function_privilege('authenticated', to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)'), 'EXECUTE')
      and not has_function_privilege('service_role', to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)'), 'EXECUTE')
      and not has_function_privilege('public', to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)'), 'EXECUTE')
  end,
  'A4 composed claims are unavailable to API/Data API/service/public roles'
);
select ok(
  case
    when to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)') is null then true
    else not has_function_privilege('swiftpay_api', to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)'), 'EXECUTE')
      and not has_function_privilege('anon', to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)'), 'EXECUTE')
      and not has_function_privilege('authenticated', to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)'), 'EXECUTE')
      and not has_function_privilege('service_role', to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)'), 'EXECUTE')
      and not has_function_privilege('public', to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)'), 'EXECUTE')
  end,
  'A4 composed resolution is unavailable to API/Data API/service/public roles'
);

select ok(
  not has_table_privilege('swiftpay_worker', 'app.webhook_endpoints', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.webhook_events', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.webhook_deliveries', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.jobs', 'SELECT,INSERT,UPDATE,DELETE'),
  'A4 worker retains zero direct webhook/job table DML authority'
);
select ok(
  not has_table_privilege('swiftpay_api', 'app.webhook_endpoints', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_api', 'app.webhook_events', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_api', 'app.webhook_deliveries', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_api', 'app.jobs', 'SELECT,INSERT,UPDATE,DELETE'),
  'A4 API retains zero direct webhook/job table DML authority'
);

select ok(
  not has_function_privilege(
    'swiftpay_worker',
    'app.record_webhook_event(uuid,text,text,text,uuid,text,uuid,text,jsonb,timestamp with time zone)',
    'EXECUTE'
  ),
  'A4 worker cannot mint arbitrary logical merchant events'
);
select ok(
  not has_function_privilege('swiftpay_worker', 'app.ensure_account(uuid,uuid,text,text,text)', 'EXECUTE')
  and not has_function_privilege('swiftpay_worker', 'app.post_ledger_transaction(text,text,uuid,text,jsonb)', 'EXECUTE'),
  'A4 worker has no raw financial posting capability'
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
  'A4 swiftpay_worker EXECUTE allowlist adds only two composed webhook routines'
);

select is(
  coalesce((
    select count(*)::integer
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname='app'
      and t.relname='webhook_deliveries'
      and c.conname='webhook_deliveries_signing_secret_version_ck'
  ), 0),
  1,
  'A4 signing-secret-version check has one canonical named constraint'
);

select has_constraint(
  'app', 'webhook_deliveries', 'webhook_deliveries_last_error_code_length_ck',
  'A4 stored delivery error code has a canonical bounded-length constraint'
);

select * from finish();
rollback;
