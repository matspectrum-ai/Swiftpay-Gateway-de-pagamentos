# Legacy Frontend Capability Inventory and V2 Disposition

Status: core frontend capability inventory complete

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Purpose

This document classifies the legacy SwiftPay user-facing capabilities into `KEEP`, `SIMPLIFY`, `REPLACE`, `REMOVE` or `DEFER` for SwiftPay V2.

The goal is not visual parity. The goal is to preserve the seller value that matters while collapsing the product into a smaller mental model and a much smaller backend surface.

## Legacy frontend shape

The legacy system has two Next.js frontends:

1. `swiftpay-web` — merchant/admin panel;
2. `swiftpay-web-checkout` — public buyer checkout/payment-link runtime.

The panel exposes roughly 25 merchant sections and 14 admin sections. The public checkout has separate checkout/payment-link runtimes and supports product/order/stock behavior, payment-method selection and multiple marketing trackers.

V2 must not reproduce this route count as product architecture.

## V2 seller mental model

The canonical seller navigation target is:

```text
Home
Sales
Conversion
Wallet
Automations
Integrations
```

Developer settings and account/security can live behind contextual settings rather than occupy the primary business navigation.

The product rule is:

> Many capabilities, few concepts.

## Merchant capability matrix

| Legacy capability | V2 | Decision |
|---|---|---|
| Merchant dashboard | `REPLACE` | Rebuild as revenue/conversion command center rather than generic financial KPI dashboard. Keep revenue, approved sales, balances, trends and health; add funnel, conversion, lost revenue, UTM and provider performance. |
| Payments + Transactions | `REPLACE` | Collapse into one `Sales` surface. Payment is the canonical domain object; seller should not learn overlapping transaction concepts. |
| Payment Links | `KEEP + SIMPLIFY` | Core product channel. Very fast creation, share/copy/WhatsApp/QR actions, automatic tracking and conversion analytics. |
| Checkout | `KEEP + REPLACE` | Core product channel, but rebuild as a much simpler Pix-first checkout with merchant branding and automatic instrumentation. Do not port the full legacy commerce builder. |
| Transparent checkout / direct API | `KEEP` | First-class channel. Merchant can create Pix directly through REST/SDK without redirecting the buyer to a SwiftPay-hosted page. |
| Quick Pix | `NEW / KEEP DOMAIN` | One-click seller UX over the same Payment Core. Amount + optional description/customer -> QR/copy-paste immediately. |
| Cashouts | `KEEP + SIMPLIFY` | Move into Wallet. Preserve payout history/status and strong financial semantics; simplify the seller flow. |
| Cashout accounts | `KEEP + SIMPLIFY` | Treat as payout/Pix destinations inside Wallet settings rather than a primary module. |
| Balance history | `KEEP + REPLACE` | Present as Wallet statement/extrato from canonical ledger-derived data. |
| Fees | `KEEP + SIMPLIFY` | Seller must clearly understand rates; eliminate configuration complexity that only exists because of legacy payment methods/contexts. |
| API credentials | `KEEP + REPLACE` | Developer surface with one-time secret display, rotation/revocation and strong step-up auth. |
| Integrations | `KEEP + EXPAND` | Strategic differentiator. Rebuild around event-driven connections with clear health/status and templates. |
| Ranking | `KEEP + REPLACE` | Product/community capability, opt-in and isolated from financial core. Initial implementation can be deferred until core sales data is stable. |
| KYC/onboarding | `KEEP + REPLACE` | Smaller Pix-first onboarding, private versioned evidence and an explicit approved-KYC financial gate. |
| Customers | `SIMPLIFY` | Useful as a derived seller CRM-lite/customer history, but should not force a separate customer-management workflow for simple sales. |
| Notifications | `SIMPLIFY` | Keep actionable operational notifications; do not reproduce notification infrastructure breadth by default. |
| Email templates | `DEFER / ABSORB` | Recovery/customer communication belongs under Automations/templates rather than an independent primary module. |
| Products | `DEFER` | Not required to run a gateway/revenue OS. A simple optional offer/product reference may exist later for checkout convenience. |
| Orders | `DEFER` | Avoid rebuilding a commerce/order-management platform in V1. Sales/payment is canonical for the first product. |
| Physical products / stock | `REMOVE from V1` | Logistics and inventory are outside the Pix-first revenue platform scope. |
| Digital delivery | `REMOVE from V1` | Do not make SwiftPay a course/file-delivery platform initially. Integrate with external delivery systems through webhooks/automations. |
| Services catalog | `REMOVE from V1` | Not required for payment/revenue core. |
| Coupons | `DEFER` | Potential conversion feature, but not required for first checkout/payment core. |
| Achievements | `REMOVE from V1` | Gamification is not financial/product-core. Ranking may later provide the community/status layer with much lower complexity. |
| Live Balance / Three.js immersive backgrounds | `REMOVE` | High UI/runtime complexity with little core seller value. |
| Referrals | `DEFER` | Separate business program; not part of first financial spine. |
| Bulletins/about | `REMOVE as product modules` | Use normal support/content surfaces if needed. |
| Docs/help | `KEEP + REPLACE` | Developer docs and contextual product help are important, but should be integrated into the new information architecture. |

