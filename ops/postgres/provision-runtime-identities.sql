-- SwiftPay V2 K6: secret-free production runtime identity bootstrap.
--
-- Run only through the separate administrative/migration connection.
-- This file intentionally does NOT contain or set passwords and does NOT contain
-- a managed DATABASE_URL. Password creation/rotation is a deployment secret
-- operation performed out-of-band after these identities exist.
--
-- Re-running this file is fail-closed: existing identities must already have the
-- frozen safe role attributes. The script restores cross-membership and
-- direct-object-deny boundaries without changing K4 capability grants.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'swiftpay_api_runtime') then
    create role swiftpay_api_runtime
      login inherit
      nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists (
    select 1 from pg_roles
    where rolname = 'swiftpay_api_runtime'
      and (not rolcanlogin or not rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception 'existing swiftpay_api_runtime has unsafe role attributes';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'swiftpay_worker_runtime') then
    create role swiftpay_worker_runtime
      login inherit
      nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  elsif exists (
    select 1 from pg_roles
    where rolname = 'swiftpay_worker_runtime'
      and (not rolcanlogin or not rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception 'existing swiftpay_worker_runtime has unsafe role attributes';
  end if;
end
$$;

revoke swiftpay_worker from swiftpay_api_runtime;
revoke swiftpay_api from swiftpay_worker_runtime;
grant swiftpay_api to swiftpay_api_runtime;
grant swiftpay_worker to swiftpay_worker_runtime;

-- Direct privileges are forbidden. Runtime authority is inherited exclusively
-- from the K4 capability groups and later explicitly versioned capability grants.
revoke all on schema app from swiftpay_api_runtime, swiftpay_worker_runtime;
revoke all on all tables in schema app from swiftpay_api_runtime, swiftpay_worker_runtime;
revoke all on all sequences in schema app from swiftpay_api_runtime, swiftpay_worker_runtime;
revoke all on all routines in schema app from swiftpay_api_runtime, swiftpay_worker_runtime;

-- Passwords are deliberately not set here. Deployment must rotate them through
-- a secret-bearing administrative channel, e.g. an equivalent of ALTER ROLE
-- executed without committing the secret or printing it to CI/application logs.
