-- SwiftPay V2 K3 behavioral implementation: canonical dashboard-user membership authorization.
--
-- Supabase Auth proves identity existence; app.merchant_members is the only
-- merchant-membership/role source of truth. Merchant lifecycle/KYC capability
-- remains a separate gate. Positive EXECUTE grants remain deferred to K4.

create or replace function app.require_merchant_membership(
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
declare
    v_actual_role text;
    v_membership_status text;
    v_is_anonymous boolean;
    v_deleted_at timestamptz;
    v_actual_rank integer;
    v_required_rank integer;
begin
    if p_user_id is null
       or p_merchant_id is null
       or p_required_role is null
       or p_required_role not in ('member', 'admin', 'owner') then
        raise exception 'invalid merchant membership authorization request'
            using errcode = '23514';
    end if;

    select
        u.is_anonymous,
        u.deleted_at,
        mm.role,
        mm.status
    into
        v_is_anonymous,
        v_deleted_at,
        v_actual_role,
        v_membership_status
    from auth.users u
    left join app.merchant_members mm
        on mm.user_id = u.id
       and mm.merchant_id = p_merchant_id
    where u.id = p_user_id;

    if not found
       or v_is_anonymous is true
       or v_deleted_at is not null
       or v_actual_role is null
       or v_membership_status is distinct from 'active' then
        raise exception 'merchant membership authorization denied'
            using errcode = '42501';
    end if;

    v_actual_rank := case v_actual_role
        when 'member' then 1
        when 'admin' then 2
        when 'owner' then 3
        else 0
    end;

    v_required_rank := case p_required_role
        when 'member' then 1
        when 'admin' then 2
        when 'owner' then 3
    end;

    if v_actual_rank < v_required_rank then
        raise exception 'merchant membership authorization denied'
            using errcode = '42501';
    end if;

    return v_actual_role;
end;
$$;

revoke all on function app.require_merchant_membership(uuid, uuid, text)
    from public, anon, authenticated, service_role;
