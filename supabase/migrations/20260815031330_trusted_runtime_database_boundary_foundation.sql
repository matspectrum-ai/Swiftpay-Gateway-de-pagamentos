-- SwiftPay V2 Phase 2 / K4: trusted runtime database boundary foundation.
--
-- These are NOLOGIN capability roles. Production LOGIN identities/passwords are
-- deployment concerns deferred to K6 and must never be committed in migrations.
-- K4 intentionally grants only schema USAGE plus an exact routine allowlist.

create role swiftpay_api
    nologin
    nosuperuser
    nocreatedb
    nocreaterole
    noreplication
    nobypassrls;

create role swiftpay_worker
    nologin
    nosuperuser
    nocreatedb
    nocreaterole
    noreplication
    nobypassrls;

-- Trusted runtimes may resolve explicitly granted routines in app, but may not
-- create objects or access canonical tables/sequences directly.
grant usage on schema app to swiftpay_api, swiftpay_worker;
revoke create on schema app from swiftpay_api, swiftpay_worker;

revoke all privileges on all tables in schema app
    from swiftpay_api, swiftpay_worker;

revoke all privileges on all sequences in schema app
    from swiftpay_api, swiftpay_worker;

-- Start from an empty executable surface, then grant only the frozen K4 list.
revoke all privileges on all routines in schema app
    from swiftpay_api, swiftpay_worker;

-- Defense in depth for future postgres-owned app objects. Future capabilities
-- remain explicit opt-in migrations rather than implicit default privileges.
alter default privileges for role postgres in schema app
    revoke all privileges on tables from swiftpay_api, swiftpay_worker;

alter default privileges for role postgres in schema app
    revoke all privileges on sequences from swiftpay_api, swiftpay_worker;

alter default privileges for role postgres in schema app
    revoke execute on routines from swiftpay_api, swiftpay_worker;

-- Structural K4 boundary only. Behavioral authorization is deliberately left
-- unimplemented so the next pgTAP slice can establish a real behavioral RED.
create function app.require_dashboard_merchant_context(
    p_user_id uuid,
    p_merchant_id uuid,
    p_environment text,
    p_required_role text
)
returns table (
    merchant_id uuid,
    environment text,
    membership_role text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, app, auth
as $$
begin
    raise exception 'K4 dashboard merchant context behavior not implemented'
        using errcode = '0A000';
end;
$$;

-- The API gets only the composed K4 dashboard context boundary. It does not get
-- the raw K3 helper or any financial/provider/reconciliation primitive.
revoke all on function app.require_dashboard_merchant_context(uuid, uuid, text, text)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

grant execute on function app.require_dashboard_merchant_context(uuid, uuid, text, text)
    to swiftpay_api;

revoke execute on function app.require_merchant_membership(uuid, uuid, text)
    from swiftpay_api, swiftpay_worker;

-- The worker receives only the already-proven lease lifecycle. enqueue_job and
-- all domain/financial routines remain outside this baseline capability role.
grant execute on function app.claim_jobs(text, integer, integer)
    to swiftpay_worker;

grant execute on function app.complete_job(uuid, uuid)
    to swiftpay_worker;

grant execute on function app.reschedule_job(uuid, uuid, text, text, integer)
    to swiftpay_worker;

revoke execute on function app.claim_jobs(text, integer, integer)
    from swiftpay_api;
revoke execute on function app.complete_job(uuid, uuid)
    from swiftpay_api;
revoke execute on function app.reschedule_job(uuid, uuid, text, text, integer)
    from swiftpay_api;
