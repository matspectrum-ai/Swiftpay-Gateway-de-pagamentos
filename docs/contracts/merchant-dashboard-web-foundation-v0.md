# A21 — Merchant Dashboard Web Foundation Contract v0

Status: FROZEN  
Spec: `docs/specs/merchant-dashboard-web-foundation-v0.yaml`

## 1. Product boundary

A21 introduces the first browser-facing SwiftPay merchant application at `apps/dashboard` and one new trusted read-only bootstrap capability. It does not add PSP execution, Pix creation from the dashboard, payout/refund operations, provider webhook ingress, KYC operations, hosted checkout or Payment Links.

The dashboard is a React/Vite browser SPA. It has no PostgreSQL runtime identity and no provider or financial authority.

## 2. Browser authority

The browser may possess only:

- the Supabase project URL;
- the Supabase publishable key;
- a normal Supabase Auth user session/access token;
- non-secret selected merchant/environment UI state.

The browser must never receive or reference:

- `SWIFTPAY_API_DATABASE_URL` or `SWIFTPAY_WORKER_DATABASE_URL`;
- PostgreSQL credentials;
- `swiftpay_api` or `swiftpay_worker` role credentials;
- Supabase secret/service-role keys;
- PSP/provider credentials;
- A15/A16/A18 signing/HMAC authorities;
- webhook RSA private keys.

The Supabase browser client is Auth-only. SwiftPay product state must not be read with `supabase.from(...)` or `supabase.rpc(...)`.

## 3. Browser-to-API transport

All SwiftPay dashboard HTTP requests use the fixed relative prefix `/api` and carry the current Supabase Auth access token in exactly one `Authorization: Bearer <access_token>` header.

A21 does not enable generic cross-origin dashboard API access. Local development may proxy `/api` to the local API process; production ingress must preserve the same-origin `/api` contract.

Authenticated dashboard responses are consumed with `cache: "no-store"` and the trusted API responses must specify `Cache-Control: no-store`.

## 4. Dashboard context discovery HTTP contract

### Request

`GET /dashboard/v1/contexts`

Headers:

- `Authorization: Bearer <Supabase access token>` — required.

No merchant ID, environment or user ID is accepted from the caller.

### Success

Status: `200`

```json
{
  "object": "list",
  "data": [
    {
      "merchantId": "uuid",
      "merchantName": "Merchant name",
      "lifecycleStatus": "active",
      "membershipRole": "owner",
      "environments": ["sandbox", "production"]
    }
  ]
}
```

Ordering is deterministic: case-insensitive merchant name, then merchant UUID.

`lifecycleStatus` is one of `draft | active | suspended | closed`, exactly matching the canonical merchant constraint. No lifecycle state is hidden by this read-only discovery surface.

`membershipRole` is one of `member | admin | owner` and is sourced through the canonical K3 role authority.

### Errors

- malformed, missing or invalid dashboard session → `401 invalid_dashboard_session`;
- Supabase Auth verification unavailable → `503 dashboard_authentication_unavailable`;
- trusted database/service failure → `500 internal_error`.

No membership existence, SQL, provider or internal database details may appear in an error.

## 5. Application service contract

The context-discovery service receives only the raw `Authorization` header from Fastify.

It must:

1. call the existing A6 online session verifier exactly once;
2. obtain `userId` only from that verified result;
3. if verification is invalid/unavailable, stop before PostgreSQL;
4. call the new context store with only the verified `userId`;
5. return a public projection containing only the fields in section 4.

It must not accept a caller-supplied user ID and must not fall back to A1 machine authentication.

## 6. Database routine contract

New routine:

`app.list_dashboard_merchant_contexts(uuid)`

Properties:

- `STABLE`;
- `SECURITY DEFINER`;
- explicit `search_path = pg_catalog, app, auth`;
- executable by `swiftpay_api` only among SwiftPay runtime/Data API roles;
- not executable by `swiftpay_worker`, `PUBLIC`, `anon`, `authenticated` or `service_role`;
- no direct relation grants are added.

