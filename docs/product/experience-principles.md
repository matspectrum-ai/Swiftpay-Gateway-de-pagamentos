# SwiftPay V2 — Merchant Experience Principles

Status: Approved direction, detailed interaction specs pending

## Objective

SwiftPay should be powerful enough for advanced digital-selling operations while remaining understandable to someone who has never configured a payment gateway.

The experience model is inspired by products that expose significant capability through a small, composable mental model: the user manipulates business concepts, not infrastructure.

## Non-negotiable UX rules

### Every screen answers one primary question

- Home: **How is my operation today?**
- Sales: **What happened to my sales?**
- Conversion: **Where am I losing or gaining revenue?**
- Wallet: **How much money do I have and where is it?**
- Automations: **What is SwiftPay doing automatically?**
- Integrations: **What is SwiftPay connected to?**

If a screen cannot state its primary question, its scope is probably too broad.

### Default first, configuration second

A new merchant should not be blocked by choices that SwiftPay can safely default.

Examples:

- provider routing defaults to Swift mode;
- payment link starts with amount + description;
- checkout starts with a usable template;
- automation starts with a proven template;
- analytics starts with the metrics most sellers actually act on.

Advanced controls are revealed deliberately rather than shown permanently.

### Actions use seller language

Prefer:

- Create sale
- Create checkout
- Create link
- Generate Pix
- Add balance
- Make Pix
- Recover sales
- View conversion

Avoid making internal nouns the primary action labels:

- ledger posting;
- acquire settlement;
- provider status normalization;
- webhook dispatcher;
- reconciliation bucket.

### Explain money with human-readable buckets

The default wallet view should expose a small set of concepts:

- Available
- To receive / Pending
- In payout / Blocked
- Reserved only if the product requires reserves and the merchant genuinely needs to understand them

The ledger remains richer internally.

### One canonical timeline for a sale

A seller should be able to open a sale and understand its complete history without cross-referencing multiple modules.

Candidate timeline:

```text
Checkout viewed
Pix generated
Pix copied
Payment approved
Merchant webhook delivered
Funds available
```

Provider/internal details belong in an expandable advanced section.

## Home experience

The dashboard should prioritize a small set of high-signal metrics rather than a dense grid of unrelated cards.

Recommended first viewport:

- revenue for selected period;
- conversion rate;
- approved sales;
- lost/recoverable sales value;
- available balance;
- primary sales funnel;
- one to three actionable insights.

Example insight language:

- "R$ 8.720 in generated Pix expired without payment."
- "Provider A is converting 7.4% better than Provider B on this checkout."
- "Campaign X has a materially higher checkout-to-payment conversion rate."

Insights must include enough evidence to avoid presenting weak correlations as facts.

## Create sale interaction

The global create action should not require users to understand payment infrastructure.

```text
Create sale
  -> Checkout
  -> Payment link
  -> Quick Pix
```

Developer/API creation remains available from developer surfaces rather than cluttering the non-technical path.

## Checkout experience

### Seller setup

Minimum setup:

- name/title;
- amount;
- optional product/description;
- logo;
- brand color;
- required buyer fields;
- post-payment redirect.

Advanced settings may include:

- domain;
- expiration;
- metadata;
- campaign tracking;
- provider strategy;
- webhook/automation behavior.

### Buyer payment

The buyer should not need a SwiftPay account.

Primary Pix payment surface:

```text
Merchant brand
Amount
QR Code
Copy Pix code
Payment status
```

The page should update to a paid state without requiring manual refresh when supported.

The merchant's brand is primary; SwiftPay attribution is secondary/discreet.

## Payment link experience

Default creation should be possible in seconds.

Required input should be minimal. After creation, surface immediate actions:

- Copy link
- Open
- Share
- WhatsApp
- Show QR

Analytics belong to the link automatically rather than requiring the merchant to configure tracking separately.

## Conversion experience

Conversion should be presented as a funnel with drill-downs rather than as a generic analytics warehouse.

Core funnel:

```text
Checkout views
  -> Checkout starts
  -> Pix created
  -> Payment approved
```

Primary breakdowns:

- checkout/link;
- UTM source/campaign;
- provider;
- device/source where reliable;
- time period.

Metrics must define denominators precisely. "Conversion" must never be ambiguous in the implementation or UI.

## Provider selection experience

Conceptual modes:

### Swift

Recommended default. SwiftPay chooses an eligible provider according to approved routing criteria.

### Manual

The merchant selects one enabled provider.

### Strategy

Advanced users configure routing weights/fallbacks/constraints.

Provider health, capability and financial-safety constraints override user preferences when continuing would violate a financial or operational invariant.

## Automation experience

Do not build a generic automation IDE for the initial product.

Use a constrained visual model:

```text
When [event]
If   [optional condition]
Then [action]
```

Examples:

```text
When Pix expires
Wait 10 minutes
If still unpaid
Send WhatsApp recovery
```

```text
When payment is approved
Send conversion event to UTMify
Notify Telegram channel
```

Templates are a primary onboarding surface.

## Developer experience

A developer should be able to create a Pix integration from a small REST contract without knowing the selected PSP.

Preferred happy path:

```http
POST /v1/payments
Authorization: Bearer <token>
Idempotency-Key: <stable-key>
```

The exact public API is defined separately, but the experience should preserve:

- canonical resource IDs;
- stable status vocabulary;
- explicit idempotency;
- predictable error envelopes;
- signed webhooks;
- sandbox parity;
- provider implementation hidden by default.

## Observability without overload

SwiftPay must provide strong operational observability without turning the default seller UI into a monitoring console.

Seller UI:

- sale timeline;
- conversion funnel;
- webhook delivery status where actionable;
- provider used/result when requested;
- money state.

Advanced/admin/developer UI:

- provider request correlation IDs;
- normalized/raw statuses where safe;
- webhook attempts;
- event IDs;
- reconciliation status;
- financial posting references;
- incident context.

## Performance experience targets

Detailed SLOs are specified later, but product design assumes:

- checkout is mobile-first and fast to interactive;
- Pix QR appears immediately after the provider returns a valid payload;
- QR rendering itself is local and must not add meaningful network latency;
- payment confirmation updates without full-page refresh when the environment supports it;
- slow provider behavior is represented explicitly rather than freezing the UI indefinitely.

## Accessibility and trust

Financial UX must avoid deceptive urgency, hidden fees and ambiguous state.

At minimum:

- monetary amounts are formatted consistently;
- status does not depend on color alone;
- destructive or monetary actions have clear consequences;
- fees are explainable before commitment where applicable;
- pending/unknown states remain visibly pending/unknown instead of being presented as failed or successful prematurely.

## Review checklist

Before approving a new merchant-facing feature, ask:

1. What user question does this solve?
2. Can it reuse an existing canonical domain object/event?
3. What is the simplest safe default?
4. Which advanced controls can remain hidden?
5. Does the user need to know this internal concept at all?
6. Does the UI distinguish facts from estimates?
7. Does simplifying the UI preserve the financial/security contract?