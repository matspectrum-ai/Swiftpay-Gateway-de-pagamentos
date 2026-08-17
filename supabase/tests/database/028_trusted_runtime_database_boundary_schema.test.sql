create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(37);

-- Frozen trusted capability roles.
select ok(
    exists (select 1 from pg_catalog.pg_roles where rolname = 'swiftpay_api'),
    'swiftpay_api capability role exists'
);
select ok(
    exists (select 1 from pg_catalog.pg_roles where rolname = 'swiftpay_worker'),
    'swiftpay_worker capability role exists'
);
select ok(
    coalesce((
        select not rolcanlogin
           and not rolsuper
           and not rolcreatedb
           and not rolcreaterole
           and not rolreplication
           and not rolbypassrls
        from pg_catalog.pg_roles
        where rolname = 'swiftpay_api'
    ), false),
    'swiftpay_api is frozen as non-login non-privileged capability role'
);
select ok(
    coalesce((
        select not rolcanlogin
           and not rolsuper
           and not rolcreatedb
           and not rolcreaterole
           and not rolreplication
           and not rolbypassrls
        from pg_catalog.pg_roles
        where rolname = 'swiftpay_worker'
    ), false),
    'swiftpay_worker is frozen as non-login non-privileged capability role'
);

-- Supabase browser/service roles must never inherit trusted SwiftPay capabilities.
select ok(
    not exists (
        select 1
        from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles member_role on member_role.oid = m.member
        join pg_catalog.pg_roles granted_role on granted_role.oid = m.roleid
        where member_role.rolname in ('anon', 'authenticated', 'service_role')
          and granted_role.rolname in ('swiftpay_api', 'swiftpay_worker')
    ),
    'Data API and service roles are not members of trusted SwiftPay roles'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles member_role on member_role.oid = m.member
        join pg_catalog.pg_roles granted_role on granted_role.oid = m.roleid
        where (member_role.rolname = 'swiftpay_api' and granted_role.rolname = 'swiftpay_worker')
           or (member_role.rolname = 'swiftpay_worker' and granted_role.rolname = 'swiftpay_api')
    ),
    'trusted API and worker roles do not inherit each other'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_auth_members m
        join pg_catalog.pg_roles member_role on member_role.oid = m.member
        join pg_catalog.pg_roles granted_role on granted_role.oid = m.roleid
        where member_role.rolname in ('swiftpay_api', 'swiftpay_worker')
          and granted_role.rolname in ('postgres', 'service_role', 'supabase_admin')
    ),
    'trusted SwiftPay roles do not inherit privileged platform roles'
);

-- Trusted runtimes get schema USAGE only, never CREATE or direct relation/sequence capabilities.
select ok(
    exists (
        select 1
        from pg_catalog.pg_namespace n
        cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) acl
        where n.nspname = 'app'
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api')
          and acl.privilege_type = 'USAGE'
    ),
    'swiftpay_api has app schema USAGE'
);
select ok(
    exists (
        select 1
        from pg_catalog.pg_namespace n
        cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) acl
        where n.nspname = 'app'
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          and acl.privilege_type = 'USAGE'
    ),
    'swiftpay_worker has app schema USAGE'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_namespace n
        cross join lateral pg_catalog.aclexplode(coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) acl
        where n.nspname = 'app'
          and acl.grantee in (
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api'),
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          )
          and acl.privilege_type = 'CREATE'
    ),
    'trusted SwiftPay roles cannot CREATE in app schema'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
        where n.nspname = 'app'
          and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api')
          and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ),
    'swiftpay_api has no direct privilege on current app relations'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
        where n.nspname = 'app'
          and c.relkind in ('r', 'p', 'v', 'm', 'f')
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ),
    'swiftpay_worker has no direct privilege on current app relations'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('S', c.relowner))) acl
        where n.nspname = 'app'
          and c.relkind = 'S'
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api')
          and acl.privilege_type in ('USAGE', 'SELECT', 'UPDATE')
    ),
    'swiftpay_api has no direct privilege on current app sequences'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('S', c.relowner))) acl
        where n.nspname = 'app'
          and c.relkind = 'S'
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          and acl.privilege_type in ('USAGE', 'SELECT', 'UPDATE')
    ),
    'swiftpay_worker has no direct privilege on current app sequences'
);

