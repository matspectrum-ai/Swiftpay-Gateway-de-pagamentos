-- SwiftPay V2 Phase 2 / J2: public Data API exposure is explicit opt-in.
--
-- Keep Supabase's optional RLS-on-create event trigger, but do not let its
-- SECURITY DEFINER helper become a public RPC. Future public objects must also
-- require an explicit reviewed GRANT before Data API roles can reach them.

alter default privileges for role postgres in schema public
    revoke all privileges on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
    revoke all privileges on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
    revoke execute on routines from public, anon, authenticated, service_role;

-- The helper is installed only when Supabase's automatic RLS enforcement is
-- enabled for the project. Preserve the event trigger itself; remove only
-- direct invocation capability from Data API roles.
do $$
begin
    if to_regprocedure('public.rls_auto_enable()') is not null then
        revoke execute on function public.rls_auto_enable()
            from public, anon, authenticated, service_role;
    end if;
end;
$$;
