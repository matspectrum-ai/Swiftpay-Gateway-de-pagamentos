create extension if not exists pgtap with schema extensions;

begin;
select plan(26);

select ok(
  exists (select 1 from pg_roles where rolname = 'swiftpay_api_runtime'),
  'K6 API runtime LOGIN role exists'
);

select ok(
  exists (select 1 from pg_roles where rolname = 'swiftpay_worker_runtime'),
  'K6 worker runtime LOGIN role exists'
);

select ok(
  coalesce((select rolcanlogin from pg_roles where rolname = 'swiftpay_api_runtime'), false),
  'API runtime can LOGIN'
);

select ok(
  coalesce((select rolcanlogin from pg_roles where rolname = 'swiftpay_worker_runtime'), false),
  'worker runtime can LOGIN'
);

select ok(
  coalesce((select not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
            from pg_roles where rolname = 'swiftpay_api_runtime'), false),
  'API runtime has no privileged role attributes'
);

select ok(
  coalesce((select not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
            from pg_roles where rolname = 'swiftpay_worker_runtime'), false),
  'worker runtime has no privileged role attributes'
);

select is(
  coalesce((
    select array_agg(parent.rolname order by parent.rolname)::text
    from pg_auth_members m
    join pg_roles member on member.oid = m.member
    join pg_roles parent on parent.oid = m.roleid
    where member.rolname = 'swiftpay_api_runtime'
  ), '{}'::text),
  '{swiftpay_api}'::text,
  'API runtime inherits exactly swiftpay_api'
);

select is(
  coalesce((
    select array_agg(parent.rolname order by parent.rolname)::text
    from pg_auth_members m
    join pg_roles member on member.oid = m.member
    join pg_roles parent on parent.oid = m.roleid
    where member.rolname = 'swiftpay_worker_runtime'
  ), '{}'::text),
  '{swiftpay_worker}'::text,
  'worker runtime inherits exactly swiftpay_worker'
);

select ok(has_schema_privilege('swiftpay_api_runtime', 'app', 'USAGE'), 'API runtime inherits app schema USAGE');
select ok(has_schema_privilege('swiftpay_worker_runtime', 'app', 'USAGE'), 'worker runtime inherits app schema USAGE');
select ok(not has_schema_privilege('swiftpay_api_runtime', 'app', 'CREATE'), 'API runtime cannot CREATE in app');
select ok(not has_schema_privilege('swiftpay_worker_runtime', 'app', 'CREATE'), 'worker runtime cannot CREATE in app');

select is(
  (select count(*)::integer
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner))) a
   join pg_roles r on r.oid = a.grantee
   where n.nspname = 'app' and r.rolname = 'swiftpay_api_runtime'),
  0,
  'API runtime has zero direct app relation/sequence ACL entries'
);

select is(
  (select count(*)::integer
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner))) a
   join pg_roles r on r.oid = a.grantee
   where n.nspname = 'app' and r.rolname = 'swiftpay_worker_runtime'),
  0,
  'worker runtime has zero direct app relation/sequence ACL entries'
);

select ok(
  has_function_privilege('swiftpay_api_runtime', 'app.require_dashboard_merchant_context(uuid,uuid,text,text)', 'EXECUTE'),
  'API runtime inherits dashboard context capability'
);
select ok(
  not has_function_privilege('swiftpay_worker_runtime', 'app.require_dashboard_merchant_context(uuid,uuid,text,text)', 'EXECUTE'),
  'worker runtime cannot execute dashboard context capability'
);
select ok(
  not has_function_privilege('swiftpay_api_runtime', 'app.claim_jobs(text,integer,integer)', 'EXECUTE'),
  'API runtime cannot claim worker jobs'
);
select ok(
  has_function_privilege('swiftpay_worker_runtime', 'app.claim_jobs(text,integer,integer)', 'EXECUTE'),
  'worker runtime inherits job claim capability'
);
select ok(
  not has_function_privilege('swiftpay_api_runtime', 'app.complete_job(uuid,uuid)', 'EXECUTE'),
  'API runtime cannot complete worker jobs'
);
select ok(
  has_function_privilege('swiftpay_worker_runtime', 'app.complete_job(uuid,uuid)', 'EXECUTE'),
  'worker runtime inherits job completion capability'
);
select ok(
  not has_function_privilege('swiftpay_api_runtime', 'app.reschedule_job(uuid,uuid,text,text,integer)', 'EXECUTE'),
  'API runtime cannot reschedule worker jobs'
);
select ok(
  has_function_privilege('swiftpay_worker_runtime', 'app.reschedule_job(uuid,uuid,text,text,integer)', 'EXECUTE'),
  'worker runtime inherits job reschedule capability'
);

select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in (
       'post_ledger_transaction', 'reserve_payout', 'reserve_refund',
       'prepare_payout_attempt', 'claim_payout_attempt', 'apply_payout_evidence',
       'apply_refund_evidence', 'record_provider_reconciliation_evidence', 'record_audit_event'
     )
     and has_function_privilege('swiftpay_api_runtime', p.oid, 'EXECUTE')),
  0,
  'API runtime inherits no current financial/provider/audit primitive'
);

select is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in (
       'post_ledger_transaction', 'reserve_payout', 'reserve_refund',
       'prepare_payout_attempt', 'claim_payout_attempt', 'apply_payout_evidence',
       'apply_refund_evidence', 'record_provider_reconciliation_evidence', 'record_audit_event'
     )
     and has_function_privilege('swiftpay_worker_runtime', p.oid, 'EXECUTE')),
  0,
  'worker runtime inherits no current financial/provider/audit primitive'
);

select ok(
  not has_table_privilege('swiftpay_api_runtime', 'app.payments', 'SELECT,INSERT,UPDATE,DELETE'),
  'API runtime has no direct/effective payment table DML'
);
select ok(
  not has_table_privilege('swiftpay_worker_runtime', 'app.payments', 'SELECT,INSERT,UPDATE,DELETE'),
  'worker runtime has no direct/effective payment table DML'
);

select is(
  (select count(*)::integer from app.payments),
  0,
  'K6 topology test creates no payment state'
);

select * from finish();
rollback;
