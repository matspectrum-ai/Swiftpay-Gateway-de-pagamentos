-- SwiftPay V2 Phase 2 / J1: fail-closed ACL boundary for the private app schema.
--
-- The app schema is intentionally server-owned and not exposed through the
-- Supabase Data API. Existing objects have historically been revoked one by
-- one; this migration makes that posture durable for future objects too.

-- Keep the schema itself unreachable from browser/API roles.
revoke all on schema app from public;
revoke all on schema app from anon;
revoke all on schema app from authenticated;
revoke all on schema app from service_role;

-- Retroactively harden every existing app object. This is intentionally
-- redundant with earlier per-object revocations so the boundary has one
-- canonical hardening point.
revoke all privileges on all tables in schema app
    from public, anon, authenticated, service_role;

revoke all privileges on all sequences in schema app
    from public, anon, authenticated, service_role;

revoke all privileges on all routines in schema app
    from public, anon, authenticated, service_role;

-- PostgreSQL normally grants EXECUTE on newly-created routines to PUBLIC.
-- That default is global for the creator role: a schema-scoped REVOKE cannot
-- remove a privilege granted by the global default. Revoke it globally for
-- the postgres migration owner so every future routine requires an explicit
-- positive grant before it becomes callable.
alter default privileges for role postgres
    revoke execute on routines from public;

-- Supabase Data API roles must never receive implicit app-schema privileges.
-- These schema-scoped defaults are defense-in-depth against any previous or
-- future explicit default grants for the roles.
alter default privileges for role postgres in schema app
    revoke all privileges on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema app
    revoke all privileges on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema app
    revoke execute on routines from anon, authenticated, service_role;
