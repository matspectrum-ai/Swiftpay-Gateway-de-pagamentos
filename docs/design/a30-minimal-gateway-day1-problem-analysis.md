# A30 — Minimal Pix Gateway Day-1 Problem Analysis

Status: FROZEN FOR SPEC
Date: 2026-09-05

## Goal

Ship the smallest merchant-usable Pix gateway surface by reusing the already accepted SwiftPay V2 financial/database/runtime foundations instead of rewriting the financial core.

The requested product surface is:

- public REST Pix API with public OpenAPI documentation;
- merchant balance;
- merchant webhooks;
- withdrawals / Pix-out;
- customers;
- integrations;
- transactions;
- transfers;
- multiple merchants;
- multiple accounts;
- multiple organizations/workspaces per merchant;
- merchant dashboard;
- platform admin dashboard.

## Existing accepted foundation

The repository already has accepted contracts/implementation for merchant/environment foundations, API credentials, payment idempotency, provider attempts/events, double-entry ledger, balance projection, durable jobs, merchant webhooks, payout/refund database foundations, financial reservations, authenticated Sandbox Pix create/get, transaction list/detail, API credential management, webhook endpoint management, dashboard context, payment links and hosted Sandbox database E2E.

A30 MUST reuse these primitives rather than create a second financial engine.

## Core simplification decisions

### 1. No financial-core rewrite

A30 does not port the existing TypeScript/PostgreSQL financial core to Go. A language rewrite would invalidate substantial accepted executable evidence without adding merchant capability. Go-fintech invariants are used as review criteria: exact money, immutable ledger, idempotency, explicit external ambiguity, payout reservation and reconciliation.

### 2. Modular monolith

Keep one public API runtime, one worker boundary when asynchronous retry is required, one dashboard application and one PostgreSQL financial source of truth. No Redis, RabbitMQ, Kafka, microservice split or Hyperswitch is introduced by A30.

### 3. Organization is a merchant sub-workspace

A `merchant` remains the legal/commercial tenant boundary. A merchant may own many `organizations` used as operational workspaces. Organization isolation MUST never weaken merchant isolation.

Day-1 organization scope is intentionally narrow:

- organizations are CRUD resources under one merchant;
- API credentials, customers, webhook endpoints and integration configurations may be organization-scoped;
- existing merchant-wide financial state remains authoritative until an explicit organization-financial-partition contract is accepted;
- a default organization preserves compatibility for existing merchant-scoped flows.

This avoids silently changing historical ledger ownership.

### 4. Accounts are views over the ledger, not mutable wallets

An account is a named financial account/projection backed by ledger entries. No API may set or increment a balance directly.

Day-1 exposes merchant financial accounts and statement data read-only except through approved payment/payout commands.

### 5. Transfer and withdrawal share one money-movement engine

Do not implement separate financial engines for `transfer`, `withdrawal` and `pix_out`.

The canonical outbound-money resource is `payout`.

UI may label payouts as “Transferências / Saques”. Public API uses `/v1/payouts`. Provider capability decides whether the destination can be executed as Pix-out.

### 6. Customers are lightweight

Customer records are merchant/organization-owned references used to reduce repeated payer input. They are not an ecommerce CRM. Minimum fields: id, merchant_id, optional organization_id, name, document, email, phone, external_ref, metadata, created_at, updated_at. Only fields actually required by provider/payment contracts are mandatory for Pix creation.

### 7. Integrations are configuration, not arbitrary code

Day-1 integration types:

- API credentials;
- outgoing merchant webhook endpoints;
- Pix provider configuration/status (admin-controlled);
- optional named external integrations already supported by existing contracts.

No generic workflow engine is introduced.

## REST surface target

Public merchant API:

- `POST /v1/auth/token`
- `POST /v1/transactions`
- `GET /v1/transactions`
- `GET /v1/transactions/{id}`
- `GET /v1/balance`
- `GET /v1/accounts`
- `GET /v1/accounts/{id}/statement`
- `POST /v1/payouts`
- `GET /v1/payouts`
- `GET /v1/payouts/{id}`
- `GET /v1/customers`
- `POST /v1/customers`
- `GET /v1/customers/{id}`
- `PATCH /v1/customers/{id}`

Dashboard/admin-only API may expose merchant, organization, credential, webhook, integration and provider-management resources under authenticated dashboard/admin namespaces rather than public machine credentials.

## OpenAPI

`openapi/swiftpay-v1.yaml` is canonical and public-safe.

It MUST document:

- authentication;
- `Idempotency-Key` on financial create operations;
- integer centavo money representation;
- canonical statuses;
- error envelope;
- pagination;
- webhook event envelope and verification;
- Sandbox vs Production semantics;
- examples containing no real secrets/PII.

A rendered documentation route may use Scalar or Swagger UI, but the YAML file remains canonical.

## Financial invariants

- BRL amounts are integer centavos; binary floating point is forbidden.
- Posted ledger entries are immutable and append-only.
- Account balances derive from ledger evidence or transactionally coupled projections.
- Same authenticated financial operation identity produces at most one committed financial effect.
- Same idempotency key with different semantic input is a conflict.
- Payout request reserves available funds atomically before external execution.
- External timeout/connection loss after transmission is `execution_unknown` until provider evidence resolves it; funds are not silently released.
- Provider webhook authenticity is verified before financial authority is granted.
- Duplicate/out-of-order provider events cannot post money twice or regress a terminal payment state.
- Provider identifiers/status vocabulary do not leak into the public merchant contract unless explicitly normalized.

## Security boundaries

- Supabase Auth is for human dashboard identity.
- Merchant machine API credentials remain a separate credential domain.
- Provider credentials and Supabase secret/server credentials are server-only.
- Browser code has no arbitrary financial-table write authority.
- Merchant and organization authorization is fail-closed.
- Sensitive financial data and secrets are not logged.
- RLS remains enabled for any exposed-schema merchant data; privileged financial tables remain outside direct browser/Data API authority where currently designed.

## Day-1 non-goals

- direct SPI/DICT participation;
- becoming a regulated Pix participant by software alone;
- credit card/boleto;
- full KYC operations;
- refunds UI;
- complex analytics;
- generic automation engine;
- production activation of a provider without provider-owned idempotency/recovery/webhook evidence;
- rewriting accepted financial/database contracts into a different language.

## External dependency

Real Pix execution requires an upstream Pix participant/PSP/provider adapter with evidenced credentials, Pix-create/query semantics, webhook authenticity, payout capability and ambiguous-result recovery. Until that provider is explicitly activated, Production monetary calls remain fail-closed while Sandbox stays usable.

## Acceptance outcome

A30 is complete when a merchant can log in, select one of its merchants/organizations, create and manage API/webhook integration credentials, create/list/get Sandbox Pix transactions, inspect ledger-backed balance/accounts, manage lightweight customers, request/list payouts under a safe payout state machine, and use a public OpenAPI document; platform admin can inspect/manage merchants, organizations, integrations, transactions and payouts without direct balance mutation.
