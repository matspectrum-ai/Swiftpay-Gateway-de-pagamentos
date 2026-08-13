# Legacy SwiftPay — Initial Capability Inventory

Status: In progress. This is an evidence-backed seed, not the completed line-oriented audit.

Legacy repository: `SwiftPay-Prod/swiftpay---Prod`

## System shape observed

The legacy platform is a broad payment/business platform composed of:

- shared .NET core/domain/infrastructure library;
- management API;
- payment API;
- merchant/admin Next.js application;
- public checkout Next.js application;
- PostgreSQL;
- RabbitMQ/MassTransit;
- Hangfire;
- Valkey/Redis;
- Firebase/Firestore components;
- email delivery infrastructure;
- object storage;
- realtime/SignalR;
- multiple Pix/payment providers.

The V2 must not assume all of these components remain necessary.

## Initial domain inventory

| Legacy capability | Evidence observed | V2 initial decision | Notes |
|---|---|---|---|
| Users/auth | management API + auth entities | REPLACE/SIMPLIFY | Supabase Auth candidate; preserve authorization semantics, not custom token machinery by default |
| Merchant | `Merchant` model/lifecycle | KEEP_CONCEPT | Central tenant/business entity |
| KYC | merchant KYC entities + admin evaluation | SIMPLIFY | Preserve approval/rejection/complement flow if required; reduce notification/email coupling |
| Merchant settings | very broad method-specific settings | SIMPLIFY | Pix-only removes boleto/card matrices |
| Platform settings | broad global defaults | SIMPLIFY | Keep only target-product settings |
| API credentials | merchant API credential domain | KEEP_CONCEPT | Public gateway authentication still required |
| Acquirers/providers | `Acquirer`, `MerchantAcquirer`, adapters | KEEP_CONCEPT/REPLACE | Decide native thin adapters vs Hyperswitch |
| Pix | create/status/webhook lifecycle | KEEP_CONCEPT | Core V2 payment method |
| Card | legacy support exists | REMOVE from initial V2 | Avoid PCI surface entirely |
| Boleto | legacy support exists | REMOVE from initial V2 | Not part of initial target |
| Payment entity | generic multi-method aggregate | SIMPLIFY | Replace with Pix-oriented payment/charge model unless future-proofing proves low-cost |
| PaymentPix | Pix QR/txid/payer details | KEEP_CONCEPT | Can likely collapse into `payments` plus provider attempts/details |
| Customers | customer entity/hydration | SIMPLIFY | Keep only data genuinely needed by merchant/provider |
| Provider routing | active merchant-acquirer + A/B nominal routing | SIMPLIFY/DEFER | Start deterministic; add advanced routing only when justified |
| Provider credentials | JSON-based defaults/merchant overrides | SIMPLIFY | Store encrypted server-side; define explicit schemas |
| Webhook normalization | payment processing service | KEEP_CONCEPT | Critical provider boundary |
| Merchant callbacks/webhooks | callback state on payments + queues/services | KEEP_CONCEPT | Move to dedicated deliveries/events model |
| Fees | platform/merchant/acquirer fee matrices | SIMPLIFY | Pix fee model only; preserve provider cost vs merchant fee distinction |
| Reserve/compensation | merchant settlement/reserved balances | UNRESOLVED | Keep only if business/provider settlement requires it |
| Ledger | account + transaction + entry | KEEP_CONCEPT | Rebuild smaller and database-transactional |
| Merchant balance | derived/read model + account balances | SIMPLIFY | Ledger remains canonical; balance may be view/materialized/read model |
| Refunds | full/partial refund behavior | DEFER/UNRESOLVED | Product decision needed for V2 first slice |
| Payout/cashout | merchant withdrawals, approval, provider Pix-out | KEEP_CONCEPT | Required if SwiftPay holds merchant balance before withdrawal |
| Platform payout | internal platform settlement | DEFER/UNRESOLVED | Depends on provider fund-flow model |
| Bank reconciliation | dedicated service/entities | KEEP_CONCEPT/SIMPLIFY | Need reconciliation, but not necessarily legacy implementation |
| Sandbox/production isolation | query filters/environment flags | KEEP_CONCEPT | Implement simpler explicit environment semantics |
| Checkout | broad configurable checkout | SIMPLIFY/DEFER | First version should be minimal Pix checkout |
| Payment links | links/domains/branding | SIMPLIFY/DEFER | Can be layered after core gateway works |
| Orders | ecommerce order domain | DEFER | Not required for payment gateway vertical slice |
| Products/catalog | physical/digital/service products | REMOVE/DEFER | Separate commerce product from core gateway unless explicitly approved |
| Coupons | commerce capability | REMOVE/DEFER | Same reason |
| Digital delivery | commerce capability | REMOVE/DEFER | Same reason |
| Stock | commerce capability | REMOVE/DEFER | Same reason |
| Email templates/platform | complex custom email subsystem | REPLACE/SIMPLIFY | Use a small transactional email boundary |
| Notifications/push | dashboard/product UX | DEFER | Not required for first financial slice |
| Referrals | business growth domain | REMOVE/DEFER | Not gateway core |
| Achievements/rankings | gamification | REMOVE | Not gateway core |
| Bulletins | product/admin communications | REMOVE/DEFER | Not gateway core |
| Dashboard caches | precomputed KPI tables | REPLACE | Prefer SQL views/queries/materialized views only if proven necessary |
| RabbitMQ/MassTransit | async messaging | REPLACE/DEFER | Introduce queue only for flows that need durable async execution |
| Hangfire | jobs | REPLACE/DEFER | Prefer Supabase/DB/managed scheduler or explicit worker where justified |
| Valkey/Redis | cache/rate/runtime support | DEFER | Do not add until measured need |
| Firebase/Firestore | auth/email/realtime-related legacy work | REPLACE | Supabase is target foundation |
| Object storage | KYC/assets/files | REPLACE | Supabase Storage candidate |
| SignalR/realtime | dashboard realtime | REPLACE/DEFER | Supabase Realtime candidate |

