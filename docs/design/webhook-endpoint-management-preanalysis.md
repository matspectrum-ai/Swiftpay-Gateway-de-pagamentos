# SwiftPay V2 — Merchant Webhook Endpoint Management — Pre-analysis

Date: 2026-08-16
Status: **PREREQUISITE ANALYSIS — implementation not authorized**

## Purpose

A4 proves durable merchant webhook delivery, but merchants still cannot create, inspect, change, disable or rotate endpoints through a first-class trusted application surface.

It would be tempting to add CRUD directly to the existing machine API. This note records why that is not yet a safe implementation step and identifies the prerequisite boundaries that should be closed first.

## Existing canonical state

`app.webhook_endpoints` already stores:

- merchant and environment ownership;
- endpoint URL;
- `active | disabled` lifecycle;
- current encrypted signing secret + version;
- one previous encrypted signing secret/version + overlap expiry;
- subscribed event set;
- created/updated timestamps.

A4 additionally freezes:

- `signing_secret_version` snapshot on each delivery;
- AES-256-GCM ciphertext bound to endpoint ID + secret version;
- `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY` as the delivery-runtime decryption key;
- worker-only composed claim/resolve boundaries;
- strict HTTPS/443 + DNS/IP/redirect/SSRF policy;
- current executable payload support limited to `payment-v1`;
- no endpoint-management HTTP API, signing-secret creation/rotation API or manual redelivery API.

The current domain actually emits `payment.paid`; endpoint management must not pretend that future foundational event names are already executable.

## Security properties management must preserve

A management surface changes security-sensitive configuration even though it does not directly post ledger entries.

An attacker who can change an endpoint URL can redirect merchant event data. An attacker who can rotate a signing secret can invalidate the merchant receiver's verification configuration. An attacker who can silently broaden subscriptions can increase data exposure.

Therefore endpoint management is not ordinary low-risk CRUD.

Required invariants:

- exact merchant + environment ownership;
- no browser/Data API direct table mutation;
- endpoint URL must conform to the A4 production destination policy before persistence;
- only currently supported canonical event types may be subscribed;
- plaintext signing secret is generated with a CSPRNG and returned only once on create/rotation;
- plaintext secret is never persisted, logged, audited or copied into job payloads;
- current/previous secret version overlap remains deterministic;
- endpoint changes are append-audited in the same transaction where causal audit is required;
- endpoint configuration cannot mutate Payment, ledger, balance, provider, payout or refund state;
- disabling an endpoint must preserve existing durable event/delivery history.

## Blocker 1 — administrative principal is not yet executable over HTTP

K3/K4 already provide the correct database authorization model for dashboard operations:

```text
server-verified Supabase Auth user
  -> app.require_dashboard_merchant_context(...)
  -> current app.merchant_members truth
  -> owner > admin > member hierarchy
```

However, the current Fastify HTTP runtime implements machine Bearer authentication for merchant integration requests; it does not yet verify a Supabase dashboard session and bind the verified `auth.users.id` to the K4 context helper.

### Why not simply use the existing machine Bearer token?

A machine credential is currently designed for merchant integration traffic and has no scope vocabulary. Granting every payment-integration credential the ability to redirect webhooks and rotate signing secrets would silently turn it into a broad administrative credential.

That is a material privilege expansion and would make later credential scoping harder.

### Preferred direction

Treat endpoint create/update/disable/secret rotation as a dashboard/admin operation and require a server-verified dashboard principal. Exact minimum membership role and whether secret rotation requires step-up must be frozen in the endpoint-management spec after dashboard authentication exists.

A later explicit machine-management scope may be added if product requirements justify it; it should not be inferred now.

## Blocker 2 — A4 signing-secret key custody is worker-oriented

The merchant-webhook contract requires SwiftPay to generate the plaintext endpoint signing secret and disclose it once on create/rotation.

A4's accepted implementation intentionally decrypts signing secrets inside the trusted worker delivery runtime. Naively giving the API process the same symmetric AES key only so it can create ciphertext increases key exposure and weakens the accepted blast-radius boundary.

### Unsafe shortcut rejected

Do not silently add `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY` to the general API runtime and call the existing decrypt/encrypt primitive there without an explicit superseding security decision.

### Viable design families for a later frozen decision

1. **Dedicated encrypt-only key-management capability** backed by an external KMS/HSM/service, where the API can wrap a secret but cannot decrypt stored ciphertext.
2. **Asymmetric wrapping format**, where management receives only a public encryption key and the worker holds the private decryption key. This would require a versioned new ciphertext contract and rotation plan.
3. **Dedicated trusted key-management workload/command**, provided one-time plaintext response and crash/retry semantics can be defined without persisting plaintext.
4. **Platform secret-vault redesign**, only if a separate ADR proves it is simpler and at least as safe as the current A4 format.

A shared symmetric key across API and worker is possible only through an explicit contract/ADR that accepts the larger blast radius; it is not the default.

## Blocker 3 — endpoint subscriptions must match executable events

The foundational merchant-webhook contract lists a future vocabulary including payment/refund/payout events. A4 runtime supports `payment-v1`, and the currently proven domain transition emits `payment.paid`.

A management API must therefore reject unsupported subscription values rather than store configuration that can never produce/deliver a valid event.

Initial executable subscription vocabulary should be derived from currently proven event producers, not from aspirational contract examples.

## Database boundary implications

`swiftpay_api` currently has zero direct privileges on `app.webhook_endpoints`; this must remain true.

Endpoint management will need narrow SECURITY DEFINER routines with explicit grants, for example conceptually:

- create endpoint using already-encrypted secret material;
- list/get merchant-scoped endpoint projections;
- update URL/subscriptions/lifecycle;
- rotate encrypted secret/version atomically.

Exact signatures are not frozen here.

The routines should record module-specific append-only audit events transactionally rather than granting `swiftpay_api` generic direct `record_audit_event` authority.

Worker delivery claim/resolve authority must remain unchanged.

## Manual test/replay is a separate concern

A4's foundational contract allows manual redelivery eventually, but replay creates new durable delivery/scheduler semantics and can produce intentional duplicate remote HTTP effects.

Endpoint CRUD/rotation should not automatically absorb manual event replay unless a later specification freezes:

- who may request replay;
- which historical events/deliveries are eligible;
- stable/new delivery identity semantics;
- audit requirements;
- rate/abuse controls;
- interaction with disabled endpoints and secret-version history.

## Recommended sequencing

The next internal implementation slice should be the missing trusted **dashboard-session authentication/runtime boundary**, because it is a prerequisite shared by:

- webhook endpoint management;
- API credential create/rotate/revoke;
- KYC/compliance operations;
- merchant/member administration;
- other sensitive dashboard actions.

After that boundary is GREEN, return to endpoint management with a dedicated key-custody decision before RED tests.

Recommended sequence:

```text
K3/K4 database dashboard authorization      DONE
  -> dashboard HTTP session authentication  NEXT
  -> webhook key-management decision        REQUIRED
  -> webhook endpoint management spec/TDD
  -> management implementation
```

## Decision

**Do not implement webhook endpoint management yet.**

The missing dashboard HTTP principal and signing-secret encryption authority are real architectural prerequisites. Closing them explicitly is safer and simpler than widening the machine Bearer or worker encryption-key boundaries opportunistically.
