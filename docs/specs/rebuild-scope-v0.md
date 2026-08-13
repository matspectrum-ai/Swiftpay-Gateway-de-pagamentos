# SwiftPay V2 — Rebuild Scope v0

Status: Draft for architecture execution

## Product intent

SwiftPay V2 is a reconstruction of the payment platform around a much smaller operational core. The first target remains a production-capable Pix financial core, not feature parity with the legacy application.

The broader product, however, is intentionally more than a generic gateway:

> **Payments + Conversion Intelligence + Revenue Automation for digital sellers.**

The first release sequence should optimize for:

- correctness;
- auditability;
- operational simplicity;
- product simplicity;
- fast checkout/payment experience;
- explicit provider contracts;
- low infrastructure count;
- strong tenant isolation;
- reversible migration from legacy;
- high-quality agent maintainability.

See [`../product/product-vision.md`](../product/product-vision.md) for the canonical product direction.

## Scope strategy

SwiftPay should be large in capability but small in architecture.

Multiple product surfaces reuse a small number of canonical cores:

```text
Checkout ------\
Payment Link ---+--> Payment Core --> Provider Router --> Pix
Quick Pix ------+
REST API -------/

Product/Payment Events --> Analytics + Insights + Automations + Integrations

Sales + Wallet Top-up + Payout/Pix-out --> Financial Ledger
```

A feature is not justification for a feature-specific financial engine, event system or balance model.

## First financial vertical slice

### Required

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

This is deliberately smaller than the complete product. It proves the financial spine before product surfaces multiply.

## Product capabilities required after the financial spine

These are part of the intended SwiftPay V2 product, not optional ideas, although their exact release sequencing remains subject to Phase 1 specifications.

### Selling surfaces

1. Hosted transparent Pix checkout
2. Payment links
3. Quick Pix generation for sellers
4. REST API for direct Pix integration
5. Merchant checkout branding
6. UTM capture and checkout/payment event instrumentation

All four selling paths must reuse the canonical Payment Core.

### Conversion intelligence

1. Revenue dashboard
2. Approved sales
3. Lost/expired sales
4. Conversion rate with explicit denominator
5. Checkout funnel
6. Conversion by checkout/payment link
7. Conversion by UTM/campaign
8. Conversion by provider
9. Recoverable-revenue indicators with estimates clearly labeled
10. Provider performance/routing observability

The initial analytics implementation should be derived from canonical product/payment events rather than a separate oversized BI platform.

### Money / wallet

1. Merchant payout account
2. Pix-out / withdrawal
3. Withdrawal approval policy
4. Payout provider webhook
5. Reconciliation tooling
6. Wallet statement
7. Add-balance/top-up through an approved Pix provider/fund-flow model
8. Direct Pix payment from available operational balance where legally/provider-supported

A wallet top-up is never classified as a sale and must not affect revenue, conversion, ticket or seller ranking.

Dedicated Pix keys, custody or bank-account semantics require separate approved legal/provider/fund-flow decisions and are not implied by this scope.

### Revenue automation and integrations

1. Durable outgoing webhooks
2. Basic transactional email
3. WhatsApp integration for approved communication/recovery use cases
4. Telegram notifications/integration
5. UTMify integration
6. n8n integration
7. constrained SwiftPay automation rules (`EVENT -> CONDITION -> ACTION`)
8. recovery templates such as unpaid-Pix follow-up

SwiftPay should not build a generic n8n competitor. Automation remains constrained to the revenue/payment domain.

### Developer platform

1. REST API
2. canonical OpenAPI
3. signed webhooks and delivery observability
4. integration examples
5. TypeScript SDK when justified
6. CLI/bootstrap experience when justified
7. MCP/agent integration surface for safe operations when approved
8. agent-readable integration documentation

The objective is to make SwiftPay easy to integrate from conventional code and AI coding environments without exposing unsafe financial actions casually.

### Community / ranking

Revenue ranking is a desired SwiftPay capability for the digital-marketing market, but it is isolated from the financial core and does not block the first financial/product slices.

Requirements before implementation:

- opt-in participation;
- privacy controls;
- canonical eligible sales only;
- top-ups excluded;
- clear period definitions;
- no financial-core dependency on ranking availability.

## Explicitly out of the current initial product direction

