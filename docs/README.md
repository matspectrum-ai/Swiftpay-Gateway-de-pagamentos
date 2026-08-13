# SwiftPay V2 Documentation Index

This directory is part of the canonical source of truth for the reconstruction.

## Start here

1. [`../AGENTS.md`](../AGENTS.md) — engineering and agent governance
2. [`../TODOS.md`](../TODOS.md) — canonical backlog/handoff
3. [`reverse-engineering/audit-method.md`](reverse-engineering/audit-method.md) — how legacy evidence is audited
4. [`reverse-engineering/legacy-inventory.md`](reverse-engineering/legacy-inventory.md) — current legacy capability map
5. [`reverse-engineering/provider-inventory.md`](reverse-engineering/provider-inventory.md) — audited legacy Pix provider adapter matrix
6. [`specs/rebuild-scope-v0.md`](specs/rebuild-scope-v0.md) — target product scope
7. [`architecture/target-architecture.md`](architecture/target-architecture.md) — target system architecture
8. [`contracts/financial-invariants.md`](contracts/financial-invariants.md) — non-negotiable financial contracts

## Decisions

- [`decisions/0001-rebuild-as-new-system.md`](decisions/0001-rebuild-as-new-system.md)
- [`decisions/0002-pix-only-first-release.md`](decisions/0002-pix-only-first-release.md)
- [`decisions/0003-supabase-as-platform-foundation.md`](decisions/0003-supabase-as-platform-foundation.md)
- [`decisions/0004-provider-orchestration.md`](decisions/0004-provider-orchestration.md) — open decision: native Pix adapters vs Hyperswitch

## Documentation lifecycle

### Reverse engineering

Records what the legacy system actually does and why it may matter.

### Specs

Define what V2 must do independently of implementation.

### Contracts

Define externally visible behavior and invariants that implementation must satisfy.

### Architecture

Defines component boundaries, dependencies and data-flow decisions.

### Decisions

ADRs record important choices and their consequences.

## Rule

When implementation and documentation disagree, do not silently pick one. Determine whether the implementation violates the approved contract or whether the documentation is stale, then update the appropriate artifact and record the decision.