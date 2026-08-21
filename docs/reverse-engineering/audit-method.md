# Legacy SwiftPay Reverse-Engineering Method

Status: Active

Source repository: `SwiftPay-Prod/swiftpay---Prod`

## Purpose

The V2 is a reconstruction from observed behavior and explicit requirements, not a mechanical port. The audit exists to discover:

- business rules worth keeping;
- financial invariants that must not change accidentally;
- provider-specific behavior learned in production;
- security and authorization boundaries;
- accidental complexity that should be removed;
- implicit coupling that must be made explicit before replacement.

## What “audit every line” means

The audit covers every author-written source file and every configuration artifact that can materially change runtime behavior.

### Reviewed line-oriented

- C# application/core/payment source;
- TypeScript/TSX application source;
- SQL authored by the project;
- shell/start/deploy scripts;
- Docker/Compose configuration;
- CI workflows;
- relevant JSON/YAML/TOML configuration;
- custom middleware, consumers, jobs, services and integrations;
- tests because they encode intended behavior.

### Inventoried but not semantically reviewed line-by-line

- lockfiles;
- binary assets;
- generated EF migration designer/snapshot boilerplate when the corresponding migration/schema effect can be reviewed directly;
- generated build artifacts;
- vendored dependencies.

Generated artifacts are still inspected when they are the only evidence of a database/runtime behavior.

## Audit output per component

Every meaningful component should receive:

- `legacy_path`
- `responsibility`
- `inputs`
- `outputs`
- `state_read`
- `state_written`
- `external_dependencies`
- `side_effects`
- `financial_effect`
- `security_effect`
- `failure_modes`
- `idempotency_behavior`
- `concurrency_behavior`
- `observability`
- `known_provider_quirks`
- `v2_decision`
- `v2_contract_reference`

Allowed V2 decisions:

- `KEEP_CONCEPT` — preserve the invariant/domain concept, redesign implementation;
- `SIMPLIFY` — keep capability with a smaller model;
- `REPLACE` — use a new infrastructure/component;
- `PORT` — preserve behavior closely, typically provider adapters;
- `REMOVE` — intentionally exclude from V2;
- `DEFER` — not required for first V2 scope;
- `UNRESOLVED` — needs more evidence or product decision.

## Audit order

The order is risk-driven, not alphabetical.

1. Financial model
   - accounts;
   - ledger transactions/entries;
   - payment completion/refund postings;
   - balances;
   - fees/reserves;
   - payouts;
   - reconciliation.
2. Payment lifecycle
   - public transaction contract;
   - Pix creation;
   - provider selection;
   - provider webhooks;
   - merchant webhooks;
   - sandbox.
3. Providers
   - adapter interface;
   - every provider implementation;
   - credential shapes;
   - status mapping;
   - webhook verification;
   - Pix-out behavior.
4. Identity/security
   - dashboard auth;
   - API credentials;
   - internal API auth;
   - roles/admin authorization;
   - rate limiting;
   - secret handling.
5. Merchant lifecycle/KYC.
6. Product surface
   - checkout;
   - payment links;
   - customers;
   - products/orders/coupons;
   - notifications/email;
   - referrals/gamification.
7. Infrastructure
   - queues;
   - jobs;
   - caches;
   - storage;
   - realtime;
   - deployment.
8. Frontends
   - merchant flows;
   - admin operations;
   - public checkout.

## Evidence rule

A claim about the legacy system must be traceable to at least one of:

- current source code;
- current schema/migration;
- current test;
- current runtime configuration;
- current deployment documentation;
- observed external/provider contract.

Historical docs may guide investigation but are not enough to establish current behavior if code contradicts them.

## Behavioral extraction rule

Do not port an implementation merely because it exists.

For each behavior ask:

1. Is this required by the target product?
2. Is this required for financial correctness?
3. Is this required for compliance/security?
4. Is this required for provider compatibility?
5. Is this only compensating for an old architectural choice?

Only the first four categories justify preservation by default.

## Financial audit standard

Any code that changes monetary state must identify:

- exact amount unit;
- debit/credit direction;
- source account;
- destination account;
- triggering event;
- idempotency key;
- transactional boundary;
- retry behavior;
- reversal/refund behavior;
- provider settlement assumption.

If any field is unknown, the financial behavior is not considered audited.

## Provider audit standard

For each provider record:

- authentication;
- required customer fields;
- Pix create request/response;
- identifiers (`txid`, provider payment id, end-to-end id);
- status vocabulary and canonical mapping;
- webhook payload variants;
- webhook authentication/signature/IP requirements;
- duplicate/out-of-order webhook behavior;
- refund support;
- Pix-out support;
- fee/split semantics;
- sandbox differences;
- known fixes from production history.

## Completion criteria for Phase 0 audit

Phase 0 reverse engineering is complete only when:

- all author-written runtime source files are accounted for;
- all public endpoints are mapped;
- all financial state transitions are mapped;
- all provider adapters are mapped;
- all async consumers/jobs/queues are mapped;
- all auth/security boundaries are mapped;
- frontend capabilities are mapped to backend contracts;
- every capability has a V2 decision;
- unresolved items are explicit rather than inferred.

## Non-goal

The audit does not require recreating every legacy feature. Its purpose is to let the V2 deliberately choose what to preserve.