## Home / Dashboard V2 contract direction

The legacy dashboard already exposes useful financial information such as:

- available/pending/reserved balance;
- net revenue and total volume;
- approved transactions;
- trends;
- volume charts;
- operational alerts.

V2 preserves these outcomes but changes the question the page answers from:

> What are my financial KPIs?

into:

> How is my operation selling today, where am I losing money, and what should I do next?

The V2 Home should prioritize:

```text
sales volume / net revenue
approved sales
conversion rate
lost sales / lost potential revenue
available / pending / in-payout money
checkout -> pix -> approved funnel
provider conversion/health
campaign/UTM insights
actionable recovery opportunities
```

Do not recreate legacy dashboard cache consumers solely to render these metrics. Analytics/read models should derive from canonical payment and conversion events.

## Sales

`Sales` replaces the user-facing split among payments, transactions and order-centric views for the first V2 release.

A sale can have a source/channel:

```text
api
checkout
payment_link
quick_pix
wallet_topup   # financially distinct; not counted as a sale
```

Seller filters may include:

- approved / pending / expired / refunded;
- source/channel;
- checkout/payment link;
- UTM/campaign;
- provider;
- amount/date/customer.

The same underlying payment object powers all channels.

## Checkout

### What survives

- public hosted checkout;
- merchant logo/color/domain customization;
- Pix QR + copy/paste;
- real-time payment confirmation;
- responsive/mobile-first experience;
- redirect/thank-you behavior;
- first-party UTM/session attribution;
- standardized conversion events;
- seller-visible checkout analytics.

### What is deliberately not ported into V1

- credit card/boleto UI;
- inventory reservation;
- physical shipping/logistics;
- product variant engine;
- large template marketplace;
- complex product/order fulfillment;
- legacy multi-runtime payment-link duplication.

### Runtime simplification

Legacy has separate checkout, fixed payment-link and payment-view templates. V2 should prefer one composable buyer payment runtime:

```text
PaymentExperience
  input: payment / offer / merchant branding / mode
  modes:
    checkout
    payment_link
    payment_view
```

Different UX modes may exist, but they should not duplicate financial/payment logic.

## Payment Links

Payment Links remain mandatory.

Target happy path:

```text
New link
Amount: R$ 197
Description: Consultoria
[Create]

-> shareable URL
-> Copy
-> WhatsApp
-> QR
```

Advanced fields are progressively disclosed.

Every link should automatically expose:

- views;
- Pix created;
- approvals;
- conversion rate;
- revenue;
- expired/lost amount;
- UTM/campaign breakdown when attribution exists.

