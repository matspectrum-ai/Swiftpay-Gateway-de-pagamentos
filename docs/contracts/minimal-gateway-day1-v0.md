# A30 — Minimal Gateway Day-1 Contract v0

Status: FROZEN
Date: 2026-09-05

This contract is authoritative for the A30 slice. It composes existing SwiftPay V2 payment, ledger, balance, machine-authentication, webhook and payout primitives and adds only the smallest product/API resources required by the Day-1 gateway scope.

## 1. Trust and tenant model

`merchant_id` is the financial and commercial tenant boundary.

`organization_id` is an operational workspace nested under exactly one merchant. It MUST NOT become an alternative way to address another merchant's records.

Human dashboard authorization is derived from a validated Supabase Auth session plus server-authoritative merchant membership. Machine API authorization is derived from the existing SwiftPay API credential/token principal. No merchant or organization identity supplied in a request body can override the authenticated principal.

A default organization MUST be available for legacy merchant-scoped flows. A30 does not repartition historical ledger entries by organization.

## 2. Money contract

All BRL values use integer centavos. Persisted/calculated binary floating point is forbidden.

The ledger remains the financial authority. `balance`, `account` and dashboard KPI responses are projections/read models; none grants authority to mutate money.

Posted ledger entries MUST remain append-only. Corrections use linked reversals or adjustments.

There MUST NOT be an endpoint equivalent to:

- `setBalance`;
- `creditBalance` without a source financial operation;
- `debitBalance` without a source financial operation;
- edit/delete posted ledger entry.

## 3. Idempotency contract

Financial and mutation creates that declare `Idempotency-Key` bind the key to:

- authenticated merchant principal;
- environment;
- operation type;
- canonical semantic request fingerprint.

The first accepted request atomically claims durable identity. Equivalent retries return the stored resource/outcome. Same scoped key with a different semantic fingerprint MUST fail with HTTP `409` and code `idempotency_conflict`.

A process-local mutex or cache is not sufficient idempotency authority.

If an operation reaches an external provider, the local attempt and stable provider/client reference MUST be persisted before the request can become externally effective. Lost responses do not authorize a fresh money-movement identity.

## 4. Organization resource

Canonical server-owned record:

```text
organization
- id: uuid
- merchant_id: uuid
- name: non-empty string
- slug: normalized non-empty string
- status: active | disabled
- is_default: boolean
- metadata: object
- created_at
- updated_at
```

Required invariants:

1. Organization belongs to exactly one merchant.
2. `(merchant_id, slug)` is unique.
3. One merchant has at most one `is_default=true` organization; bootstrap ensures at least one after migration/bootstrap completes.
4. An organization cannot be reassigned to another merchant.
5. Day-1 lifecycle uses disable rather than hard-delete.
6. Organization-scoped child records verify organization ownership against their `merchant_id` in the same transaction.

## 5. Customer resource

Customer is a lightweight reusable payer reference, not a CRM or ecommerce customer engine.

Canonical record:

```text
customer
- id: uuid
- merchant_id: uuid
- organization_id: uuid | null
- external_ref: string | null
- name: string | null
- document: string | null
- email: string | null
- phone: string | null
- metadata: object
- created_at
- updated_at
```

Rules:

- `merchant_id` comes from authenticated authority, never body authority.
- If `organization_id` is supplied, that organization MUST belong to the same merchant.
- No fallback CPF, email, phone or name is synthesized.
- PII returned by APIs is restricted to the authenticated merchant and minimized in ordinary logs/audit payloads.
- If `external_ref` is supplied it is unique inside its merchant/organization scope.
- Updating a customer cannot change `merchant_id`.

## 6. Account and balance contract

`GET /v1/balance` remains the compact merchant balance view.

`GET /v1/accounts` exposes normalized ledger-backed account projections. Day-1 responses MAY aggregate internal chart-of-account rows into merchant-facing buckets, but MUST NOT expose provider-specific accounting mechanics as public API semantics.

`GET /v1/accounts/{id}/statement` returns immutable statement items derived from ledger transactions/entries with opaque cursor pagination.

At minimum statement items expose:

```text
id
occurred_at
operation_type
source_type
source_id
amount_cents
currency
balance_effect: credit | debit
```

No statement item can be edited through the public API.

## 7. Payout / transfer / withdrawal contract

One canonical financial resource represents outbound merchant money: `payout`.

Dashboard labels may say “Transferência” or “Saque”; those labels do not create independent financial state machines.

### Create

```http
POST /v1/payouts
Authorization: Bearer <machine-token>
Idempotency-Key: <stable-key>
Content-Type: application/json
```

Minimal request:

```json
{
  "amount_cents": 10000,
  "destination": {
    "type": "pix",
    "key_type": "cpf",
    "key": "opaque-to-public-doc-example"
  },
  "external_ref": "optional-merchant-reference"
}
```

Production storage MUST NOT persist raw destination authority in ordinary plaintext financial rows when the existing encrypted destination model can be used. Public examples use synthetic values only.

### State machine

```text
requested
  -> processing
  -> completed
  -> failed
  -> rejected
  -> cancelled

processing
  -> execution_unknown
  -> completed
  -> failed

execution_unknown
  -> processing        only under explicit reconciled/retry authority
  -> completed
  -> failed
```

Illegal backward transitions are rejected. `completed`, `failed`, `rejected`, and `cancelled` are terminal for the Day-1 payout command lifecycle, except linked accounting adjustments/reconciliation records may be created without mutating historical ledger entries.

