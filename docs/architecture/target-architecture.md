# SwiftPay V2 — Target Architecture

Status: Initial target, subject to Phase 0 audit decisions

## Architectural objective

Build the smallest architecture that can safely support SwiftPay's retained Pix payment business.

The architecture should be a modular monolith first. Distribution is introduced only where external reliability requirements make it necessary.

## Proposed system shape

```text
Clients
├── Merchant Dashboard
├── Admin Dashboard
├── Public Checkout (later/minimal)
└── Merchant API clients
        |
        v
SwiftPay Application
├── Web application / server boundary
├── Public Gateway API
├── Admin/merchant application services
├── Payment orchestration boundary
├── Financial domain
└── Webhook workers/functions
        |
        +--------------------------+
        |                          |
        v                          v
Supabase / PostgreSQL          Pix Provider Layer
├── Auth                     ├── native adapters OR
├── Postgres                 └── Hyperswitch Pix profile
├── RLS                            |
├── Storage                        v
├── Realtime (selective)       PSPs / IPs
└── SQL functions/jobs
```

## Default implementation stance

### Frontend/application

Preferred direction:

- Next.js with TypeScript;
- server-side application boundary for privileged operations;
- direct Supabase browser access only for RLS-safe user-facing reads/writes;
- no service-role credentials in browser code.

A separate always-on custom backend is not assumed until a requirement proves it necessary.

### Database

Supabase PostgreSQL is the primary source of truth.

Database responsibilities include:

- canonical relational state;
- financial constraints;
- atomic financial transitions;
- idempotency uniqueness;
- RLS tenant isolation;
- audit/event tables;
- ledger functions;
- views/read models where useful.

### Auth

Supabase Auth is the default candidate for dashboard users.

Public merchant API credentials are a separate domain and must not be represented as normal Supabase user sessions.

Expected credential pattern:

- opaque public identifier/key prefix;
- secret shown once;
- only a secure hash/verifier persisted when possible;
- environment-scoped credential;
- revocation/rotation timestamps;
- merchant ownership;
- server-side verification.

### Storage

Supabase Storage is the default for:

- KYC documents;
- merchant logos/assets;
- operational attachments if retained.

KYC documents require private buckets and explicit access policies.

### Realtime

Use Supabase Realtime selectively for dashboard state updates.

Realtime is presentation infrastructure. It is not the transaction coordinator for payments or financial postings.

## Bounded modules

The first architecture should contain a small number of explicit modules.

### Identity

Owns:

- dashboard user identity;
- profile;
- roles;
- merchant membership.

### Merchant

Owns:

- merchant organization;
- merchant lifecycle;
- KYC state;
- merchant settings;
- payout account references;
- provider assignment references.

### Gateway

Owns:

- public API authentication;
- Pix transaction creation;
- transaction query;
- idempotency;
- canonical payment state machine;
- provider attempt/routing record.

### Providers

Owns:

- provider configuration schema;
- encrypted credential retrieval;
- Pix create adapter;
- Pix status adapter;
- webhook verification/normalization;
- Pix-out adapter where supported.

Provider-specific status and payload fields do not leak into Gateway contracts.

### Finance

Owns:

- fee snapshots;
- ledger accounts;
- ledger transactions;
- ledger entries;
- balances/read models;
- payout reservation/posting;
- reconciliation inputs.

Finance should have no dependency on UI concepts such as checkout themes or dashboard widgets.

### Webhooks

Owns two distinct concerns:

1. inbound provider webhooks;
2. outbound merchant webhook deliveries.

These must not share lifecycle/status fields merely because both use HTTP callbacks.

### Operations/Admin

Owns:

- KYC review;
- merchant activation/suspension;
- provider assignment/configuration;
- transaction inspection;
- payout approval if manual;
- reconciliation tools;
- audit logs.

## Proposed initial database domains

Exact migrations are deferred until specs are approved, but the target should remain compact.

Candidate tables:

```text
identity / tenant
- profiles
- merchants
- merchant_members
- merchant_kyc
- merchant_kyc_documents

credentials / configuration
- api_credentials
- providers
- merchant_provider_configs
- merchant_fee_configs

payments
- payments
- payment_attempts
- provider_webhook_events

finance
- ledger_accounts
- ledger_transactions
- ledger_entries
- payouts
- payout_accounts
- reconciliation_records (later)

merchant webhooks
- webhook_endpoints
- webhook_deliveries

audit
- audit_events
```

