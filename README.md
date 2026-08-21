# SwiftPay V2 — Gateway de Pagamentos

Reconstruction repository for SwiftPay.

The goal is to rebuild the platform as a substantially simpler, Pix-first payment gateway with strong financial invariants and a Supabase/PostgreSQL foundation.

## Repository roles

This repository is the canonical source of truth for the new system:

`matspectrum-ai/Swiftpay-Gateway-de-pagamentos`

The legacy production repository is a reverse-engineering and migration reference:

`SwiftPay-Prod/swiftpay---Prod`

V2 is **not** a mechanical port of the legacy architecture.

## Current phase

**Phase 0 — Foundation and reverse engineering**

No production implementation has been started yet. The current objective is to extract the legacy system's real business/financial behavior, decide what survives, and specify the new architecture before code is introduced.

## Target direction

```text
SwiftPay V2
├── Next.js / TypeScript application
├── Supabase
│   ├── PostgreSQL
│   ├── Auth
│   ├── Storage
│   ├── RLS
│   └── Realtime where useful
├── Pix Gateway
│   ├── stable merchant API
│   ├── provider orchestration
│   ├── webhook normalization
│   └── sandbox
├── Financial Core
│   ├── fees
│   ├── ledger
│   ├── balances
│   └── payouts/reconciliation
└── Merchant/Admin surfaces
```

The first release is Pix-only. Credit card, boleto and their associated complexity are deliberately excluded from the initial system.

## Start here

Agents and contributors must read:

1. [`AGENTS.md`](AGENTS.md)
2. [`TODOS.md`](TODOS.md)
3. [`docs/README.md`](docs/README.md)
4. [`docs/reverse-engineering/audit-method.md`](docs/reverse-engineering/audit-method.md)
5. [`docs/specs/rebuild-scope-v0.md`](docs/specs/rebuild-scope-v0.md)
6. [`docs/architecture/target-architecture.md`](docs/architecture/target-architecture.md)
7. [`docs/contracts/financial-invariants.md`](docs/contracts/financial-invariants.md)

## Foundational decisions

- rebuild as a separate system rather than rewrite production in place;
- Pix-only first release;
- Supabase as the default platform foundation, with explicit financial/security boundaries;
- provider orchestration choice (native adapters vs Hyperswitch) remains open pending evidence.

See [`docs/decisions/`](docs/decisions/) for ADRs.

## Engineering standard

Financial behavior is specified and tested before implementation. Ledger, balances, fees, payouts, idempotency, webhook ordering and tenant isolation are treated as contracts rather than incidental application logic.

See [`docs/contracts/financial-invariants.md`](docs/contracts/financial-invariants.md).

## Migration stance

The current SwiftPay production system remains a reference and operational system until the retained V2 scope has been implemented, tested and explicitly approved for migration/cutover.
