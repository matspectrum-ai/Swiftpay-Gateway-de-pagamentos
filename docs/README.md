# SwiftPay V2 Documentation Index

This directory is part of the canonical source of truth for the reconstruction.

## Start here

1. [`../AGENTS.md`](../AGENTS.md)
2. [`../TODOS.md`](../TODOS.md)
3. [`product/product-vision.md`](product/product-vision.md)
4. [`product/experience-principles.md`](product/experience-principles.md)
5. [`design/brand-system-v0.md`](design/brand-system-v0.md)
6. [`specs/rebuild-scope-v0.md`](specs/rebuild-scope-v0.md)
7. [`architecture/target-architecture.md`](architecture/target-architecture.md)
8. [`contracts/financial-invariants.md`](contracts/financial-invariants.md)

## Reverse engineering

- [`reverse-engineering/audit-method.md`](reverse-engineering/audit-method.md)
- [`reverse-engineering/legacy-inventory.md`](reverse-engineering/legacy-inventory.md)
- [`reverse-engineering/provider-inventory.md`](reverse-engineering/provider-inventory.md)
- [`reverse-engineering/provider-retention.md`](reverse-engineering/provider-retention.md)
- [`reverse-engineering/hyperswitch-fit.md`](reverse-engineering/hyperswitch-fit.md)
- [`reverse-engineering/financial-ledger.md`](reverse-engineering/financial-ledger.md)
- [`reverse-engineering/financial-calculation.md`](reverse-engineering/financial-calculation.md)
- [`reverse-engineering/database-idempotency-constraints.md`](reverse-engineering/database-idempotency-constraints.md)
- [`reverse-engineering/reconciliation.md`](reverse-engineering/reconciliation.md)
- [`reverse-engineering/public-gateway-api.md`](reverse-engineering/public-gateway-api.md)
- [`reverse-engineering/cashout-and-pixout.md`](reverse-engineering/cashout-and-pixout.md)
- [`reverse-engineering/refunds.md`](reverse-engineering/refunds.md)
- [`reverse-engineering/platform-payouts.md`](reverse-engineering/platform-payouts.md)
- [`reverse-engineering/api-credentials-and-internal-auth.md`](reverse-engineering/api-credentials-and-internal-auth.md)
- [`reverse-engineering/kyc-onboarding-storage.md`](reverse-engineering/kyc-onboarding-storage.md)
- [`reverse-engineering/async-jobs-and-outbox.md`](reverse-engineering/async-jobs-and-outbox.md)
- [`reverse-engineering/frontend-capability-inventory.md`](reverse-engineering/frontend-capability-inventory.md)
- [`reverse-engineering/migration-data-classification.md`](reverse-engineering/migration-data-classification.md)

## Decisions

- [`decisions/0001-rebuild-as-new-system.md`](decisions/0001-rebuild-as-new-system.md)
- [`decisions/0002-pix-only-first-release.md`](decisions/0002-pix-only-first-release.md)
- [`decisions/0003-supabase-as-platform-foundation.md`](decisions/0003-supabase-as-platform-foundation.md)
- [`decisions/0004-provider-orchestration.md`](decisions/0004-provider-orchestration.md) — accepted: native thin adapters for the first V2 release

## Documentation lifecycle

- **Product** defines intended outcomes and capabilities.
- **Design** defines experience and brand rules.
- **Reverse engineering** records legacy evidence.
- **Specs** define required V2 behavior.
- **Contracts** define externally visible behavior and invariants.
- **Architecture** defines boundaries and data flow.
- **Decisions** record architectural choices and consequences.

## Rule

When implementation and documentation disagree, determine which artifact is stale or violated; never silently choose one.