No separate analytics integration should be required to obtain basic link conversion.

## Transparent Checkout / REST Pix

This is a first-class V2 capability and must not be treated as merely a developer workaround.

The merchant can keep its own frontend and call SwiftPay through a stable API/SDK:

```text
merchant site/app
    -> SwiftPay API create payment
    -> Pix payload/QR data
    -> merchant renders payment inline
    -> provider webhook -> SwiftPay
    -> merchant webhook / polling / realtime-safe status path
```

The buyer does not need to leave the merchant's site.

Hosted Checkout, Payment Link, Quick Pix and Transparent/API Pix all use the same Payment Core.

## Conversion event model

The legacy checkout already standardizes a marketing event sequence and multiple trackers. V2 should make the event model first-party and canonical rather than treating conversion as a third-party tracker concern.

Initial canonical events:

```text
checkout_viewed
checkout_started
payment_created
pix_presented
pix_copied
payment_approved
payment_expired
payment_refunded
```

Additional attribution fields include:

```text
utm_source
utm_medium
utm_campaign
utm_content
utm_term
referrer
landing_url
session_id
checkout_id / payment_link_id
provider_route
```

These events drive SwiftPay's own funnel analytics and can also fan out to integrations.

## Integrations: legacy truth vs V2 direction

The legacy integration UI currently has real configurable provider entries for:

- Utmify;
- Otimizey;
- Facebook CAPI.

Its UI also advertises several `coming soon` integrations:

- Google Ads;
- Zapier;
- n8n;
- HubSpot;
- Target AI;
- Google Analytics;
- Mixpanel.

Therefore the presence of a card/text in the legacy UI is not evidence that the integration is operational.

V2 should classify integrations by implementation status explicitly:

```text
available
beta
coming_soon
```

No fake-connectable card.

### V2 integration priority

High priority:

1. generic merchant webhooks;
2. Utmify;
3. n8n through REST/webhooks first, dedicated node later;
4. WhatsApp recovery provider abstraction;
5. Telegram notifications/bot action;
6. email recovery;
7. Meta CAPI;
8. generic HTTP action.

Later/conditional:

- Google Ads/Analytics;
- Zapier;
- HubSpot;
- other CRMs/analytics tools.

## Automations / SwiftFlows

Do not build a generic n8n competitor.

V2 automation is constrained to the revenue domain:

```text
EVENT -> optional CONDITION -> ACTION
```

Initial triggers can be canonical SwiftPay events. Actions can include:

- send WhatsApp;
- send email;
- send Telegram;
- call webhook/HTTP;
- send Utmify/Meta event;
- add tag/mark customer;
- notify seller.

Templates should be the default entry point, e.g. `Recover unpaid Pix after 10 minutes`.

This provides n8n-like usability without n8n-like platform scope.

## Wallet

Wallet consolidates the legacy financial navigation:

```text
balance
statement
payouts
payout destinations
wallet top-up
Pix-out / make Pix (when approved by fund-flow contract)
```

Seller language should be:

```text
Available
Pending
In payout
```

Detailed accounting buckets remain internal unless needed for support/audit.

Wallet top-up must remain financially distinct from sale revenue and conversion metrics.

## Ranking

Ranking is retained as product direction because it fits the digital-marketing seller community, but it is not a Phase-1 financial dependency.

Requirements before implementation:

- explicit opt-in/privacy controls;
- never expose confidential revenue by default;
- rank only settled/qualified metrics under a defined contract;
- isolate ranking projection from ledger/account truth;
- no dedicated broker/runtime requirement merely for ranking.

Potential dimensions:

- monthly revenue;
- growth;
- conversion;
- community milestones.

## Admin capability matrix

