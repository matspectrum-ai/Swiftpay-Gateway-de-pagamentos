# SwiftPay V2 — A23 Hosted Pix Checkout + Payment Links V0 Contract

Status: **FROZEN FOR TDD**  
Date: 2026-08-19

This contract is subordinate to the canonical Payment lifecycle and A2 sandbox emulator contracts. It adds a new `payment_link` origin without changing the machine `source='api'` surface.

## Dashboard routes

Base:

`/dashboard/v1/merchants/{merchantId}/environments/{environment}/payment-links`

### GET list

Requires ordinary A6 dashboard session and current `member` or stronger role.

Success `200`:

```json
{
  "object": "list",
  "data": [
    {
      "id": "uuid",
      "publicToken": "plink_sandbox_...",
      "checkoutPath": "/pay/plink_sandbox_...",
      "status": "active",
      "amount": 1000,
      "currency": "BRL",
      "description": "Pedido",
      "pixExpirationMinutes": 60,
      "createdAt": "RFC3339",
      "disabledAt": null
    }
  ]
}
```

`merchantId` is intentionally not duplicated in item projections.

### POST create

Requires A6 dashboard session, current `admin|owner`, and `Idempotency-Key`.

Sandbox request:

```json
{
  "amount": 1000,
  "currency": "BRL",
  "description": "Pedido",
  "pixExpirationMinutes": 60
}
```

Unknown fields are rejected. `description` and `pixExpirationMinutes` may be omitted. Expiration defaults to 60 minutes.

First success: `201` with the dashboard payment-link projection. Completed replay: `200` with the same public token/projection and no second row.

Production: `403 operation_forbidden` with zero mutation/token generation authority.

### POST disable

Path:

`/{paymentLinkId}/disable`

Requires A6 dashboard session, current `admin|owner`, and `Idempotency-Key`. Body is exactly `{}`.

Success/replay: `200`. Disable is terminal in A23 V0. Missing/foreign resource is `404 resource_not_found`.

## Public checkout routes

Public checkout requires no Supabase session and no machine Bearer token.

All responses use `Cache-Control: no-store`.

### GET public link

`GET /checkout/v1/payment-links/{publicToken}`

Success `200`:

```json
{
  "merchantName": "Merchant",
  "amount": 1000,
  "currency": "BRL",
  "description": "Pedido",
  "environment": "sandbox",
  "pixExpirationMinutes": 60
}
```

Unknown, malformed, disabled link, inactive merchant and any non-Sandbox link are indistinguishable to the payer: `404 checkout_not_found`.

The response never exposes merchant UUID, internal link UUID, provider identity, provider account, fee internals or private customer data.

### POST generate Pix

`POST /checkout/v1/payment-links/{publicToken}/payments`

Required header: `Idempotency-Key`. Request body is exactly `{}`.

First deterministic emulator success: `201` with the canonical A2-style PublicPayment projection. Emulator `execution_unknown`: `202` with canonical `creating` state. Completed replay returns the original status/projection without creating another Payment/ProviderAttempt.

Unknown/disabled link: `404 checkout_not_found`.

## Public admission

Both public checkout routes pass through A14 trusted client-origin resolution and distributed quota admission under the new exact policy:

`checkout_request_pre_auth`

V0 limit: 120 requests per 60-second fixed window per canonical client IP.

Admission store unavailable => fail closed `503 request_admission_unavailable`. Limit exceeded => `429 rate_limit_exceeded` plus `Retry-After`.

A18 active/previous HMAC subject continuity applies unchanged. Raw IPs/HMAC keys are not stored.

## Payment-link public token

Trusted API generation only:

```ts
function generatePaymentLinkPublicToken(
  randomBytes?: (size: number) => Buffer,
): string;
```

Production default uses `node:crypto.randomBytes(24)`.

Exact representation:

`plink_sandbox_<24 random bytes base64url without padding>`

The token is public/shareable and persistable. It is not a dashboard or machine credential.

## Database store contract

```ts
interface DashboardPaymentLink {
  id: string;
  publicToken: string;
  checkoutPath: string;
  status: 'active' | 'disabled';
  amount: number;
  currency: 'BRL';
  description: string | null;
  pixExpirationMinutes: number;
  createdAt: string;
  disabledAt: string | null;
}

interface PublicPaymentLink {
  merchantName: string;
  amount: number;
  currency: 'BRL';
  description: string | null;
  environment: 'sandbox';
  pixExpirationMinutes: number;
}
```

Trusted DB functions:

