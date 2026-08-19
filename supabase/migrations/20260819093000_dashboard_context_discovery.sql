-- SwiftPay V2 A21: trusted merchant dashboard context discovery.
-- Contract authority: merchant-dashboard-web-foundation-v0.
--
-- Adds one read-only SECURITY DEFINER routine for the API runtime so an
-- already verified Supabase dashboard user can discover their active merchant
-- memberships. It adds no relation grants and performs no financial/provider
-- mutation.

create function app.list_dashboard_merchant_contexts(p_user_id uuid)
returns table (
    merchant_id uuid,
    merchant_name text,
    lifecycle_status text,
    membership_role text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, app, auth
as $$
begin
    if p_user_id is null then
        raise exception using errcode = '22023', message = 'A21 dashboard user id is required';
    end if;

    if not exists (
        select 1
        from auth.users u
        where u.id = p_user_id
          and coalesce(u.is_anonymous, false) = false
          and u.deleted_at is null
    ) then
        raise exception using errcode = '42501', message = 'A21 dashboard identity is invalid';
    end if;

    return query
    select
        m.id,
        m.name,
        m.lifecycle_status,
        ctx.membership_role
    from app.merchant_members mm
    join app.merchants m on m.id = mm.merchant_id
    cross join lateral app.require_merchant_membership(
        p_user_id,
        m.id,
        'member'
    ) ctx
    where mm.user_id = p_user_id
      and mm.status = 'active'
    order by pg_catalog.lower(m.name), m.id;
end;
$$;

revoke all on function app.list_dashboard_merchant_contexts(uuid)
    from public, anon, authenticated, service_role, swiftpay_api, swiftpay_worker;

grant execute on function app.list_dashboard_merchant_contexts(uuid)
    to swiftpay_api;
