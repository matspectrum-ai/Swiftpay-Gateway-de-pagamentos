# A22 — Merchant Dashboard Integration Settings UI — Problem Analysis

Date: 2026-08-19  
Status: `PROBLEM_ANALYSIS`

## Problem

A21 delivers the first real merchant-facing web application, but its sidebar still exposes **Credenciais API** and **Webhooks** only as disabled placeholders. This leaves two already-proven and hosted capabilities—A8 API credential management and A7 merchant webhook endpoint management—available only through their HTTP APIs rather than through the product UI.

The gap is therefore not a new backend capability. The gap is a browser UX that composes existing trusted dashboard APIs without duplicating authorization, persisting plaintext secrets, weakening A8 AAL2 requirements, bypassing A7 endpoint policy, or creating any new provider/financial authority.

## Binding predecessors

A22 reuses, without redefining:

- A6 dashboard session authentication and online Supabase identity validation;
- K4 current merchant/environment/role authorization;
- A7 merchant webhook endpoint management;
- A8 API credential management and privileged AAL2 mutation boundary;
- A17 RSA-only persisted merchant webhook signing-secret authority;
- A21 browser-only React/Vite dashboard, context discovery and session-refresh behavior.

Canonical predecessors:

- `docs/specs/dashboard-session-authentication-v0.yaml`
- `docs/specs/merchant-webhook-endpoint-management-v0.yaml`
- `docs/specs/api-credential-management-v0.yaml`
- `docs/specs/legacy-webhook-aes-secret-retirement-v0.yaml`
- `docs/specs/merchant-dashboard-web-foundation-v0.yaml`

## Current executable backend

### API credentials — A8

Base route:

`/dashboard/v1/merchants/{merchantId}/environments/{environment}/api-credentials`

Existing operations:

- member read: list/get;
- privileged mutation: create, rotate secret, revoke;
- Sandbox mutations: admin/owner;
- Production mutations: owner;
- every mutation requires an online-validated AAL2 dashboard session;
- every mutation requires `Idempotency-Key`;
- create/rotate may reveal `secretKey` exactly once on the winning response;
- completed idempotency replay never rediscloses plaintext secret;
- maximum ten active credentials per merchant/environment.

### Merchant webhooks — A7/A17

Base route:

`/dashboard/v1/merchants/{merchantId}/environments/{environment}/webhook-endpoints`

Existing operations:

- member read: list/get;
- admin/owner mutation: create, update, disable, enable, rotate secret;
- every mutation requires `Idempotency-Key`;
- exact V0 subscription is `payment.paid`;
- create/rotate may reveal `signingSecret` exactly once on the winning response;
- completed replay never rediscloses plaintext secret;
- endpoint URLs remain subject to the existing trusted A4/A7 HTTPS/DNS/IP/SSRF policy;
- URL change is allowed only while the endpoint is disabled;
- A17 remains authoritative for RSA-only persisted secret versions.

## Threat model and authority boundary

The browser is an untrusted presentation client. A22 MUST NOT treat client-side role checks, route state, disabled buttons, decoded JWT claims, local storage, or hidden controls as authorization.

Server-side A6/K4/A7/A8 checks remain authoritative for every request.

The browser may hold only:

- the existing Supabase user session managed by A21;
- public credential projections;
- public webhook endpoint projections;
- one-time plaintext credential/webhook secrets in ephemeral component memory while the reveal UI is open;
- non-secret idempotency keys for in-flight mutation attempts.

The browser MUST NOT persist plaintext `secretKey` or `signingSecret` to `localStorage`, `sessionStorage`, IndexedDB, URL/query/hash, clipboard automatically, telemetry, logs or error objects.

A manual copy action is allowed only after explicit user interaction. The secret reveal state MUST be cleared on context change, navigation away from the relevant settings view, logout/session loss, or explicit dismissal.

## Idempotent browser retry boundary

A7/A8 require durable idempotency. A22 must therefore generate one opaque idempotency key **per user mutation action** and reuse that exact key if A21's one-session-refresh retry repeats the same HTTP mutation.

A distinct user action receives a distinct key. A key is never reused across operations/resources.

`crypto.randomUUID()` is sufficient for this non-secret request identity. The key need not survive a full page reload; losing the first successful one-time-secret response after a page reload remains governed by the predecessor contracts (explicit rotate with a new key rather than replay-based redisclosure).