| Legacy admin capability | V2 | Decision |
|---|---|---|
| Admin dashboard | `REPLACE` | Operations/risk/revenue overview from canonical data; smaller surface. |
| Users | `SIMPLIFY` | Supabase Auth identities + SwiftPay profile/roles; admin support actions only. |
| Merchants | `KEEP + REPLACE` | Core merchant profile, capability state and audit history. |
| Merchant KYC evaluation | `KEEP + REPLACE` | First-class KYC case/evidence review. |
| Acquirers/providers | `KEEP + REPLACE` | Provider configuration, capabilities, credentials and health. Do not expose legacy adapter-specific sprawl in one giant config form. |
| Merchant-provider binding/routing | `KEEP + REPLACE` | Support default/allowed routes and later Smart Routing, with explicit policy. |
| Transactions/payments | `KEEP + SIMPLIFY` | Operational payment search/details from canonical Payment model. |
| Cashouts/payouts | `KEEP + REPLACE` | Operational payout/recovery state, including execution-unknown cases. |
| Balances | `KEEP + REPLACE` | Ledger/account inspection and controlled adjustments under strong audit/permissions. |
| Reconciliations | `KEEP + REPLACE` | Separate internal ledger consistency from external provider settlement reconciliation. |
| Logs | `KEEP + REPLACE` | Structured audit/security/provider/webhook/job observability, not arbitrary log-page sprawl. |
| Platform settings | `SIMPLIFY` | Small explicit config domains; remove giant singleton setting object. |
| Checkout templates | `DEFER / SIMPLIFY` | Begin with a small design system and customization schema instead of template platform. |
| Platform payouts | `DEFER` | Only after platform fund-flow/ownership contract is approved. |
| Referrals | `DEFER` | Not financial-core. |
| Dev tools | `REMOVE from production product` | Development/testing utilities belong in controlled non-production tooling. |

## Buyer experience

The buyer should see fewer concepts than the seller.

For Pix:

```text
merchant identity
amount
optional order/offer summary
Pix QR
Copy Pix
payment status
```

No buyer SwiftPay account is required.

The payment confirmation must update without a manual refresh using a safe real-time/polling mechanism.

## Information architecture implication

Legacy route count does not become V2 module count.

Target collapse:

```text
Legacy                         V2
------------------------------------------------
payments + transactions     -> Sales
checkouts + payment links   -> Sales creation channels
balance + history
 + cashouts + accounts      -> Wallet
merchant dashboard          -> Home
tracking/integrations       -> Integrations
email recovery/manual ops   -> Automations
ranking                     -> Community/ranking surface later
```

## Migration / reuse policy

### Reuse conceptually

- useful UX flows;
- Portuguese seller terminology that tests well;
- existing tracking/event knowledge;
- useful visual components/patterns;
- merchant/admin information needs.

### Do not copy mechanically

- route tree;
- page/module count;
- legacy contexts/providers architecture;
- dashboard-cache queue topology;
- commerce catalog/order model;
- three separate buyer payment runtimes;
- SignalR topology merely for parity;
- tracking integration cards that are not actually implemented.

## V2 product invariants derived from this audit

1. Checkout, Payment Link, Quick Pix and REST/Transparent Pix share one Payment Core.
2. The seller has one canonical Sales history.
3. Conversion analytics is first-party product behavior, not an optional external tracker.
4. UTM attribution is captured automatically on SwiftPay-hosted buyer surfaces.
5. Wallet top-up is never counted as sale revenue.
6. Integrations consume canonical events rather than inventing payment semantics independently.
7. Automation remains revenue-domain constrained until there is measured demand for broader workflow semantics.
8. Ranking cannot affect or define financial truth.
9. Buyer checkout remains merchant-branded and low-friction.
10. The primary navigation remains small even as capabilities expand.

## Phase implication

This audit closes the broad frontend capability inventory gate for Phase 0.

The next product/design work is no longer to discover whether Checkout, Payment Links, analytics or integrations survive. They do.

The next work is to specify their V2 contracts and representative UI concepts while completing the remaining financial/data migration gates.