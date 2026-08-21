# SwiftPay V2 — Product Vision

Status: Approved direction, subject to detailed Phase 1 specifications

## Category

SwiftPay V2 is not intended to be another generic payment gateway with a different visual shell.

The product direction is:

> **Payments + Conversion Intelligence + Revenue Automation for digital sellers.**

SwiftPay is designed first for digital marketing operations: sellers, creators, infoproduct businesses, media buyers, agencies, affiliates, SaaS operators and teams that care not only about receiving money, but also about understanding and improving conversion.

Payment processing remains the financial core. The differentiation is the experience around that core.

## Product promise

SwiftPay should make it unusually easy to:

1. sell;
2. understand what converts;
3. understand where revenue is being lost;
4. recover lost sales;
5. automate repetitive revenue operations;
6. receive, hold and move operational balance through supported financial partners;
7. integrate SwiftPay into code and external platforms without learning provider-specific payment behavior.

The user should not need to understand SwiftPay's internal architecture, provider topology, ledger structure or event plumbing to use the product correctly.

## Product principles

### 1. Large in capability, small in architecture

A feature-rich product must not imply a feature-specific backend for every surface.

Checkout, payment links, quick Pix and REST API should all create the same canonical payment object.

Analytics should be derived from the same canonical product/payment event stream.

Automations should consume those same events rather than invent a parallel event model.

Wallet movements should use the same financial ledger rather than creating separate balance logic.

### 2. Progressive disclosure

Default paths must be obvious to non-technical sellers. Advanced configuration appears only when requested.

Examples:

- provider choice defaults to Swift routing, while manual and strategy modes remain available;
- a payment link can be created with amount + description, while advanced fields remain optional;
- automation starts from templates instead of an empty generic workflow canvas;
- checkout branding starts with logo + color + domain rather than a full website builder.

### 3. Speak the seller's language

The product should prioritize business questions over infrastructure metrics.

Prefer:

- revenue;
- conversion;
- approved sales;
- lost sales;
- recoverable revenue;
- available balance;
- pending balance;
- payout in progress;
- campaign/UTM performance;
- provider conversion.

Avoid exposing internal financial/accounting implementation terminology unless the user enters an advanced operational or developer view.

### 4. Complexity belongs to SwiftPay

Provider payloads, provider statuses, retries, idempotency, webhook verification, canonicalization, financial posting and reconciliation are SwiftPay responsibilities.

The merchant contract should remain small and predictable.

### 5. Financial correctness is never traded for UX simplicity

Simple interfaces may hide complexity, but they must not weaken:

- source-event idempotency;
- transactional ledger guarantees;
- provider authentication;
- payout unknown-result handling;
- tenant isolation;
- auditability;
- reconciliation.

## The five user concepts

The merchant-facing product should be organized around a small number of durable mental models.

### Home

Answers: **How is my operation performing right now?**

Primary information:

- revenue today / period;
- conversion rate;
- approved sales;
- lost sales;
- recoverable revenue;
- available balance;
- funnel snapshot;
- anomalies and actionable insights.

### Sales

Answers: **What am I selling and what happened to each sale?**

Contains:

- transactions;
- checkout;
- payment links;
- quick Pix;
- customer/payment context;
- status timeline;
- refunds where approved;
- provider routing outcome in advanced views.

### Conversion

Answers: **Where am I losing money and what converts better?**

Contains:

- checkout funnel;
- views -> checkout starts -> Pix created -> Pix paid;
- conversion by checkout;
- conversion by UTM/campaign;
- conversion by source/device where data is valid;
- conversion by provider;
- lost/recoverable revenue;
- actionable observations.

### Wallet

Answers: **How much money do I have and where is it?**

Contains:

- available;
- pending/receivable;
- blocked/in-payout;
- statement;
- receive/top-up where supported;
- Pix-out/payments where supported;
- payout accounts and withdrawals.

### Automations & Integrations

Answers: **What is SwiftPay doing for me, and what is it connected to?**

Contains:

- recovery workflows;
- WhatsApp;
- email;
- Telegram;
- UTMify;
- n8n;
- outgoing webhooks;
- REST API;
- OpenAPI;
- SDKs;
- CLI;
- agent/MCP integrations where approved.

The exact navigation can evolve, but the product should not expose dozens of unrelated top-level modules.

## Core selling surfaces

SwiftPay must support four primary ways to receive Pix-based payment:

1. **Checkout** — branded hosted conversion surface with analytics instrumentation.
2. **Payment Link** — instant shareable payment surface.
3. **Quick Pix** — seller generates QR/copy-and-paste immediately.
4. **REST API** — merchant application creates Pix directly.