## AAL2 / step-up boundary

A8 deliberately did not implement MFA enrollment/challenge UX. A22 does not expand that scope.

When A8 returns `step_up_required`, A22 must:

- show a dedicated, non-secret **autenticação adicional necessária** state;
- perform no speculative retry loop;
- not locally decode/trust the JWT `aal` claim as mutation authority;
- not downgrade to AAL1 or machine credentials;
- keep read-only credential visibility available when the ordinary A6 session is still valid.

MFA enrollment/challenge/recovery UX remains a separate future authentication-product slice.

## UX scope

A22 adds two functional settings views inside the existing A21 shell.

### Credenciais API

- list credentials for selected merchant/environment;
- status, name, public key, revision, last use and timestamps;
- explicit manual public-key copy;
- create form: name + optional exact-IP allowlist;
- rotate-secret action with current `expectedRevision`;
- revoke action with current `expectedRevision` and explicit confirmation;
- one-time Secret Key reveal on winning create/rotate only;
- clear read-only/insufficient-role state;
- dedicated step-up-required state;
- empty/loading/error/conflict/limit states.

### Webhooks

- list endpoints for selected merchant/environment;
- status, URL, subscription, revision and timestamps;
- create form with HTTPS URL and exact `payment.paid` subscription;
- disable/enable with current `expectedRevision`;
- edit URL only for disabled endpoints;
- rotate signing secret with current `expectedRevision`;
- one-time signing-secret reveal on winning create/rotate only;
- empty/loading/error/conflict/limit states.

A22 does not add manual test webhook/redelivery/history.

## Client-side role UX

The A21 context projection already exposes `membershipRole`. A22 may use it only to avoid presenting obviously unavailable mutation controls:

- API credential Sandbox: admin/owner;
- API credential Production: owner;
- webhook mutations: admin/owner.

This is presentation logic only. The server remains authoritative and a 403 must still be handled safely.

## Routing/navigation

A22 activates the existing sidebar placeholders and uses browser-history paths:

- `/transactions`
- `/settings/api-credentials`
- `/settings/webhooks`

No secret or resource projection is encoded in the URL.

## Error taxonomy

The A21 browser error adapter is currently too coarse for settings mutations. A22 may extend its **local sanitized taxonomy** to distinguish:

- validation (HTTP 400);
- session (401);
- step-up (403 with exact public `step_up_required` code);
- forbidden (other 403);
- not found (404);
- conflict (409);
- unavailable (503/network);
- generic error.

The browser must never display raw backend/database/stack error details.

## Explicit non-objectives

A22 does not implement:

- new database routines, tables, grants or migrations;
- new Fastify routes or server-side management semantics;
- MFA enrollment, challenge, factor management or account recovery;
- service-role/browser database access;
- provider account credentials or retained PSP activation;
- provider webhook ingress;
- manual webhook redelivery/test events/history;
- financial mutation, Pix creation, refunds, payouts, ledger actions or balance mutation;
- hosted checkout, Payment Links or analytics.

## Expected capability delta

None.

A22 must leave the canonical runtime capability manifest exactly:

- `swiftpay_api`: 25 `app` EXECUTE signatures;
- `swiftpay_worker`: 6 `app` EXECUTE signatures.

No Supabase migration is expected.

## Test strategy

A22 is application-only and should use fail-first application contracts before implementation.

The RED suite must prove the missing browser behavior while preserving all A1-A21 application contracts. It should freeze:

- settings routes/navigation;
- typed A7/A8 browser API projection and mutation methods;
- safe method/body/idempotency behavior;
- exact one-session-refresh idempotency-key reuse;
- one-time secret non-persistence;
- step-up and conflict mapping;
- role-aware presentation without claiming authorization;
- absence of browser provider/financial authority;
- unchanged 25/6 runtime manifest and absence of A22 migration.

A21's old assertion that the browser API contains no POST/PATCH methods must be narrowed: A22 legitimately adds **non-financial dashboard administration mutations**. The enduring A21 safety invariant is that the browser has no direct financial/provider mutation authority.

## Decision

Proceed with A22 as an **application-only strict-TDD slice**. Reuse A7/A8 exactly; introduce no new trusted backend capability and no hosted DDL.
