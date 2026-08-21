-- SwiftPay V2 K3 structural foundation: dashboard identity -> merchant membership.
--
-- The helper is intentionally fail-closed until the behavioral pgTAP suite is
-- introduced. Positive EXECUTE access is deliberately deferred to K4.

create function app.require_merchant_membership(
    p_user_id uuid,
    p_merchant_id uuid,
    p_required_role text
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, app, auth
as $$
begin
    raise exception 'dashboard merchant membership authorization behavior not implemented'
        using errcode = '0A000';
end;
$$;

revoke all on function app.require_merchant_membership(uuid, uuid, text)
    from public, anon, authenticated, service_role;