- credit card;
- boleto;
- PCI card data;
- installments;
- BNPL;
- crypto;
- physical/digital product catalog as an ecommerce suite;
- inventory/stock;
- generic coupon engine unless checkout evidence justifies it;
- digital product delivery platform;
- achievements unrelated to useful seller outcomes;
- bulletin/social feed;
- broad referral program;
- a generic workflow/automation platform;
- an independent heavyweight analytics stack before event-derived analytics proves insufficient;
- multiple distributed caches by default;
- generic event bus introduced before a proven need;
- microservice decomposition without measured operational need.

Features can be reintroduced through later ADRs/specifications when they support the product vision without undermining simplicity.

## Target first vertical slice

```text
signup
  -> merchant created
  -> KYC submitted
  -> admin approves
  -> API credential issued
  -> POST Pix charge
  -> provider creates Pix payload
  -> QR representation displayed
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
POST /v1/payments                   # preferred clean V2 payment resource candidate
POST /v1/transactions               # compatibility surface if retained
GET  /v1/payments/{id}              # canonical payment
GET  /v1/payments                   # merchant payment list
GET  /v1/balance                    # merchant financial balance
POST /v1/webhooks/test              # optional merchant webhook validation
```

Exact naming and compatibility with legacy payloads are not approved until the public API specification closes.

Create operations must define first-class idempotency rather than relying only on optional merchant external references.

## Canonical Pix payment minimum

A Pix payment should contain at minimum:

- SwiftPay payment ID;
- merchant ID;
- environment;
- amount in cents;
- currency (`BRL` initially);
- canonical status;
- stable create idempotency reference;
- optional external merchant reference;
- customer snapshot required for provider/payment record;
- provider routing result;
- provider payment/tx identifier(s), private from merchant contract where appropriate;
- Pix copy-and-paste payload;
- expiration;
- completion timestamp;
- end-to-end ID when available;
- merchant fee;
- provider cost/fee when known;
- merchant net/settlement amount;
- metadata;
- checkout/link/campaign attribution where applicable;
- webhook association.

QR image rendering is a presentation concern derived from the valid Pix payload; the financial record should not depend on storing a heavyweight QR image artifact.

## Canonical status direction

Initial payment state-machine candidate:

```text
created
  -> pending
  -> paid
  -> expired
  -> failed
  -> cancelled
```

Refunded states are added according to the dedicated refund specification after the legacy refund audit.

Internal processing locks must not become externally visible business statuses unless there is a clear contract need.

## Fee direction

Initial Pix fee model should support:

- platform default fee;
- per-merchant override;
- fixed amount;
- percentage in basis points;
- fixed + percentage;
- provider cost stored independently from merchant fee;
- deterministic snapshot on payment creation.

Different fee schedules for API, checkout and payment link should only exist if the business intentionally prices those channels differently.

## Ledger direction

Ledger must be canonical for financial movement.

Minimum conceptual accounts are expected to include some subset of:

- merchant pending;
- merchant available;
- merchant blocked (for payout);
- merchant reserved (only if reserves are required);
- provider settlement/clearing;
- platform revenue/fee or a clearly defined equivalent;
- wallet top-up clearing/account semantics if top-up is approved by fund-flow analysis.

The exact chart of accounts is not approved until the fund-flow analysis is complete.

## Provider direction

The current planning baseline favors **native thin Pix adapters** because the preliminary Hyperswitch audit did not find first-party exact-brand connectors for the 12 legacy SwiftPay provider names.

Hyperswitch remains an architectural option only if a later retained-provider/future-expansion analysis demonstrates that its orchestration value exceeds the additional runtime and connector complexity.

No product domain should depend directly on provider-specific contracts.

## Supabase role

Supabase is the accepted platform foundation with boundaries defined in ADR 0003:

- PostgreSQL;
- Auth;
- Storage;
- Realtime where useful;
- SQL migrations/functions;
- managed platform primitives where they fit the workload.

SwiftPay still owns an application/API boundary. Financial actions must not be implemented as arbitrary browser writes to financial tables.

The architecture should preserve portability by keeping PostgreSQL migrations/schema canonical in the repository and isolating replaceable Supabase-specific services behind explicit infrastructure boundaries where practical.

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
- rollback/recovery from partial external failure;
- analytics not counting wallet top-ups as sales;
- checkout event deduplication where events influence conversion metrics;
- unknown financial states represented honestly in UI/API.

## Migration stance

No direct rewrite-in-place.

Legacy remains operational reference until V2 reaches parity for the explicitly retained scope. Data migration and cutover require a separate approved specification.