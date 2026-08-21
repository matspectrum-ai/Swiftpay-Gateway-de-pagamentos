create extension if not exists pgtap with schema extensions;

begin;
select plan(42);

select has_column('app', 'payments', 'fee_mode', 'A2 Payment snapshots fee_mode');
select has_column('app', 'payments', 'fee_fixed_cents', 'A2 Payment snapshots fixed fee cents');
select has_column('app', 'payments', 'fee_basis_points', 'A2 Payment snapshots fee basis points');
select has_column('app', 'payments', 'fee_percentage_component_cents', 'A2 Payment snapshots percentage fee component');
select has_column('app', 'payments', 'routing_policy_version', 'A2 Payment snapshots routing policy version');
select has_column('app', 'provider_attempts', 'recovery_required_at', 'A2 ProviderAttempt can mark recovery-required time');

select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and t.relname = 'payments' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%fee_fixed_cents%>= 0%'
  ),
  'A2 fixed fee snapshot cannot be negative'
);
select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and t.relname = 'payments' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%fee_basis_points%>= 0%'
  ),
  'A2 basis-point snapshot cannot be negative'
);
select ok(
  exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'app' and t.relname = 'payments' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%fee_percentage_component_cents%>= 0%'
  ),
  'A2 percentage fee component snapshot cannot be negative'
);

select ok(to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)') is not null,
  'A2 prepare Payment routine exists');
select ok(to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)') is not null,
  'A2 claim ProviderAttempt routine exists');
select ok(to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)') is not null,
  'A2 resolve ProviderAttempt routine exists');
select ok(to_regprocedure('app.get_api_payment(uuid,text,uuid)') is not null,
  'A2 merchant-scoped Payment read routine exists');

select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)')), false),
  'A2 prepare routine is SECURITY DEFINER'
);
select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)')), false),
  'A2 claim routine is SECURITY DEFINER'
);
select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)')), false),
  'A2 resolve routine is SECURITY DEFINER'
);
select ok(
  coalesce((select prosecdef from pg_proc where oid = to_regprocedure('app.get_api_payment(uuid,text,uuid)')), false),
  'A2 get routine is SECURITY DEFINER'
);

select is(
  coalesce((select array_to_string(proconfig, ',') from pg_proc where oid = to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)')), ''),
  'search_path=""'::text,
  'A2 prepare routine fixes an empty search_path'
);
select is(
  coalesce((select array_to_string(proconfig, ',') from pg_proc where oid = to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)')), ''),
  'search_path=""'::text,
  'A2 claim routine fixes an empty search_path'
);
select is(
  coalesce((select array_to_string(proconfig, ',') from pg_proc where oid = to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)')), ''),
  'search_path=""'::text,
  'A2 resolve routine fixes an empty search_path'
);
select is(
  coalesce((select array_to_string(proconfig, ',') from pg_proc where oid = to_regprocedure('app.get_api_payment(uuid,text,uuid)')), ''),
  'search_path=""'::text,
  'A2 get routine fixes an empty search_path'
);

select is(
  coalesce((select provolatile::text from pg_proc where oid = to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)')), ''),
  'v',
  'A2 prepare routine is VOLATILE'
);
select is(
  coalesce((select provolatile::text from pg_proc where oid = to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)')), ''),
  'v',
  'A2 claim routine is VOLATILE'
);
select is(
  coalesce((select provolatile::text from pg_proc where oid = to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)')), ''),
  'v',
  'A2 resolve routine is VOLATILE'
);
select is(
  coalesce((select provolatile::text from pg_proc where oid = to_regprocedure('app.get_api_payment(uuid,text,uuid)')), ''),
  's',
  'A2 get routine is STABLE'
);

select ok(
  case when to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)') is null then false
       else has_function_privilege('swiftpay_api', to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)'), 'EXECUTE') end,
  'A2 swiftpay_api can execute prepare routine'
);
select ok(
  case when to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)') is null then false
       else has_function_privilege('swiftpay_api', to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)'), 'EXECUTE') end,
  'A2 swiftpay_api can execute claim routine'
);
select ok(
  case when to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)') is null then false
       else has_function_privilege('swiftpay_api', to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)'), 'EXECUTE') end,
  'A2 swiftpay_api can execute resolve routine'
);
select ok(
  case when to_regprocedure('app.get_api_payment(uuid,text,uuid)') is null then false
       else has_function_privilege('swiftpay_api', to_regprocedure('app.get_api_payment(uuid,text,uuid)'), 'EXECUTE') end,
  'A2 swiftpay_api can execute get routine'
);

select ok(
  case when to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)') is null then true
       else not has_function_privilege('swiftpay_worker', to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)'), 'EXECUTE') end,
  'A2 worker cannot execute prepare routine'
);
select ok(
  case when to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)') is null then true
       else not has_function_privilege('swiftpay_worker', to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)'), 'EXECUTE') end,
  'A2 worker cannot execute claim routine'
);
select ok(
  case when to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)') is null then true
       else not has_function_privilege('swiftpay_worker', to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)'), 'EXECUTE') end,
  'A2 worker cannot execute resolve routine'
);
select ok(
  case when to_regprocedure('app.get_api_payment(uuid,text,uuid)') is null then true
       else not has_function_privilege('swiftpay_worker', to_regprocedure('app.get_api_payment(uuid,text,uuid)'), 'EXECUTE') end,
  'A2 worker cannot execute get routine'
);

