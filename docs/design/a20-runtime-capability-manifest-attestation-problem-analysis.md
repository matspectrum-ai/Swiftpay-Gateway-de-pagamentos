# A20 — Runtime Capability Manifest & Exact Attestation — Problem Analysis

Status: **PROBLEM_ANALYSIS**  
Date: 2026-08-19

## Problem

SwiftPay's hosted PostgreSQL least-privilege state is currently correct, but the regression contract is not fully nominal.

Current hosted audit on canonical `swiftpay v2` proves:

- `swiftpay_api`: zero direct `app` table privileges, 24 `app` EXECUTE capabilities;
- `swiftpay_worker`: zero direct `app` table privileges, 6 `app` EXECUTE capabilities;
- `anon`, `authenticated`, `service_role` and `PUBLIC`: no `app` table/RPC authority;
- API/worker capability roles have `USAGE` but not `CREATE` on `app`;
- no API↔worker cross-membership;
- Supabase Security Advisor: 0 lints.

K4/K6 and later feature suites strongly test role separation, zero direct DML, selected positive capabilities, selected forbidden financial/provider primitives, and capability counts. However there is no single machine-readable repository artifact that freezes the **exact nominal set of allowed RPC signatures** for each runtime role.

A count-only or partial-probe regression can theoretically miss a substitution drift: one expected EXECUTE could be revoked while one unrelated/dangerous EXECUTE is granted, preserving a 24/6 count.

The audit found no such drift today. A20 therefore must add attestation, not change privileges.

## Required boundary

A20 should add:

1. a versioned machine-readable manifest containing the exact canonical `app.<function>(arg-types...)` signatures executable by `swiftpay_api` and `swiftpay_worker`;
2. a runtime-topology pgTAP contract that compares actual sorted EXECUTE sets exactly against that manifest-defined set;
3. structural invariants that remain part of the same attestation:
   - no direct relation/sequence ACL entries for API/worker runtime identities;
   - runtime LOGIN roles inherit exactly their one capability role;
   - capability roles have `USAGE` but not `CREATE` on `app`;
   - public/Data API roles have no `app` schema/table/RPC authority;
   - every runtime-executable `app` routine is `SECURITY DEFINER` and carries an explicit non-public search path;
4. CI coverage in the existing `runtime-topology` job;
5. hosted postflight comparing the canonical project against the same frozen allowlist.

## Current exact hosted allowlist

### `swiftpay_api` — 24

- `app.claim_api_pix_attempt(uuid,text,uuid,uuid)`
- `app.consume_api_abuse_quota(text,text,text)`
- `app.consume_api_token_issuance(uuid)`
- `app.create_dashboard_api_credential(uuid,uuid,text,text,text,jsonb)`
- `app.create_dashboard_webhook_endpoint(uuid,uuid,text,text,text,jsonb)`
- `app.disable_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)`
- `app.enable_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)`
- `app.get_api_balance(uuid,text)`
- `app.get_api_credential_auth_state(uuid)`
- `app.get_api_payment(uuid,text,uuid)`
- `app.get_dashboard_api_credential(uuid,uuid,text,uuid)`
- `app.get_dashboard_transaction(uuid,uuid,text,uuid)`
- `app.get_dashboard_webhook_endpoint(uuid,uuid,text,uuid)`
- `app.list_dashboard_api_credentials(uuid,uuid,text)`
- `app.list_dashboard_transactions(uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,uuid,integer)`
- `app.list_dashboard_webhook_endpoints(uuid,uuid,text)`
- `app.lookup_api_credential_for_token(text)`
- `app.prepare_api_pix_payment(uuid,text,text,text,jsonb,jsonb,text)`
- `app.require_dashboard_merchant_context(uuid,uuid,text,text)`
- `app.resolve_api_pix_attempt(uuid,text,uuid,uuid,uuid,jsonb)`
- `app.revoke_dashboard_api_credential(uuid,uuid,text,uuid,text,text,jsonb)`
- `app.rotate_dashboard_api_credential_secret(uuid,uuid,text,uuid,text,text,jsonb)`
- `app.rotate_dashboard_webhook_endpoint_secret(uuid,uuid,text,uuid,text,text,jsonb)`
- `app.update_dashboard_webhook_endpoint(uuid,uuid,text,uuid,text,text,jsonb)`

### `swiftpay_worker` — 6

- `app.apply_sandbox_pix_paid(uuid,uuid,bigint,bigint,text,timestamp with time zone)`
- `app.claim_jobs(text,integer,integer)`
- `app.claim_merchant_webhook_deliveries(text,integer,integer)`
- `app.complete_job(uuid,uuid)`
- `app.reschedule_job(uuid,uuid,text,text,integer)`
- `app.resolve_merchant_webhook_delivery(uuid,uuid,uuid,text,integer,text,text,integer)`

All 30 hosted runtime-executable routines are currently `SECURITY DEFINER`. Their explicit search paths are either empty or limited to trusted schemas (`pg_catalog`, `app`, and where required `auth`); none uses `public`, `$user`, or `pg_temp`.

## Risks

- Duplicating an allowlist in several tests without one manifest creates new drift rather than solving it.
- Freezing OIDs or `specific_name` values would be unstable across migration replay and is forbidden; signatures must be type-based.
- Treating capability counts as sufficient is explicitly rejected.
- A20 must not silently revoke/grant authority merely to make an audit pass.
- Search-path validation must not demand one historical formatting style if multiple currently safe explicit forms exist.

## Non-goals

- No PostgreSQL privilege change.
- No migration.
- No new RPC.
- No provider/network activation.
- No financial behavior change.
- No redesign of K4/K6 role topology.
- No dependency upgrade.

## Verification strategy

TDD RED must first prove that the canonical capability manifest and exact-attestation contract do not exist.

GREEN must then prove:

- the manifest has exactly 24 API and 6 worker signatures, sorted and unique;
- runtime pgTAP compares exact actual arrays to those sets;
- a one-for-one capability substitution would fail the exact-set assertion even if counts remain 24/6;
- existing K4/K6 and full database/runtime regression remain GREEN;
- hosted canonical state exactly matches the frozen manifest;
- no hosted DDL or privilege mutation is performed by A20.
