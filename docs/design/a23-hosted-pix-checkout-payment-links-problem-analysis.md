# A23 — Hosted Pix Checkout + Payment Links Sandbox MVP — Problem Analysis

Status: **PROBLEM ANALYSIS FROZEN**  
Date: 2026-08-19

## Problem

SwiftPay now has a merchant dashboard (A21/A22) and a deterministic sandbox Pix payment path (A2), but a merchant still cannot create a shareable payment link and a payer cannot open a hosted SwiftPay checkout to generate that Pix.

The domain was deliberately prepared for this: canonical `Payment.source` already accepts `api | checkout | payment_link | quick_pix` and `source_resource_id` exists for a checkout/link resource. A2, however, correctly freezes machine-API creation as `source='api'`, uses machine credentials as authority and explicitly lists checkout/payment-link surfaces as non-objectives.

A23 must therefore add a separate payment-link/hosted-checkout vertical rather than calling A2 while pretending that a public payer is a machine API client.

## Existing truths that constrain the slice

1. `Payment` is the canonical collection resource; checkout must not invent a second payment state machine.
2. `Payment.source='payment_link'` and `source_resource_id=<payment_link_id>` must identify the origin.
3. A2 owns the deterministic sandbox emulator, pricing snapshot vocabulary, claim/fencing/resolution semantics and conservative `execution_unknown` behavior.
4. A2 machine route creation remains machine-authenticated and `source='api'`; A23 must not alter that external contract.
5. A3 paid transition/ledger behavior remains the only authority for a paid transition; A23 does not synthesize payment success.
6. A10/A11 authorize zero retained-provider traffic; Production checkout must not become an alternate provider bypass.
7. K1/K4/A20 private-schema and runtime-capability boundaries remain mandatory. Public checkout browsers never receive direct database authority.
8. A14 proves distributed abuse admission and trusted-proxy client-IP resolution. Public checkout must not be introduced as an unbounded anonymous mutation surface.
9. A12 logging must never emit customer/private Pix payloads or public request bodies.

## Product decision

A23 is a **Sandbox-only hosted Pix payment-link MVP**.

It intentionally produces visibly non-payable deterministic emulator Pix data. It is useful for merchant integration/product flow testing without claiming live-money readiness.

Production payment-link creation and Production checkout payment execution remain fail-closed until the retained-PSP current-contract, authenticated-sandbox and A10 activation gates close.

## Merchant workflow

From the authenticated dashboard, an authorized merchant can:

1. open `Links de pagamento`;
2. create a fixed-amount Sandbox Pix payment link;
3. list existing links;
4. copy its public hosted-checkout URL;
5. disable a link permanently for V0.

V0 deliberately omits edit/re-enable. A merchant creates a replacement link instead. This removes revision/edit semantics from the first public checkout slice and makes disable terminal.

## Public payer workflow

A payer can:

1. open an unguessable public link URL;
2. see merchant display name, fixed amount, description and explicit Sandbox/non-payable warning;
3. click `Gerar Pix de teste`;
4. receive the deterministic sandbox Payment projection;
5. copy the emulator Pix copy-and-paste payload;
6. refresh/reopen the resulting payment only within the current page state; no payer account is created.

The public route does not expose merchant UUID, provider identity, ProviderAttempt identity, fee internals, customer snapshots or database identifiers for the link.

## Payment-link identity

A payment link has two identities:

- internal UUID primary key;
- public locator token generated with CSPRNG in trusted API memory.

Public token format:

`plink_sandbox_<base64url(24 random bytes, no padding)>`

The token is intentionally a public shareable locator rather than a secret credential. It may be persisted because merchants must be able to retrieve/copy the URL later. It grants only access to the frozen public checkout actions for that fixed link; it does not grant dashboard, machine API or arbitrary merchant authority.

## V0 link configuration

Required:

- fixed `amount` in BRL centavos;
- currency `BRL`;
- optional description;
- Pix expiration minutes, default 60, allowed 5–1440.

No variable amount, arbitrary metadata, callback URL, customer prefill, branding/theme, quantity, inventory, coupon, redirect URL, subscription or card/boleto fields are in A23.

## Public mutation/idempotency

The public payer browser generates one `crypto.randomUUID()` when the payer intentionally starts a Pix generation attempt. That logical key is sent as `Idempotency-Key` and retained for any same-attempt transport retry.

Database idempotency scope must include the payment-link resource, so two distinct public links using the same client-supplied UUID cannot collide with each other or with machine API `create_payment` idempotency.

A completed replay returns the original payment projection and does not create a second Payment or ProviderAttempt.

## Reusing A2 safely

A23 may reuse:

- request/Pix shape concepts;
- sandbox pricing `sandbox-zero-fee-v0`;
- routing policy `sandbox-emulator-v0`;
- deterministic emulator implementation;
- existing `claim_api_pix_attempt` and `resolve_api_pix_attempt` behavior after A23 has created a canonical `payment_link` Payment/ProviderAttempt;
- public Payment projection vocabulary.

A23 must **not** call `prepare_api_pix_payment` for public checkout because that routine:

- records `source='api'`;
- owns machine API idempotency scope;
- is intentionally an A2 machine contract.

A23 needs a distinct trusted prepare routine whose created Payment is `source='payment_link'` and whose `source_resource_id` is the payment-link UUID.

## Public abuse boundary

