-- SwiftPay V2 Phase 2 / K4: trusted runtime database boundary behavior.
--
-- This migration implements only the composed dashboard merchant/environment
-- context helper frozen in K4. It intentionally does not add any new grants,
-- table access, financial/provider capabilities, audit writes, or GUC-based
-- authorization.

create or replace function app.require_dashboard_merchant_context(
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
declare
    v_membership_role text;
begin
    if p_environment is null
       or p_environment not in ('sandbox', 'production') then
        raise exception 'environment must be sandbox or production'
            using errcode = '23514';
    end if;

    -- K3 remains the sole canonical dashboard membership/role authority.
    -- This deliberately does not read current_setting()/custom GUCs and does
    -- not mix merchant lifecycle or KYC financial capability into membership.
    v_membership_role := app.require_merchant_membership(
        p_user_id,
        p_merchant_id,
        p_required_role
    );

    return query
    select
        p_merchant_id,
        p_environment,
        v_membership_role;
end;
$$;

-- CREATE OR REPLACE preserves existing ACLs, but restate the K4 boundary
-- explicitly so the migration is self-auditing and fail-closed.
revoke all on function app.require_dashboard_merchant_context(uuid, uuid, text, text)
    from public, anon, authenticated, service_role, swiftpay_worker;

grant execute on function app.require_dashboard_merchant_context(uuid, uuid, text, text)
    to swiftpay_api;