This is intentionally much smaller than the legacy entity set.

## Payment creation transaction boundary

Creating a Pix charge involves an external PSP call, so a single ACID transaction cannot cover the entire operation.

Target pattern:

1. authenticate merchant;
2. validate and reserve idempotency key;
3. snapshot fee/provider routing decision;
4. create canonical local payment/attempt in `creating` or equivalent internal state;
5. commit local state;
6. call provider with a stable SwiftPay reference/idempotency token;
7. persist provider identifiers/QR payload;
8. transition canonical payment to pending;
9. on unknown external result, preserve recoverable state rather than blindly create another charge.

The exact internal status model requires a spec before implementation.

## Provider webhook boundary

Target pattern:

```text
HTTP webhook
 -> identify provider
 -> authenticate/verify
 -> persist raw event hash + provider event identifier
 -> idempotency gate
 -> normalize event
 -> lock/transition canonical payment
 -> post finance effect atomically when applicable
 -> enqueue/record merchant event delivery
 -> acknowledge provider
```

The canonical payment transition and ledger effect should be in one PostgreSQL transaction when the ledger change is triggered by that transition.

## Financial consistency architecture

### Canonical rule

Payment status alone is not a balance.

Financial balances must derive from ledger postings or from read models updated in the same database transaction as ledger postings.

### Ledger properties

Target ledger should provide:

- append-only entries;
- deterministic transaction idempotency key;
- integer cents;
- balanced posting rules where double-entry applies;
- no direct arbitrary balance mutation;
- reversible correction through compensating entries rather than editing history;
- foreign references to source payment/payout/event;
- clear environment/merchant scope.

### Cached balances

A cached account balance column can exist for performance if:

- it is updated atomically with entries;
- entries remain authoritative evidence;
- invariants have database tests;
- reconciliation can recompute/verify it.

## Async execution policy

Do not introduce RabbitMQ-equivalent infrastructure by default.

Use asynchronous execution only for operations that benefit from retry outside the request:

- outbound merchant webhook delivery;
- email;
- reconciliation jobs;
- provider status recovery/polling;
- scheduled payout/reserve release if required.

Implementation candidates include:

- database outbox + worker;
- Supabase Edge Functions;
- Supabase Cron/pg_cron;
- a small dedicated worker.

Selection should be per workload, not one generic queue for everything.

## Sandbox architecture

Avoid pervasive ORM/query filters.

Preferred options, in order of simplicity:

1. explicit `environment` column with mandatory scope in service/RLS policies;
2. separate Supabase project/database for production versus non-production if operational separation is preferred.

A final ADR must choose the strategy before schema implementation.

## Secrets architecture

Provider secrets require server-only access.

Options include:

- platform secret manager/environment variables for platform-level provider credentials;
- encrypted database fields with keys outside the database for merchant/provider-specific credentials;
- Supabase Vault only if its operational/security model matches the requirement.

Do not store plaintext secrets merely because the legacy model used JSON credential fields.

## Hyperswitch boundary if adopted

If Hyperswitch is selected, it replaces provider orchestration responsibilities, not SwiftPay's merchant/business/finance domain.

```text
SwiftPay Gateway
 -> SwiftPay payment/fee snapshot
 -> Hyperswitch orchestration
 -> PSP

PSP webhook
 -> Hyperswitch normalization (where supported)
 -> SwiftPay canonical event
 -> SwiftPay payment state + ledger
```

SwiftPay remains authoritative for:

- merchant identity/KYC;
- public SwiftPay API contract;
- fee charged to merchant;
- ledger/balance;
- payout business rules;
- merchant webhooks;
- admin product state.

## Architecture anti-goals

V2 should not recreate:

- multiple APIs solely because legacy had them;
- generic message bus before a concrete reliability need;
- global ORM context with every business domain;
- method-general models carrying card/boleto fields while product is Pix-only;
- duplicated platform/merchant/provider configuration matrices without a pricing requirement;
- business KPI cache tables before query performance proves a need;
- hidden fallback generation of personal/customer data;
- implicit financial side effects spread across notification/consumer chains.

## Decision gates before implementation

The following must be resolved before schema/application code becomes authoritative:

1. native provider layer vs Hyperswitch;
2. first-release payout scope;
3. refund scope;
4. reserve/compensation business requirement;
5. sandbox isolation strategy;
6. public API compatibility target;
7. provider credentials ownership/encryption model;
8. exact chart of accounts/fund flow.