```text
app.list_dashboard_payment_links(uuid,uuid,text)
app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)
app.disable_dashboard_payment_link(uuid,uuid,text,uuid,text,text,jsonb)
app.get_public_payment_link(text)
app.prepare_payment_link_pix_payment(text,text,text)
```

All are `SECURITY DEFINER`, fixed `search_path=''`, executable only by `swiftpay_api`. `PUBLIC`, `anon`, `authenticated`, `service_role`, and `swiftpay_worker` execute are revoked.

No A23 runtime role gets direct `app.payment_links`, `app.payments`, `app.provider_attempts`, `app.request_idempotency` or `app.audit_events` table authority.

## Public prepare result

`app.prepare_payment_link_pix_payment(text publicToken, text idempotencyKey, text requestHash)` is a trusted internal API-runtime contract. It may return the resolved merchant UUID internally because claim/resolve require merchant scope, but the HTTP/public service MUST strip that internal field.

Prepared form:

```ts
{
  kind: 'prepared';
  merchantId: string;
  payment: PublicPayment;
  providerAttempt: { id: string; amountCents: number; expiresAt: string };
}
```

Replay forms parallel A2 (`completed`, `executing`, `execution_unknown`, `conflict`) but stay in A23's payment-link idempotency namespace.

## Payment creation invariants

A23 prepare MUST create:

```text
Payment.environment = sandbox
Payment.source = payment_link
Payment.source_resource_id = payment_link.id
Payment.amount_cents = frozen link amount
Payment.currency = BRL
Payment.description = frozen link description
pricing_version = sandbox-zero-fee-v0
merchant_fee_cents = 0
merchant_net_cents = amount
routing_policy_version = sandbox-emulator-v0
```

It MUST NOT call `app.prepare_api_pix_payment` and MUST NOT mutate A2's `create_payment` idempotency namespace.

After A23 prepare, the application may reuse the already-proven A2 `claim_api_pix_attempt` / `resolve_api_pix_attempt` and deterministic emulator because those operate on the canonical Payment/ProviderAttempt identity rather than machine credential identity.

## Dashboard service interfaces

```ts
interface DashboardPaymentLinksService {
  list(input: { authorization?: string; merchantId: string; environment: string }): Promise<Record<string, unknown>>;
  create(input: { authorization?: string; merchantId: string; environment: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
  disable(input: { authorization?: string; merchantId: string; environment: string; paymentLinkId: string; idempotencyKey?: string; request: unknown }): Promise<Record<string, unknown>>;
}
```

The service reuses A6 online session verification and K4 current membership authority. Browser role state is not authorization authority.

## Checkout service interface

```ts
interface HostedCheckoutService {
  getLink(publicToken: string): Promise<
    | { kind: 'ok'; link: PublicPaymentLink }
    | { kind: 'not_found' }
    | { kind: 'internal_error' }
  >;

  createPayment(input: {
    publicToken: string;
    idempotencyKey: unknown;
    request: unknown;
  }): Promise<
    | { kind: 'ok'; httpStatus: 201 | 202; payment: PublicPayment; replayed: boolean }
    | { kind: 'not_found' }
    | { kind: 'validation_error' }
    | { kind: 'idempotency_conflict' }
    | { kind: 'internal_error' }
  >;
}
```

No user/machine authentication fallback exists on these public routes.

## Checkout SPA

A23 creates `apps/checkout` as a separate React 19.2.8 / ReactDOM 19.2.8 / Vite 8.2.1 browser SPA.

Allowed browser authority:

- same-origin `GET /api/checkout/v1/payment-links/:publicToken`;
- same-origin `POST /api/checkout/v1/payment-links/:publicToken/payments`.

Forbidden:

- Supabase client;
- `.from()` / `.rpc()`;
- service role/database/runtime credentials;
- provider credentials;
- machine API credentials.

Visible Sandbox warning must clearly state that generated Pix data is for test use and is not payable.

## Dashboard SPA extension

A23 adds `Links de pagamento` navigation at `/payment-links`.

The dashboard may list/copy/create/disable links. Production create control is disabled with an explicit unavailability explanation; backend remains fail-closed if a caller bypasses UI presentation.

## Runtime capability manifest

Before A23: 25 API / 6 worker.

After A23: exactly 30 API / 6 worker, adding only the five frozen signatures above.

## Provider and financial safety

A23 authorizes zero retained-provider traffic and zero A10 transition. It creates only Sandbox payment-link, Payment, ProviderAttempt and idempotency/audit/quota state through explicit frozen operations.

A23 itself never posts ledger entries, marks payment paid, creates payout/refund/reservation state or permits a Production Payment.
