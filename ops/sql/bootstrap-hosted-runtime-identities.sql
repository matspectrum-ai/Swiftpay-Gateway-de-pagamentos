-- SwiftPay V2 A25 operational runtime identity bootstrap.
--
-- This file is deliberately NOT a Supabase migration. K4 freezes production
-- LOGIN identities as deployment concerns. It installs no hosted credential;
-- it only establishes the least-privilege role topology consumed by API/worker.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swiftpay_api') THEN
    RAISE EXCEPTION 'swiftpay_api capability role is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swiftpay_worker') THEN
    RAISE EXCEPTION 'swiftpay_worker capability role is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swiftpay_api_runtime') THEN
    CREATE ROLE swiftpay_api_runtime
      LOGIN INHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'swiftpay_api_runtime'
      AND (
        NOT rolcanlogin OR NOT rolinherit OR rolsuper OR rolcreatedb
        OR rolcreaterole OR rolreplication OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION 'existing swiftpay_api_runtime has unsafe role attributes';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'swiftpay_worker_runtime') THEN
    CREATE ROLE swiftpay_worker_runtime
      LOGIN INHERIT
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'swiftpay_worker_runtime'
      AND (
        NOT rolcanlogin OR NOT rolinherit OR rolsuper OR rolcreatedb
        OR rolcreaterole OR rolreplication OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION 'existing swiftpay_worker_runtime has unsafe role attributes';
  END IF;
END
$$;

REVOKE swiftpay_worker FROM swiftpay_api_runtime;
REVOKE swiftpay_api FROM swiftpay_worker_runtime;
GRANT swiftpay_api TO swiftpay_api_runtime;
GRANT swiftpay_worker TO swiftpay_worker_runtime;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members am
    JOIN pg_roles parent ON parent.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
    WHERE member.rolname = 'swiftpay_api_runtime'
      AND parent.rolname <> 'swiftpay_api'
  ) THEN
    RAISE EXCEPTION 'swiftpay_api_runtime has unexpected inherited role authority';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members am
    JOIN pg_roles parent ON parent.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
    WHERE member.rolname = 'swiftpay_worker_runtime'
      AND parent.rolname <> 'swiftpay_worker'
  ) THEN
    RAISE EXCEPTION 'swiftpay_worker_runtime has unexpected inherited role authority';
  END IF;
END
$$;

-- Runtime LOGIN roles never receive direct app-object privileges. Their entire
-- usable application capability surface comes from the K4 NOLOGIN groups.
REVOKE ALL ON SCHEMA app FROM swiftpay_api_runtime, swiftpay_worker_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM swiftpay_api_runtime, swiftpay_worker_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM swiftpay_api_runtime, swiftpay_worker_runtime;
REVOKE ALL ON ALL ROUTINES IN SCHEMA app FROM swiftpay_api_runtime, swiftpay_worker_runtime;
