# SwiftPay V2 — Mobile-first, PWA and Native Notifications

Status: Approved product direction

## Decision

SwiftPay V2 is mobile-first.

The merchant dashboard must be designed for a phone viewport first and progressively enhance for tablet and desktop. Desktop must remain efficient for operational and developer-heavy workflows, but it is not the baseline interaction model.

The merchant dashboard must be installable as a Progressive Web App (PWA) where platform/browser support permits it.

Native Web Push notifications are a first-class SwiftPay product channel for high-signal operational events. External messaging integrations such as Telegram remain optional automation/integration targets and are not the primary mechanism for notifying a merchant about ordinary SwiftPay activity.

## Product requirements

### Mobile-first UX

- Primary merchant workflows must be usable without horizontal scrolling on supported phone viewports.
- Navigation must have a phone-appropriate information architecture rather than simply shrinking the desktop sidebar.
- High-frequency actions must be reachable with one-handed mobile use where practical.
- Touch targets, typography, forms, tables and financial status surfaces must be designed for touch first.
- Dense operational tables may progressively disclose detail or switch to card/list representations on narrow viewports.
- Checkout remains separately mobile-first for the buyer as already required by the product vision.

### Installable PWA

The merchant dashboard must provide, at minimum:

- a standards-compliant web app manifest;
- application name/short name, icons and theme/background metadata;
- standalone display behavior where supported;
- a service worker with a deliberately bounded cache policy;
- an installable experience on supported Android/Chromium platforms;
- iOS-compatible home-screen metadata/behavior where supported;
- safe update behavior so financial UI is not silently held on an obsolete application shell.

Offline behavior must not fabricate financial state. Cached UI may be shown, but balances, payments, payout state, KYC state and other authoritative financial information must clearly fail closed or be marked stale when fresh server evidence is unavailable.

### Native notifications

SwiftPay Web Push should become the default merchant notification surface for selected high-value events after explicit user permission.

Initial candidate notifications:

- payment approved / sale completed;
- payout completed;
- payout failed or requires attention;
- refund completed or failed;
- KYC action required / approved / rejected where appropriate;
- material provider or account incident requiring merchant action;
- recovery/automation events only when the merchant opts into them.

Notification payloads must minimize sensitive information. Lock-screen notifications must not expose unnecessary customer PII, API secrets, provider secrets or internal financial identifiers.

Notification preferences must be configurable per merchant/user and should support categories rather than an all-or-nothing noisy feed.

### In-app notification center

Push notifications complement, rather than replace, an in-product notification/inbox surface. High-value events should remain discoverable after a push is dismissed.

### Telegram and other external channels

Telegram is not a required default path for sale notifications.

Telegram, WhatsApp, email, Slack-like destinations and generic HTTP/webhook actions may remain optional SwiftFlows/integration actions for merchants who explicitly choose those channels.

For example:

```text
payment approved -> SwiftPay native push
```

is a normal product capability, while:

```text
payment approved -> notify Telegram channel
```

is an optional merchant automation.

This keeps the core product useful without requiring an external messaging account while preserving integration flexibility for teams.

## Architecture implications

Implementation must be specified separately before coding. Expected domains include:

- PWA manifest/service-worker lifecycle;
- push subscription registration and revocation;
- user/device/subscription ownership;
- permission/preferences model;
- durable notification event/outbox;
- worker delivery and bounded retry;
- Web Push/VAPID key authority and rotation;
- in-app notification persistence/read state;
- deduplication/idempotency;
- tenant isolation;
- observability and abuse controls.

The payment transaction must never depend on successful push delivery. Notification delivery is an asynchronous side effect of an already-committed canonical event.

## Product hierarchy

For ordinary merchant events, prefer channels in this order:

1. canonical SwiftPay event/state;
2. in-app notification center;
3. native Web Push when opted in and supported;
4. merchant-selected external automation channels.

External channels must never become the source of truth for payment state.
