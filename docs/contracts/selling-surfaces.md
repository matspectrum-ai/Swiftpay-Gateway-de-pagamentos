# SwiftPay V2 — Selling Surfaces

Status: Phase 1 product/domain contract

SwiftPay has one Payment Core and four creation channels:

```text
Hosted Checkout ─┐
Payment Link ─────┼─> Payment -> ProviderAttempt -> Pix
Quick Pix ────────┤
REST API ─────────┘
```

No channel owns a separate provider router, ledger, fee engine, payment state machine or webhook system.

Every Payment records `source = api | checkout | payment_link | quick_pix` and, when applicable, `source_resource_id`. Pricing, KYC, environment, idempotency and provider rules are identical across channels.

## Hosted Checkout

A branded, low-friction Pix page. Initial configuration is deliberately small: title/description, amount policy, requested buyer fields, merchant branding, success URL and active state. V1 does not require a general catalog, stock, shipping or arbitrary page-builder engine.

Buyer path: open -> required identity fields -> generate Pix -> QR/copy -> wait -> paid. Buyer account creation is not required.

## Payment Link

A reusable shareable selling configuration, not a financial transaction. Opening a link creates no ledger effect. A buyer payment created from it is a normal canonical Payment with `source=payment_link`.

## Quick Pix

The seller's fastest no-code path: amount, optional description/customer, then generate Pix. It creates a one-off canonical Payment and requires no product/template/link setup.

## Conversion events

Selling surfaces emit analytics events such as `surface_viewed`, `checkout_started`, `pix_created`, `pix_copied`, `payment_paid` and `payment_expired`. Analytics never mutates financial truth; only authoritative Payment/provider evidence can mark money paid.

UTM/referrer fields are captured and snapshotted for attribution so later link/config changes do not rewrite historical conversion reporting.

## Idempotency and refresh

Double click, browser retry or refresh must not accidentally create another provider charge. Browser interactions use the same canonical request-idempotency mechanism as the REST API. An in-progress interaction recovers/re-displays the existing Payment when appropriate.

## Realtime

SSE/WebSocket/Realtime may update presentation, but transport loss never changes financial state or creates another Payment.

## Fail-first behavior

1. all channels create the same canonical Payment model;
2. no channel bypasses KYC/pricing/provider/idempotency rules;
3. double submit creates one Payment/ProviderAttempt;
4. refreshing an in-progress Pix does not blindly create another charge;
5. opening a Payment Link alone creates no financial posting;
6. Quick Pix requires no product/template;
7. analytics cannot mark a Payment paid;
8. UTM snapshots are historical and immutable for an existing Payment;
9. Sandbox selling activity never enters Production revenue/conversion/ranking;
10. public buyer routes expose no merchant/provider secrets.