select ok(
  case when to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)') is null then true
       else not has_function_privilege('anon', to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)'), 'EXECUTE')
        and not has_function_privilege('authenticated', to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)'), 'EXECUTE')
        and not has_function_privilege('service_role', to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)'), 'EXECUTE')
        and not has_function_privilege('public', to_regprocedure('app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)'), 'EXECUTE') end,
  'A2 Data API/PUBLIC cannot execute prepare routine'
);
select ok(
  case when to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)') is null then true
       else not has_function_privilege('anon', to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)'), 'EXECUTE')
        and not has_function_privilege('authenticated', to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)'), 'EXECUTE')
        and not has_function_privilege('service_role', to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)'), 'EXECUTE')
        and not has_function_privilege('public', to_regprocedure('app.claim_api_pix_attempt(uuid,text,uuid,uuid)'), 'EXECUTE') end,
  'A2 Data API/PUBLIC cannot execute claim routine'
);
select ok(
  case when to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)') is null then true
       else not has_function_privilege('anon', to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)'), 'EXECUTE')
        and not has_function_privilege('authenticated', to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)'), 'EXECUTE')
        and not has_function_privilege('service_role', to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)'), 'EXECUTE')
        and not has_function_privilege('public', to_regprocedure('app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)'), 'EXECUTE') end,
  'A2 Data API/PUBLIC cannot execute resolve routine'
);
select ok(
  case when to_regprocedure('app.get_api_payment(uuid,text,uuid)') is null then true
       else not has_function_privilege('anon', to_regprocedure('app.get_api_payment(uuid,text,uuid)'), 'EXECUTE')
        and not has_function_privilege('authenticated', to_regprocedure('app.get_api_payment(uuid,text,uuid)'), 'EXECUTE')
        and not has_function_privilege('service_role', to_regprocedure('app.get_api_payment(uuid,text,uuid)'), 'EXECUTE')
        and not has_function_privilege('public', to_regprocedure('app.get_api_payment(uuid,text,uuid)'), 'EXECUTE') end,
  'A2 Data API/PUBLIC cannot execute get routine'
);

select ok(
  not has_table_privilege('swiftpay_api', 'app.request_idempotency', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_api', 'app.payments', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_api', 'app.provider_attempts', 'SELECT,INSERT,UPDATE,DELETE'),
  'A2 swiftpay_api retains no direct idempotency/payment/attempt DML'
);
select ok(
  not has_table_privilege('swiftpay_worker', 'app.request_idempotency', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.payments', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('swiftpay_worker', 'app.provider_attempts', 'SELECT,INSERT,UPDATE,DELETE'),
  'A2 worker retains no direct idempotency/payment/attempt DML'
);

select is((select count(*) from app.ledger_transactions), 0::bigint,
  'A2 structural test creates no ledger transaction state');
select is((select count(*) from app.jobs), 0::bigint,
  'A2 structural test creates no job state');
select is((select count(*) from app.webhook_events), 0::bigint,
  'A2 structural test creates no merchant webhook event state');

select * from finish();
rollback;
