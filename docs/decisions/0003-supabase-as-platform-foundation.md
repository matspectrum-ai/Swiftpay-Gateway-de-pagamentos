# ADR 0003 — Supabase as the V2 Platform Foundation

Status: Accepted with boundaries

Date: 2026-08-13

## Context

The legacy platform coordinates several infrastructure systems: PostgreSQL/EF Core, RabbitMQ/MassTransit, Hangfire, Valkey/Redis, Firebase/Firestore, object storage, realtime infrastructure and multiple application services.

The reconstruction explicitly seeks to reduce operational surface without compromising financial correctness.

## Decision

Use Supabase as the default platform foundation for SwiftPay V2:

- PostgreSQL as the primary database;
- Supabase Auth for dashboard user identity;
- Supabase Storage for private KYC/assets where appropriate;
- Row Level Security for merchant-facing tenant isolation;
- Realtime selectively for UI updates;
- PostgreSQL functions/transactions for critical financial operations;
- managed scheduling/serverless primitives only where they fit the workload.

## Boundaries

Supabase does **not** replace:

- the financial domain model;
- ledger design;
- provider orchestration;
- public merchant API credential verification;
- reconciliation;
- merchant webhook reliability;
- application authorization beyond what RLS can safely enforce;
- secret management decisions for provider credentials.

Service-role credentials are server-only and never shipped to browser code.

## Architectural stance

Prefer a modular monolith around Supabase/Postgres before introducing additional infrastructure.

New infrastructure requires evidence of a concrete requirement. Examples:

- a dedicated durable worker may be justified for outbound webhook retries;
- a provider orchestration service may be justified if Hyperswitch is selected;
- Redis may be introduced if measured rate-limit/cache needs cannot be handled safely otherwise.

None are default dependencies.

## Consequences

### Positive

- fewer independently operated services;
- one PostgreSQL foundation for state, constraints, RLS and financial transactions;
- simpler auth/storage/realtime integration;
- easier local reasoning for AI agents and maintainers;
- reduced deployment topology.

### Risks

- overusing direct client-to-database access could weaken domain boundaries;
- financial operations still require carefully controlled server/database functions;
- RLS policy mistakes can become security vulnerabilities;
- async workload limits must be evaluated rather than assumed;
- provider secrets need a deliberate encryption/secret-management strategy.

## Required follow-up ADRs

Before implementation is considered production architecture, record decisions for:

1. production vs sandbox project/environment isolation;
2. public API server/runtime;
3. provider credential encryption/storage;
4. durable outbound webhook execution;
5. native provider adapters vs Hyperswitch.