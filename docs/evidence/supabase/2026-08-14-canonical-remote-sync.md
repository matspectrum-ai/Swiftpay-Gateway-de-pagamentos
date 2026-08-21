# Canonical Supabase remote reconciliation — 2026-08-14

## Scope

This evidence record captures the reconciliation and security verification of the SwiftPay V2 canonical managed Supabase project against the migration chain on `agent/foundation-phase-0`.

Canonical remote:

- project name: `swiftpay v2`
- project ref: `vsidrgbbyzibqfjkuiqb`
- PostgreSQL major: 17
- non-canonical sibling `swiftpay v2 cc` was not modified

The Git repository remains the source of truth for migration SQL and migration ordering.

## Initial remote state

The remote initially had no trustworthy migration history but already contained the object set corresponding to the first two repository migrations:

- `20260814005500_identity_compliance_and_providers.sql`
- `20260814010000_payment_idempotency_and_provider_events.sql`

Inspection showed:

- the existing table/column/constraint shape matched those two repository migrations;
- no `app` routines had been created yet;
- all current SwiftPay domain tables were empty;
- no canonical business/financial data had to be migrated or discarded.

Because the existing objects were structurally compatible and empty, the remote history was reconciled rather than dropping/recreating the schema.

## Migration synchronization

The remaining repository migrations were applied sequentially, preserving the same order proven by local/CI database reconstruction. Migration-history versions were normalized to the repository timestamps rather than retaining connector-generated versions.

After synchronization through J1, remote verification reported:

- 21 canonical migrations through `20260814064000_app_schema_access_control.sql`;
- 30 `app` tables;
- 4 reconciliation views;
- 23 `app` routines;
- 3 append-only/history triggers;
- zero SwiftPay domain rows;
- zero internal reconciliation findings;
- no `anon`, `authenticated`, `service_role` or `PUBLIC` privilege violations on `app` relations/routines;
- no schema `USAGE`/`CREATE` for Data API roles on `app`.

## J1 — private `app` schema hardening

Repository artifacts:

- spec: `docs/specs/app-schema-access-control-v0.yaml`
- test: `supabase/tests/database/021_app_schema_access_control.test.sql`
- migration: `supabase/migrations/20260814064000_app_schema_access_control.sql`

Validated GitHub Actions boundary:

- run #85
- 21 pgTAP files
- 716 tests
- PASS

J1 removes implicit routine execution and makes future `app` objects fail-closed to `PUBLIC`, `anon`, `authenticated` and `service_role`.

## Security Advisor finding after J1

The managed Supabase Security Advisor then surfaced one project-level issue outside the private `app` schema:

- `public.rls_auto_enable()` was `SECURITY DEFINER` and directly executable by Data API roles.

Inspection proved the function belonged to the enabled `ensure_rls` DDL event-trigger mechanism. The event trigger itself is useful and was preserved; direct API execution was not required.

The remote also retained permissive default ACLs for future `public` tables and sequences. This became J2 rather than being patched out-of-band.

## J2 — explicit opt-in Data API grants

Repository artifacts:

- spec: `docs/specs/public-data-api-default-grants-v0.yaml`
- test: `supabase/tests/database/022_public_data_api_defaults.test.sql`
- migration: `supabase/migrations/20260814065000_public_data_api_default_grants.sql`

RED evidence:

- GitHub Actions run #88
- 22 files / 734 assertions executed
- `001`–`021` remained green
- only `022` assertions 6–11 failed
- the failures were exclusively implicit privileges inherited by future `public` table/sequence probes

GREEN evidence:

- GitHub Actions run #89
- 22 pgTAP files
- 734 tests
- PASS

The J2 migration:

- removes default Data API privileges from future `public` tables;
- removes default Data API privileges from future `public` sequences;
- removes default routine execution for Data API roles and `PUBLIC`;
- revokes direct execution of `public.rls_auto_enable()` when installed;
- does not remove or disable the `ensure_rls` event trigger;
- does not bulk-revoke unrelated existing public application surfaces;
- does not modify `auth`, `storage` or `realtime` privileges.

## Final canonical remote state

`20260814065000_public_data_api_default_grants.sql` was applied to `swiftpay v2` and its remote history version normalized to `20260814065000`.

Final verification:

- migration count: 22;
- latest migration: `20260814065000 public_data_api_default_grants`;
- `public.rls_auto_enable()` remains installed;
- `ensure_rls` remains enabled;
- `anon` cannot execute `public.rls_auto_enable()`;
- `authenticated` cannot execute `public.rls_auto_enable()`;
- `service_role` cannot execute `public.rls_auto_enable()`;
- no forbidden `public` default-ACL entries remain for future tables, sequences or routines;
- J1 `app` schema denial remains intact for all Data API roles.

Supabase Security Advisor after J2:

- **0 security lints**.

## Performance Advisor disposition

The Performance Advisor currently reports only `INFO` findings, primarily:

- foreign keys without dedicated covering indexes;
- indexes reported as unused while the database contains no production workload/data.

No index was added or removed solely to silence those notices. Index changes remain a separate evidence-driven performance slice after representative query/workload plans exist. Foreign-key index candidates should be evaluated against actual access/delete/update paths rather than applied mechanically.

## Safety / non-goals

This remote reconciliation did not:

- introduce production provider HTTP calls;
- enable provider refund execution;
- unlock I3b provider-specific correlation without conformance evidence;
- create merchant-facing public tables or RPCs;
- seed production financial data;
- modify the non-canonical `swiftpay v2 cc` project.

The repository migration chain and pgTAP contracts remain the canonical reproducible definition; managed Supabase verification is an additional deployed-environment proof.
