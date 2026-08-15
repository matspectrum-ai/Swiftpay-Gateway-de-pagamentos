# Canonical Supabase Project

Updated: 2026-08-14

SwiftPay V2 has exactly one canonical Supabase project for remote verification and deployment:

- Project name: `swiftpay v2`
- Project ref / ID: `vsidrgbbyzibqfjkuiqb`
- Region: `us-west-2`

The project named `swiftpay v2 cc` is **not** a SwiftPay V2 deployment target and MUST NOT receive SwiftPay V2 migrations.

## Source of truth

The repository remains the canonical migration source of truth:

- `supabase/migrations/*.sql`
- migration ordering is defined by the timestamp prefix in each repository filename
- GitHub Actions + pgTAP is the deterministic acceptance gate before remote deployment

Remote Supabase state must converge to the repository; remote state must not redefine repository migration ordering.

## Deployment rule

Do not bulk-apply repository migrations through an interface that generates unrelated migration versions if that would break 1:1 correspondence with the repository migration history. Prefer the canonical Supabase CLI/link/db-push workflow or an equivalent deployment path that preserves repository migration versions.

The Supabase plugin is approved for:

- read-only schema and migration-history inspection
- security/performance advisors
- Auth/Storage/branch/log inspection
- targeted verification queries
- carefully scoped operational actions that do not undermine repository migration history

## Current remote note

During canonical-project identification, the first foundation migration (`identity_compliance_and_providers`) was applied to the remote project through the Supabase plugin and registered under a plugin-generated migration version. Before adopting automated `db push`, reconcile that one migration-history entry with the repository timestamp so future deployment history remains deterministic.

No further repository migrations should be applied ad hoc through the plugin until that history reconciliation is completed.