Returned columns:

1. `merchant_id uuid`
2. `merchant_name text`
3. `lifecycle_status text`
4. `membership_role text`

Rules:

- unknown, anonymous or deleted `p_user_id` fails closed;
- only candidate memberships with `merchant_members.status = 'active'` are considered;
- every returned role is confirmed by `app.require_merchant_membership(p_user_id, merchant_id, 'member')`;
- unrelated and inactive memberships never appear;
- merchant lifecycle is projected, not used to expand authority;
- no environment table/permission is invented: A6 already defines dashboard membership as valid independently for the explicit `sandbox | production` route environment, so each discovered merchant exposes exactly both environment choices.

## 7. A20 capability-manifest delta

A21 is allowed exactly one API database-capability addition:

`app.list_dashboard_merchant_contexts(uuid)`

Expected counts become:

- `swiftpay_api`: 25;
- `swiftpay_worker`: 6.

All prior API and worker signatures remain unchanged. Any other addition/removal is a test failure.

## 8. Web application contract

### Login

Route: `/login`

A21 supports existing-user email/password sign-in only through `supabase.auth.signInWithPassword`.

Sign-up, password recovery, OAuth and MFA enrollment UI are outside A21.

### Shell

After a valid session, the app loads `/api/dashboard/v1/contexts` before requesting transaction data.

If contexts are empty, it renders a deterministic no-merchant-access state and makes no A9 request.

The selected context is persisted only as:

```json
{
  "merchantId": "uuid",
  "environment": "sandbox | production"
}
```

under localStorage key `swiftpay.dashboard.context.v1`. A stored selection is ignored unless the merchant remains present in the latest discovery response.

Default selection: first discovered merchant + `sandbox`.

### Transactions list

Source route only:

`GET /api/dashboard/v1/merchants/:merchantId/environments/:environment/transactions?limit=25[&cursor=...]`

Pagination uses A9 cursor semantics only. No offset pagination or browser-side database query is introduced.

### Transaction detail

Source route only:

`GET /api/dashboard/v1/merchants/:merchantId/environments/:environment/transactions/:transactionId`

A9 remains authoritative for tenant scoping and not-found behavior.

### Required UI states

- session loading;
- signed out;
- context loading;
- no merchant access;
- transaction loading;
- transaction list empty;
- transaction list ready;
- transaction detail loading;
- transaction detail ready;
- transaction not found;
- invalid/expired session;
- forbidden;
- service unavailable;
- sanitized generic error.

No raw upstream body or exception is rendered.

## 9. Web security contract

- no third-party scripts;
- no `dangerouslySetInnerHTML`;
- no untrusted HTML injection;
- no target-blank opener authority;
- production document/security headers must encode the CSP baseline frozen by the YAML spec;
- no auth tokens, provider payloads or secrets are rendered/logged;
- Supabase is allowed only as an Auth network origin; SwiftPay state remains behind `/api`.

## 10. TDD acceptance

A21 cannot be marked GREEN until tests prove all of the following:

- `apps/dashboard` exists and builds;
- browser source contains no trusted database/service-role/provider authority;
- Supabase usage is Auth-only;
- context discovery has the exact A6 → trusted DB flow;
- the new routine returns only authorized active memberships;
- A20 exact capability allowlist changes from 24/6 to exactly 25/6 with only the frozen new signature;
- transaction UI references only A9 list/detail routes;
- invalid session, forbidden, unavailable and not-found UI/API states are deterministic and sanitized;
- no payment/provider rows or provider traffic are generated by A21 tests/attestation.

## 11. Deployment boundary

A21 freezes a static browser workload plus same-origin `/api` ingress contract, but does not yet select or authorize a production hosting vendor, DNS cutover, WAF policy or deployment credential model. Those remain launch/deployment work and cannot weaken this browser authority contract.
