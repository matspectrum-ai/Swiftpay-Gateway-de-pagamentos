# SwiftPay V2 — A22 Merchant Dashboard Integration Settings UI Contract

Status: **FROZEN FOR TDD**  
Date: 2026-08-19

A22 is an application-only browser composition contract. It creates no new trusted backend authority. A6/K4/A7/A8/A17 remain authoritative for authentication, authorization, mutation semantics, endpoint policy, idempotency and secret handling.

## Browser trust boundary

`apps/dashboard` may call existing SwiftPay dashboard routes through the same-origin `/api` prefix. It may not call the private `app` schema, Supabase Data API relations/RPCs, provider endpoints or financial mutation routes directly.

The browser does not become an authorization source. `membershipRole` may hide/disable controls for UX, but every operation remains server-authorized.

## Navigation

The A21 sidebar placeholders become navigable views:

- `Transações` -> `/transactions`
- `Credenciais API` -> `/settings/api-credentials`
- `Webhooks` -> `/settings/webhooks`

The selected merchant/environment context is shared by all three views. Context changes clear any one-time secret reveal.

## HTTP client contract

Every request uses the existing Supabase access token as `Authorization: Bearer ...`, `Accept: application/json` and `cache: no-store`.

Mutations additionally use:

- `Content-Type: application/json`
- exact `Idempotency-Key` supplied by the mutation action
- JSON request body.

A browser mutation action generates one `crypto.randomUUID()` idempotency key. If the first request receives the A21 session-expired classification and the existing one-refresh retry repeats the operation, the **same** key MUST be reused. A second explicit user action MUST use a different key.

Known safe HTTP classifications:

- 400 -> `validation`
- 401 -> `session`
- 403 + public error code `step_up_required` -> `step_up`
- other 403 -> `forbidden`
- 404 -> `not_found`
- 409 -> `conflict`
- 503 or transport failure -> `unavailable`
- other failure -> `error`.

Raw response errors, SQL details and stacks are never presented.

## API credential projection

```ts
interface DashboardApiCredential {
  id: string;
  merchantId: string;
  environment: 'sandbox' | 'production';
  name: string;
  publicKey: string;
  status: 'active' | 'revoked';
  secretVersion: number;
  revision: number;
  ipAllowlist: readonly string[] | null;
  lastUsedAt: string | null;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}
```

### List

`GET /api/dashboard/v1/merchants/{merchantId}/environments/{environment}/api-credentials`

Returns `{ object: 'list', data: DashboardApiCredential[] }`.

### Create

`POST /api/dashboard/v1/merchants/{merchantId}/environments/{environment}/api-credentials`

Body:

```json
{"name":"Integration name","ipAllowlist":null}
```

`ipAllowlist` may be omitted/null or an exact-IP array according to A8.

Winning response may contain:

```ts
{
  credential: DashboardApiCredential;
  secretAvailable: true;
  secretKey: string;
  replayed: false;
}
```

A completed replay has no plaintext secret. A22 MUST key reveal behavior off `secretAvailable === true` and a present string secret.

### Rotate secret

`POST .../api-credentials/{credentialId}/rotate-secret`

Body: `{ expectedRevision: positiveInteger }`.

Same one-time `secretKey` rules as create.

### Revoke

`POST .../api-credentials/{credentialId}/revoke`

Body: `{ expectedRevision: positiveInteger }`.

The UI requires explicit confirmation. A22 never implements un-revoke or delete.

### Role/step-up UX

Reads remain available to member/admin/owner.

Mutation-control visibility:

- Sandbox: admin/owner;
- Production: owner.

This is UX only.

Any exact A8 `step_up_required` response renders `Autenticação adicional necessária`. A22 does not implement MFA enrollment/challenge and never downgrades or bypasses A8.

## Webhook endpoint projection

```ts
interface DashboardWebhookEndpoint {
  id: string;
  merchantId: string;
  environment: 'sandbox' | 'production';
  url: string;
  status: 'active' | 'disabled';
  subscribedEvents: readonly ['payment.paid'];
  secretVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
```

### List

`GET /api/dashboard/v1/merchants/{merchantId}/environments/{environment}/webhook-endpoints`

Returns `{ object: 'list', data: DashboardWebhookEndpoint[] }`.

### Create

`POST /api/dashboard/v1/merchants/{merchantId}/environments/{environment}/webhook-endpoints`

Body:

```json
{"url":"https://merchant.example/webhooks/swiftpay","subscribedEvents":["payment.paid"]}
```

Winning response may reveal `signingSecret` once. Completed replay cannot redisclose it.

### Update

`PATCH .../webhook-endpoints/{endpointId}`

Body contains `expectedRevision` plus at least one A7 mutable field. A22 V0 exposes URL editing; URL edit control is enabled only for a disabled endpoint. Server-side A7 remains authoritative.

Subscription remains exact `payment.paid`; A22 does not expose arbitrary events.

### Disable / enable

`POST .../{endpointId}/disable`  
`POST .../{endpointId}/enable`

Body: `{ expectedRevision: positiveInteger }`.

### Rotate signing secret

`POST .../{endpointId}/rotate-secret`

Body: `{ expectedRevision: positiveInteger }`.

Winning response may reveal `signingSecret` once. Replay never does.

Webhook mutation controls are visible to admin/owner for UX. Backend A7 role checks remain authoritative.

## One-time secret reveal contract

Plaintext `secretKey` and `signingSecret` may exist only in ephemeral component state while a reveal panel is open.

Forbidden persistence/transport:

- `localStorage`
- `sessionStorage`
- IndexedDB
- URL path/query/hash
- console/logging/telemetry
- error objects
- automatic clipboard writes.

An explicit user-initiated **Copiar** action may write the currently displayed secret to the clipboard.

Reveal state is cleared on:

- dismiss;
- merchant/environment change;
- navigation away from the relevant settings view;
- logout/session loss.

A completed idempotency replay with `secretAvailable: false` never reconstructs or displays an old secret.

## UI states

Both settings views must expose bounded states for loading, empty, unauthorized/read-only role, validation failure, conflict, unavailable service and generic failure.

API credential UI additionally exposes:

- `Autenticação adicional necessária` for exact A8 step-up;
- active-credential limit conflict;
- active/revoked state;
- one-time secret reveal.

Webhook UI additionally exposes:

- endpoint-limit conflict;
- active/disabled state;
- one-time signing-secret reveal.

## A21 compatibility

A21's original application contract rejected any POST/PATCH text in the browser API because A21 itself was read-only. A22 legitimately introduces **dashboard administration** mutations. The A21 test must therefore be narrowed to the enduring invariant: no browser financial/provider mutation authority.

No A21 authentication/context/transaction behavior may regress.

## Capability and database invariance

A22 adds no migration and no trusted database routine.

`ops/security/runtime-capabilities-v0.json` remains exactly:

- `swiftpay_api.expectedCount = 25`
- `swiftpay_worker.expectedCount = 6`.

No provider activation state or financial state changes are authorized by A22.

## Acceptance

A22 is GREEN only when:

1. settings navigation is active;
2. A7/A8 list and mutation browser clients satisfy the exact method/path/body/idempotency boundaries;
3. step-up and conflict responses are sanitized and distinguishable;
4. one-session-refresh mutation retry reuses the original idempotency key;
5. one-time secrets are ephemeral and never browser-persisted;
6. role-aware controls are presentation only;
7. dashboard build/typecheck and all A1-A22 application contracts are GREEN;
8. runtime capability manifest remains 25/6;
9. no A22 Supabase migration exists;
10. no live PSP/provider or financial mutation path is introduced.
