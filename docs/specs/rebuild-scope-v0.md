# SwiftPay V2 — Rebuild Scope v0

Status: Draft for architecture execution

## Product intent

SwiftPay V2 is a reconstruction of the payment platform around a much smaller operational core. The first target is a production-capable Pix gateway, not feature parity with the legacy application.

The first release should optimize for:

- correctness;
- auditability;
- operational simplicity;
- explicit provider contracts;
- low infrastructure count;
- strong tenant isolation;
- reversible migration from legacy;
- high-quality agent maintainability.

## Initial product boundary

### Required for the first complete product slice

1. User authentication
2. Merchant organization/profile
3. Merchant onboarding/KYC
4. Admin KYC review
5. Merchant API credentials
6. Pix charge creation
7. Pix charge lookup/status
8. Provider adapter/orchestration
9. Provider webhook ingestion and normalization
10. Financial fee calculation
11. Ledger posting
12. Merchant balance
13. Merchant signed webhooks
14. Sandbox/test environment
15. Minimal merchant dashboard
16. Minimal admin operations

### Required shortly after the first slice

1. Merchant payout account
2. Pix-out / withdrawal
3. Withdrawal approval policy
4. Payout provider webhook
5. Reconciliation tooling
6. Basic transactional email
7. Minimal public Pix checkout/payment link if product requires it

## Explicitly out of initial scope

- credit card;
- boleto;
- PCI card data;
- installments;
- BNPL;
- wallet payment methods;
- crypto;
- physical/digital product catalog;
- inventory/stock;
- coupons;
- digital product delivery;
- rankings;
- achievements;
- bulletin/social features;
- referral program;
- advanced analytics pipeline;
- advanced A/B provider routing;
- multiple distributed caches;
- generic event bus introduced before a proven need.

Features can be reintroduced through later ADRs after the Pix core is stable.

## Target first vertical slice

```text
signup
  -> merchant created
  -> KYC submitted
  -> admin approves
  -> API credential issued
  -> POST Pix charge
  -> provider creates QR
  -> provider webhook received
  -> canonical payment transitions to paid
  -> ledger posts once
  -> merchant available/pending balance reflects state
  -> signed merchant webhook delivered
```

This slice is not complete until duplicate and out-of-order webhooks are tested.

## Public gateway contract direction

The V2 should expose a small, stable payment API independent of provider implementation.

Initial conceptual endpoints:

```text
POST /v1/auth/token                 # only if client_credentials compatibility is retained
POST /v1/transactions               # Pix charge creation
GET  /v1/transactions/{id}          # canonical transaction
GET  /v1/transactions               # merchant transaction list
GET  /v1/balance                    # merchant financial balance
POST /v1/webhooks/test              # optional merchant webhook validation
```

Payout endpoints are specified separately once payout scope is approved.

Exact compatibility with legacy endpoint payloads is not assumed until the endpoint audit is complete.

## Canonical Pix transaction minimum

A Pix transaction should contain at minimum:

- SwiftPay transaction ID;
- merchant ID;
- environment;
- amount in cents;
- currency (`BRL` initially);
- status;
- external merchant reference/idempotency reference;
- customer snapshot required for provider/payment record;
- provider routing result;
- provider payment/tx identifier(s), private from merchant contract where appropriate;
- Pix copy-and-paste payload;
- expiration;
- completion timestamp;
- end-to-end id when available;
- merchant fee;
- provider cost/fee when known;
- merchant net/settlement amount;
- metadata;
- callback/webhook association.

## Canonical status direction

Initial state-machine candidate:

```text
created
  -> pending
  -> paid
  -> expired
  -> failed
  -> cancelled
```

Refunded states are added only if refunds are approved in first-release scope.

Internal processing locks must not become externally visible business statuses unless there is a clear contract need.

## Fee direction

Initial Pix fee model should support:

- platform default fee;
- per-merchant override;
- fixed amount;
- percentage in basis points;
- fixed + percentage;
- provider cost stored independently from merchant fee;
- deterministic snapshot on transaction creation.

Different fee schedules for API, checkout and payment link should only exist if the product actually prices these channels differently.

## Ledger direction

Ledger must be canonical for financial movement.

Minimum conceptual accounts are expected to include some subset of:

- merchant pending;
- merchant available;
- merchant blocked (for payout);
- merchant reserved (only if reserves are required);
- provider settlement/clearing;
- platform revenue/fee or a clearly defined equivalent.

The exact chart of accounts is not approved until the fund-flow analysis is complete.

## Provider direction

Two implementation paths remain valid during Phase 0:

### Option A — Native thin Pix adapter layer

Benefits:

- smallest runtime;
- easiest Supabase integration;
- easy to port existing provider knowledge;
- no unused multi-method orchestration surface.

Costs:

- SwiftPay owns routing/retries/provider lifecycle;
- every connector remains our responsibility.

### Option B — Hyperswitch as Pix orchestration engine

Benefits:

- mature payment orchestration base;
- provider/routing/attempt infrastructure;
- future extension path.

Costs:

- additional runtime/service complexity;
- custom Brazilian Pix connectors may still need porting;
- semantic boundary with SwiftPay ledger/fees must be explicit.

No implementation should make this decision accidentally.

## Supabase role

Supabase is the default platform candidate for:

- PostgreSQL;
- Auth;
- Storage;
- Realtime where needed;
- SQL migrations/functions;
- scheduled/serverless execution where appropriate.

It must not be used to collapse security boundaries by exposing service-role credentials to the frontend.

## Acceptance standard

The V2 core is not considered correct merely because the happy-path UI works.

Acceptance must cover:

- duplicate create requests;
- duplicate provider webhooks;
- out-of-order provider webhooks;
- provider timeout after unknown create result;
- ledger posting replay;
- concurrent payout attempts;
- insufficient balance;
- RLS cross-merchant access attempts;
- leaked provider fields in merchant API responses;
- invalid webhook signature/token/IP according to provider contract;
- merchant webhook retry/deduplication;
- rollback/recovery from partial external failure.

## Migration stance

No direct rewrite-in-place.

Legacy remains operational reference until V2 reaches parity for the explicitly retained scope. Data migration and cutover require a separate approved specification.