## Financial core observed

### Accounts

Legacy account concepts include:

- merchant pending;
- merchant available;
- merchant blocked;
- merchant reserved;
- merchant payouts out;
- platform blocked;
- platform payouts out;
- acquirer settlement;
- acquirer payouts out.

V2 should not copy the full chart of accounts until each account has a target fund-flow justification.

### Ledger

Legacy model uses:

- `Account`;
- `LedgerTransaction`;
- `LedgerEntry`;
- atomic balance updates in repository/service code.

This concept is strong and should survive. V2 should move more integrity into PostgreSQL transactions/functions and use append-only postings with explicit idempotency.

### Payment completion

Observed legacy behavior includes:

- pending balance movement;
- merchant settlement amount;
- optional reserve;
- provider/acquirer settlement accounting;
- platform fee vs provider fee distinction;
- special handling when provider auto-splits platform fee;
- idempotency checks against ledger transaction/payment operation.

These are not safe to simplify until the target provider fund-flow is specified.

## Pix creation behavior observed

The current flow combines several responsibilities:

- validate payment method and input;
- hydrate/create customer;
- select merchant/provider configuration;
- check provider readiness/capabilities;
- enforce merchant/provider limits;
- resolve merchant fee context (API/checkout/payment link);
- calculate platform fee;
- calculate provider fee;
- calculate settlement/reserve;
- create canonical payment;
- call provider to create Pix;
- persist Pix identifiers/QR code;
- publish pending ledger work;
- track provider nominal metadata;
- trigger notifications.

V2 should separate these responsibilities into explicit domain/application boundaries.

## Legacy behavior that must not be copied blindly

### Synthetic customer data

The current Pix transaction path can generate fallback CPF, email, phone and name values when required customer fields are absent.

V2 default: provider-required customer fields must be explicit and validated. Synthetic identity data should not be invented unless a provider contract and legal/product decision explicitly requires a controlled substitute.

### Multi-method model complexity

Legacy models and settings repeatedly branch across Pix, boleto and credit card. Initial V2 is Pix-only, so these branches should disappear rather than remain disabled.

### Broad ORM context

Legacy `PrimaryDbContext` owns a very large number of unrelated domains and relationships. V2 should use a smaller schema organized around clear bounded contexts and SQL migrations rather than recreating one giant application context.

### Asynchronous fan-out by default

Legacy financial/product flows use queues, consumers, jobs and multiple caches. V2 must justify durable asynchrony per flow. Simplicity is a requirement, not merely a preference.

## Provider abstraction observed

The legacy provider interface is conceptually small:

- generate Pix;
- get Pix status;
- withdraw/Pix-out.

A factory resolves a provider implementation by provider type.

This boundary is worth preserving conceptually even if Hyperswitch becomes the implementation behind it.

## Known provider set in current model

Observed provider enum currently includes:

- Bankizi
- IHubBanking
- ActivePayments
- Rapdyn
- Coldfy
- Pluggou
- HunterPay
- HeartPay
- Accithus
- MagicPay
- AkkadPag
- FlevoPay

The audit must inspect each current provider implementation before any migration decision.

## Open questions

- Which providers are actually active/production-critical?
- Is SwiftPay's legal/fund-flow model custodial, pass-through, split-based or mixed per provider?
- Which ledger accounts are legally/accountingly required versus implementation-derived?
- Must V2 support refunds in first release?
- Must V2 support merchant self-service withdrawal in first release?
- Which KYC fields are actually required by SwiftPay versus specific providers?
- Is checkout/payment link first-release scope or second-wave scope?
- Should Hyperswitch own provider orchestration, or is a native Pix-only adapter layer materially simpler?
- Which public API fields/paths must remain backward-compatible?

## Next audit targets

1. Complete provider-by-provider source review.
2. Complete `LedgerService`/repository posting matrix.
3. Complete `CashoutService`/withdrawal state machine.
4. Map public payment API endpoints and contracts.
5. Map webhook consumers and retry/idempotency behavior.
6. Map authentication/API-key/security layers.
7. Map KYC/onboarding endpoints and storage usage.
8. Map frontend capabilities against retained V2 scope.