Hosted checkout is anonymous by design but cannot bypass A14.

A23 introduces a dedicated network policy `checkout_request_pre_auth` for public checkout GET/POST requests. It uses the same A14 trusted-proxy/IP canonicalization, HMAC subject rotation and distributed PostgreSQL quota store. The policy is fail-closed if admission is unavailable.

Initial V0 ceiling: 120 requests / 60-second fixed window / canonical client IP. This is a conservative safety ceiling, not a business SLA; production-like traffic measurement is required before tuning.

No raw client IP or HMAC key is persisted.

## Database boundary

New private table:

`app.payment_links`

Minimum fields:

- id uuid PK;
- merchant_id uuid;
- environment (`sandbox` only for A23 creation);
- public_token unique;
- status `active | disabled`;
- amount_cents;
- currency `BRL`;
- description nullable;
- pix_expiration_minutes;
- created_at;
- disabled_at nullable.

Direct table authority remains forbidden for `swiftpay_api`, `swiftpay_worker`, Data API roles and browser clients.

Trusted API routines required by A23:

1. `app.list_dashboard_payment_links(uuid,uuid,text)`
2. `app.create_dashboard_payment_link(uuid,uuid,text,text,text,jsonb)`
3. `app.disable_dashboard_payment_link(uuid,uuid,text,uuid,text,text,jsonb)`
4. `app.get_public_payment_link(text)`
5. `app.prepare_payment_link_pix_payment(text,text,text)`

The create/disable dashboard routines re-check current K4 membership internally. Public get/prepare authenticate only through possession of an active public locator token plus merchant/link state; they confer no unrelated authority.

Expected runtime capability after A23 if this exact routine set survives TDD: API 30, worker 6.

## Dashboard authorization

Payment-link reads require current member role.

Sandbox create/disable require current admin or owner role through A6/K4. Production creation is fail-closed and returns `operation_forbidden` even for an owner.

No A8 AAL2 requirement is added because A23 exposes no reusable credential secret or provider credential. Server role checks remain authoritative; browser role checks are presentation only.

## Hosted web application

A23 adds a separate `apps/checkout` TypeScript React/Vite browser SPA.

Reasons not to merge it into `apps/dashboard`:

- checkout is intentionally anonymous;
- dashboard is Supabase-session authenticated;
- separate app prevents accidental authentication/session coupling;
- deployment/caching/security headers can evolve independently.

`apps/checkout` may talk only to same-origin `/api/checkout/v1/**`. It has no Supabase client and no database/provider secret configuration.

## Public HTTP contract boundary

Dashboard:

- `GET /dashboard/v1/merchants/{merchantId}/environments/{environment}/payment-links`
- `POST /dashboard/v1/merchants/{merchantId}/environments/{environment}/payment-links`
- `POST /dashboard/v1/merchants/{merchantId}/environments/{environment}/payment-links/{paymentLinkId}/disable`

Public checkout:

- `GET /checkout/v1/payment-links/{publicToken}`
- `POST /checkout/v1/payment-links/{publicToken}/payments`

Unknown and disabled public tokens are indistinguishable: HTTP 404.

All public checkout responses are `Cache-Control: no-store` because active/disabled state and generated payment state must not be served stale by an intermediary.

## Financial/provider invariance

A23 may create Sandbox Payment and ProviderAttempt rows only through its explicit public payer action. It must not:

- create Production Payments;
- call AkkadPag/AkadPay/FlevoPay;
- change A10 registry state;
- create ledger entries by itself;
- mark a Payment paid;
- create payout/refund/reservation state;
- grant browser/Data API financial authority.

A23's deterministic checkout Payment remains subject to the same later A3 trusted paid-evidence path if a test fixture deliberately applies that evidence.

## Failure semantics

- invalid dashboard session: existing A6 mapping;
- dashboard role failure: 403;
- Production link create: 403 `operation_forbidden`;
- malformed link-create request: 400 `validation_error`;
- idempotency conflict/in-progress: 409;
- unknown/disabled public token: 404 `checkout_not_found`;
- checkout admission rate-limited: 429 + `Retry-After`;
- checkout admission unavailable: sanitized 503;
- public Pix creation validation error: 400;
- emulator `execution_unknown`: HTTP 202 with canonical `creating` Payment, never fabricated failure;
- internal database/runtime error: sanitized 500.

## Explicit exclusions

A23 does not implement:

- Production checkout;
- live PSP execution;
- provider webhooks/recovery;
- payer authentication/accounts;
- saved customers;
- branding/theme/logo uploads;
- real QR image rendering (the sandbox emulator is deliberately non-payable; copy-and-paste/reference data is sufficient for this MVP);
- variable amount;
- payment-link edit/re-enable/delete;
- expiry of the link itself;
- redirect-after-payment;
- checkout analytics;
- custom domains;
- card/boleto;
- subscriptions.

## Acceptance direction

The fail-first suite must prove:

- A23 artifacts are frozen;
- payment-link schema/routines do not yet exist at RED;
- runtime manifest remains 25/6 before implementation;
- dashboard has no Payment Links navigation/client yet;
- `apps/checkout` does not yet exist;
- public checkout routes do not yet exist;
- A2 source remains strictly `api` and its contract is unchanged;
- browser/Data API/provider authority remains absent.

Implementation is authorized only after those RED failures are isolated from the already-GREEN A1-A22 baseline.