-- Dashboard context remains the only raw dashboard authorization primitive exposed to API.
select ok(
    to_regprocedure('app.require_dashboard_merchant_context(uuid,uuid,text,text)') is not null,
    'dashboard merchant context helper frozen signature exists'
);
select is(
    (
        select pg_catalog.pg_get_function_result(p.oid)
        from pg_catalog.pg_proc p
        where p.oid = to_regprocedure('app.require_dashboard_merchant_context(uuid,uuid,text,text)')
    ),
    'TABLE(merchant_id uuid, environment text, membership_role text)',
    'dashboard context helper returns normalized merchant environment and actual role'
);
select ok(
    coalesce((
        select p.prosecdef
        from pg_catalog.pg_proc p
        where p.oid = to_regprocedure('app.require_dashboard_merchant_context(uuid,uuid,text,text)')
    ), false),
    'dashboard context helper is SECURITY DEFINER'
);
select ok(
    coalesce((
        select 'search_path=pg_catalog, app, auth' = any(p.proconfig)
        from pg_catalog.pg_proc p
        where p.oid = to_regprocedure('app.require_dashboard_merchant_context(uuid,uuid,text,text)')
    ), false),
    'dashboard context helper has fixed pg_catalog app auth search_path'
);
select ok(
    coalesce((
        select p.provolatile = 's'
        from pg_catalog.pg_proc p
        where p.oid = to_regprocedure('app.require_dashboard_merchant_context(uuid,uuid,text,text)')
    ), false),
    'dashboard context helper is STABLE'
);

-- Exact API allowlist after A8: K4 + A1 + A2 + A3 balance + A7 webhooks + five A8 credential RPCs.
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
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where n.nspname = 'app'
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api')
          and acl.privilege_type = 'EXECUTE'
    ), false),
    'swiftpay_api EXECUTE grants equal exact K4 A1 A2 A3-read A7 A8 allowlist'
);
select ok(
    exists (
        select 1
        from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where p.oid = to_regprocedure('app.require_dashboard_merchant_context(uuid,uuid,text,text)')
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api')
          and acl.privilege_type = 'EXECUTE'
    ),
    'swiftpay_api retains K4 dashboard context helper execution'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api')
          and acl.privilege_type = 'EXECUTE'
    ),
    'swiftpay_api does not receive raw K3 membership helper execution'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where p.oid = to_regprocedure('app.require_dashboard_merchant_context(uuid,uuid,text,text)')
          and acl.grantee in (
              0,
              (select oid from pg_catalog.pg_roles where rolname = 'anon'),
              (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
              (select oid from pg_catalog.pg_roles where rolname = 'service_role'),
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          )
          and acl.privilege_type = 'EXECUTE'
    ),
    'dashboard context helper is not executable by public Data API service or worker roles'
);

-- Exact worker allowlist after A4: generic lease lifecycle, A3 sandbox paid command,
-- and two narrow composed merchant-webhook delivery routines.
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
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where n.nspname = 'app'
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          and acl.privilege_type = 'EXECUTE'
    ), false),
    'swiftpay_worker EXECUTE grants equal A3 capabilities plus A4 composed webhook delivery boundary'
);
select ok(
    has_function_privilege('swiftpay_worker', 'app.claim_jobs(text,integer,integer)', 'EXECUTE'),
    'swiftpay_worker can execute claim_jobs'
);
select ok(
    has_function_privilege('swiftpay_worker', 'app.complete_job(uuid,uuid)', 'EXECUTE'),
    'swiftpay_worker can execute complete_job'
);
select ok(
    has_function_privilege('swiftpay_worker', 'app.reschedule_job(uuid,uuid,text,text,integer)', 'EXECUTE'),
    'swiftpay_worker can execute reschedule_job'
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
    'swiftpay_worker can execute A3 sandbox paid command'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where p.oid in (
            to_regprocedure('app.claim_jobs(text,integer,integer)'),
            to_regprocedure('app.complete_job(uuid,uuid)'),
            to_regprocedure('app.reschedule_job(uuid,uuid,text,text,integer)'),
            to_regprocedure('app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamptz)'),
            to_regprocedure('app.claim_merchant_webhook_deliveries(text,integer,integer)'),
            to_regprocedure('app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)')
        )
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api')
          and acl.privilege_type = 'EXECUTE'
    ),
    'swiftpay_api cannot execute worker-only lease simulator or webhook delivery functions'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where p.oid = to_regprocedure('app.require_merchant_membership(uuid,uuid,text)')
          and acl.grantee = (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          and acl.privilege_type = 'EXECUTE'
    ),
    'swiftpay_worker cannot execute raw K3 membership helper'
);