These are interfaces over a single canonical payment engine.

```text
Checkout ------\
Payment Link ---+--> create_payment() --> provider router --> Pix
Quick Pix ------+
REST API -------/
```

## Checkout direction

Checkout is a first-class product, not an optional QR page.

Minimum product goals:

- extremely fast load and payment generation;
- no buyer account requirement;
- merchant logo/color/domain branding;
- responsive mobile-first layout;
- QR + copy-and-paste Pix;
- real-time payment confirmation;
- configurable buyer fields;
- post-payment redirect;
- UTM capture;
- funnel event instrumentation;
- conversion analytics.

SwiftPay branding should remain discreet on merchant checkout surfaces. The merchant's brand is primary.

## Payment Link direction

Payment links should be creatable with minimal input:

- amount;
- short description;
- optional buyer information requirements;
- optional expiration/redirect/metadata.

A created link should immediately provide:

- shareable URL;
- QR representation;
- copy/share actions;
- WhatsApp share path;
- conversion metrics.

## Conversion intelligence

The canonical event vocabulary should support at least:

- `checkout_viewed`;
- `checkout_started`;
- `pix_created`;
- `pix_copied` where measurable;
- `payment_approved`;
- `payment_expired`;
- `payment_failed`;
- `payment_refunded` where supported.

From these events SwiftPay should be able to derive, without a separate giant BI subsystem:

- revenue;
- approved sales;
- lost sales;
- conversion rate;
- funnel drop-off;
- average ticket;
- conversion by checkout;
- conversion by UTM/campaign;
- conversion by provider;
- recoverable revenue estimates.

Analytics must clearly distinguish measured facts from inferred/estimated opportunities.

## Provider choice and routing

The product should support three conceptual modes:

1. **Swift** — SwiftPay chooses a provider using an approved strategy.
2. **Manual** — merchant chooses a specific enabled provider.
3. **Strategy** — advanced routing/fallback configuration.

The first implementation may support only a subset, but the domain model should avoid coupling a payment permanently to a single globally configured provider.

Future optimization may use provider conversion/performance evidence, but financial correctness, capability compatibility and operational health always override marketing optimization.

## Revenue automation

SwiftPay should not attempt to recreate n8n as a generic automation platform.

The initial automation model is intentionally constrained:

```text
EVENT -> optional CONDITION -> ACTION
```

Candidate events:

- payment created;
- Pix generated;
- payment approved;
- payment expired;
- refund completed;
- payout completed;
- checkout abandoned where measurable.

Candidate actions:

- send WhatsApp message;
- send email;
- notify Telegram;
- send webhook/HTTP request;
- send event to UTMify;
- invoke n8n-compatible webhook;
- apply an internal customer/tag action if that domain is approved.

The UX should start from templates such as "Recover unpaid Pix" rather than a blank workflow editor.

## Wallet / adding balance

SwiftPay should support the product concept of adding operational balance where the provider/legal model allows it.

An initial implementation may be:

```text
merchant requests top-up
  -> SwiftPay creates a Pix charge through an approved financial provider
  -> provider confirms receipt
  -> canonical wallet_topup source event is posted
  -> ledger credits the appropriate merchant wallet account
```

A top-up is **not a sale** and must not inflate:

- revenue;
- conversion;
- approved sales count;
- average ticket;
- seller ranking.

The UI can say "Add balance" while the financial core records the correct source type.

Dedicated Pix keys, custody and banking-account semantics are not assumed. They require an approved partner/regulatory/fund-flow model.

## Revenue ranking

Ranking is a desired marketing/community capability, but it must remain isolated from the financial core.

Product direction:

- opt-in participation;
- daily/weekly/monthly views where useful;
- revenue and possibly conversion/growth categories;
- privacy controls for seller identity and values;
- derived strictly from canonical eligible sales, never wallet top-ups.

It is not required for the first financial vertical slice.

## Developer experience

SwiftPay should be unusually easy to integrate by both humans and coding agents.

Target surfaces, introduced incrementally:

- REST API;
- canonical OpenAPI specification;
- excellent webhook documentation;
- TypeScript SDK;
- CLI/bootstrap flow;
- integration examples;
- n8n integration/node when justified;
- MCP server/tool surface for safe read and non-dangerous actions where approved;
- agent-readable documentation for tools such as Claude Code, Codex and other compatible coding agents.

Financially dangerous actions must not become easier to execute than they are to authorize safely.

## Product success criteria

SwiftPay V2 succeeds when a non-technical digital seller can create and understand a sale without training, while an advanced operator can inspect conversion, providers and money flows without leaving the product.

The product should feel substantially simpler than the number of capabilities it provides.