### Reservation

Payout creation MUST atomically:

1. validate positive integer `amount_cents`;
2. validate idempotency/fingerprint;
3. prove sufficient merchant available balance;
4. create/replay exactly one payout resource;
5. reserve gross amount from available into payout-blocked through the canonical ledger transaction;
6. commit before provider execution is attempted.

Insufficient balance fails before external provider I/O.

### Ambiguity

A timeout/connection loss after provider request transmission is not failure evidence. The payout becomes/remains `execution_unknown`, retains its reservation, and is reconciled using stable provider/client identity before any new externally effective request is allowed.

### Resolution

- success finalizes blocked funds into payout-out/settled accounting exactly once;
- definitive failure releases blocked funds to available exactly once;
- duplicate provider evidence has no duplicate financial effect;
- stale evidence cannot regress completed state.

## 8. Transaction contract

A30 preserves the existing authenticated Pix transaction create/get/list behavior and its payment idempotency semantics.

`POST /v1/transactions` MUST remain provider-independent. Provider IDs, credential material and provider status names are private unless transformed into an explicitly normalized SwiftPay field.

Production Pix creation remains default-deny until a provider has explicit runtime monetary authority backed by its executable create/recovery/webhook contract.

Sandbox remains the Day-1 fully executable integration environment.

## 9. Webhook contract

Merchant webhook endpoints are integration resources owned by the merchant and optionally scoped to organization.

Outgoing merchant events MUST use a deterministic delivery identity and signed payload. Retries cannot create a second semantic event.

Provider inbound callbacks are a separate trust boundary. Before provider data can cause a payment/payout transition or ledger posting, the exact deployed provider authenticity contract MUST be verified. Parsing a plausible JSON payload or receiving HTTP from the provider route is not authentication.

Duplicate and out-of-order provider evidence MUST be safe.

## 10. Integration contract

Day-1 integrations are deliberately finite:

- API credentials;
- merchant webhook endpoints;
- provider configuration/status visible only through authorized admin/merchant-safe projections.

No arbitrary script execution, generic plugin code, generic event bus or workflow runtime is added in A30.

## 11. Public OpenAPI contract

Canonical source: `openapi/swiftpay-v1.yaml`.

The file MUST be valid OpenAPI 3.1+ and public-safe. It MUST describe:

- token authentication;
- bearer machine authentication;
- `Idempotency-Key` semantics;
- integer-centavo money;
- transactions;
- balance/accounts/statement;
- payouts;
- customers;
- pagination;
- canonical errors;
- Sandbox/Production behavior;
- merchant webhook event/signature model.

The docs MUST NOT contain real credentials, provider secrets, service keys, real CPF/customer data or privileged database details.

A rendered docs UI is a projection of this file, not an independently maintained contract.

## 12. Dashboard contract

Merchant dashboard navigation required for A30:

```text
Overview
Transactions
Customers
Balance / Accounts
Transfers / Withdrawals
Integrations
  - API keys
  - Webhooks
Organizations
Settings
```

Every screen gets merchant/organization context from server-authoritative dashboard context. A user who is not an active member of the merchant receives `403`.

No browser operation gets direct provider credentials, Supabase secret/service credentials, or arbitrary financial database mutation authority.

## 13. Admin contract

Platform admin navigation required for A30:

```text
Overview
Merchants
Organizations
Transactions
Payouts
Providers / Integrations
Webhook deliveries
Audit
```

Platform-admin authorization MUST be server authoritative and MUST NOT rely on user-editable Supabase `user_metadata`.

Admin can inspect and execute explicitly modeled operational commands. Admin MUST NOT directly set balances or edit posted ledger history.

## 14. HTTP errors

Canonical error body:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "Human readable message.",
    "requestId": "server-generated-correlation-id"
  }
}
```

Required mappings include:

- `400 validation_error`
- `401 invalid_token` / existing compatible auth code
- `403 operation_forbidden`
- `404 resource_not_found`
- `409 idempotency_conflict`
- `409 insufficient_balance` where existing domain mapping uses conflict semantics, otherwise the frozen implementation test may approve `422`; choose exactly one before GREEN
- `503 provider_unavailable` only when non-execution is authoritative
- ambiguous external monetary execution is represented by resource state, not fabricated as a definitive provider failure.

## 15. Verification gates

A30 is not GREEN until tests prove at least:

1. OpenAPI contains every frozen public route and idempotency/money semantics.
2. Multiple organizations under one merchant are allowed.
3. Cross-merchant organization references fail.
4. Customer ownership and organization ownership fail closed.
5. Existing Pix transaction contracts remain green.
6. Payout create replay reserves only once.
7. Same payout idempotency key + different fingerprint conflicts.
8. Concurrent payout attempts cannot overspend available balance.
9. Provider timeout preserves `execution_unknown` and blocked funds.
10. Duplicate payout completion/failure evidence posts/releases once.
11. Account statement has no mutation route.
12. Dashboard membership isolation remains green.
13. Public/admin responses leak no provider/Supabase secrets.
14. Production monetary path remains default-deny without activated provider authority.

## 16. Production boundary

A30 can deliver a complete Sandbox gateway product in one small runtime topology.

A30 alone does not make SwiftPay a direct Pix/SPI/DICT participant. Real Production Pix requires an upstream provider/participant integration or separate institutional participation whose operational/regulatory contracts are outside this software slice.