-- Sensitive financial/evidence primitives remain internal implementation details.
select ok(
    not exists (
        select 1
        from pg_catalog.pg_proc p
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where p.oid in (
            to_regprocedure('app.ensure_account(uuid,uuid,text,text,text)'),
            to_regprocedure('app.post_ledger_transaction(text,text,uuid,text,jsonb)'),
            to_regprocedure('app.record_webhook_event(uuid,text,text,text,uuid,text,uuid,text,jsonb,timestamptz)'),
            to_regprocedure('app.enqueue_job(text,text,uuid,text,jsonb,integer,integer,timestamptz)'),
            to_regprocedure('app.reserve_payout(uuid,text,text,bigint,bigint,jsonb,text,text,text,timestamptz)'),
            to_regprocedure('app.reserve_refund(uuid,uuid,text,bigint,text,text,timestamptz)'),
            to_regprocedure('app.prepare_payout_attempt(uuid,uuid,uuid,text,text,timestamptz)'),
            to_regprocedure('app.claim_payout_attempt(uuid,timestamptz,timestamptz)'),
            to_regprocedure('app.apply_payout_evidence(uuid)'),
            to_regprocedure('app.apply_refund_evidence(uuid)'),
            to_regprocedure('app.record_provider_reconciliation_evidence(uuid,uuid,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint,timestamptz,timestamptz,text,text,timestamptz)'),
            to_regprocedure('app.record_audit_event(text,text,text,integer,text,text,uuid,text,text,text,text,text,text,text,jsonb,timestamptz)')
        )
          and acl.grantee in (
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api'),
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          )
          and acl.privilege_type = 'EXECUTE'
    ),
    'trusted runtimes receive no raw financial webhook provider reconciliation or audit mutation primitive'
);

-- Future app objects must remain explicit opt-in even for trusted roles.
create table app.__k4_acl_probe_table (id bigint primary key);
create sequence app.__k4_acl_probe_sequence;
create function app.__k4_acl_probe_function()
returns integer
language sql
set search_path = pg_catalog
as $$ select 1 $$;

select ok(
    not exists (
        select 1
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) acl
        where n.nspname = 'app'
          and c.relname = '__k4_acl_probe_table'
          and acl.grantee in (
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api'),
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          )
          and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ),
    'future app tables do not inherit trusted runtime privileges'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('S', c.relowner))) acl
        where n.nspname = 'app'
          and c.relname = '__k4_acl_probe_sequence'
          and acl.grantee in (
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api'),
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          )
          and acl.privilege_type in ('USAGE', 'SELECT', 'UPDATE')
    ),
    'future app sequences do not inherit trusted runtime privileges'
);
select ok(
    not exists (
        select 1
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where n.nspname = 'app'
          and p.proname = '__k4_acl_probe_function'
          and acl.grantee in (
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_api'),
              (select oid from pg_catalog.pg_roles where rolname = 'swiftpay_worker')
          )
          and acl.privilege_type = 'EXECUTE'
    ),
    'future app routines do not inherit trusted runtime EXECUTE'
);

-- Existing Supabase service role boundary remains unchanged.
select ok(not has_schema_privilege('service_role', 'app', 'USAGE'), 'service_role still has no app schema USAGE');
select ok(not has_table_privilege('service_role', 'app.merchants', 'SELECT'), 'service_role still cannot read app tables directly');
select ok(not has_function_privilege('service_role', 'app.require_merchant_membership(uuid,uuid,text)', 'EXECUTE'), 'service_role still cannot execute K3 membership helper');

select * from finish();
rollback;
