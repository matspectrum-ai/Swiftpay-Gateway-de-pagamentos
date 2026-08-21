# SwiftPay V2 — A6 Dashboard Session Authentication — Problem Analysis

Date: 2026-08-16
Status: **FROZEN PROBLEM ANALYSIS**
Next artifact: `docs/specs/dashboard-session-authentication-v0.yaml`

## Problem statement

K3/K4 already prove the canonical dashboard authorization rule inside PostgreSQL:

```text
server-verified Supabase Auth user id
  -> app.require_dashboard_merchant_context(...)
  -> current auth.users row
  -> current app.merchant_members row
  -> owner > admin > member hierarchy
```

The executable Fastify runtime, however, only authenticates SwiftPay machine credentials. There is no server-side boundary that accepts a Supabase Auth access token, verifies the current user with Supabase Auth, and composes that verified user identity with K4.

Without that boundary, sensitive merchant administration surfaces such as webhook endpoint management, API credential lifecycle, KYC operations and member administration either remain unavailable or would be tempted to misuse the unscoped machine Bearer credential as an administrative superkey.

A6 must make dashboard user identity executable without weakening the existing machine-auth realm, trusting client-supplied user metadata, adding direct browser/table mutation authority, or importing Supabase elevated/server secret keys into the API.

## Current canonical evidence

### Database authorization already exists

`app.require_merchant_membership(user_id, merchant_id, required_role)`:

- requires a real `auth.users` row;
- rejects anonymous users;
- rejects soft-deleted users;
- requires an active `app.merchant_members` row;
- uses only `member | admin | owner` as the role hierarchy;
- rejects insufficient role immediately.

`app.require_dashboard_merchant_context(user_id, merchant_id, environment, required_role)` composes K3 with an exact `sandbox | production` environment and is executable only by `swiftpay_api`.

This database rule remains the merchant authorization source of truth. JWT custom/user metadata must never become merchant membership authority.

### HTTP runtime only has machine authentication

The Fastify API currently parses `Authorization: Bearer <token>` only for machine-authenticated payment/balance routes and validates it through SwiftPay A1 credentials/tokens.

Machine access tokens have SwiftPay-owned issuer/audience/signing rules. They are not Supabase user sessions and they have no administrative scope vocabulary.

Dashboard authentication must therefore be a distinct route/authentication realm. The runtime must never guess which token type was supplied based on token contents and then fall through from one verifier to another.

### Canonical Supabase project state

Project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

Read-only inspection on 2026-08-16 shows:

- `auth.users`: 0 rows;
- `auth.sessions`: 0 rows;
- a modern publishable API key is enabled;
- the legacy anon API key is also still enabled.

The presence of a publishable key does **not** prove which JWT signing algorithm future user sessions will use; API-key migration and Auth JWT-signing-key migration are independent concerns.

A6 must therefore not require the project JWT secret and must not assume HS256, ES256 or RS256 session signing locally.

## Supabase Auth verification decision

For A6 V0, dashboard identity is verified **online by the project Auth service**, equivalent to `supabase.auth.getUser(accessToken)` semantics.

Supabase's current official JavaScript documentation states that `getUser(jwt)` performs a network request to the Auth server and returns an authentic, current user record suitable as an identity basis. The docs distinguish this from `getSession`, whose embedded user object must not be trusted server-side without verification.

### Why online verification in V0

This intentionally avoids:

- placing the legacy JWT secret in SwiftPay API configuration;
- depending on the project's current user-session signing algorithm;
- implementing local JWKS rotation/cache semantics before dashboard usage exists;
- trusting a browser-decoded JWT payload;
- conflating a Supabase publishable API key with a user session.

The cost is one Auth-network request for a dashboard authentication attempt. That tradeoff is acceptable for the initial administrative control plane and can be revisited later with a separately proven JWKS verifier if latency/availability requires it.

### API key used to reach Auth

The Auth request uses the project's **publishable** API key, not a Supabase secret/service-role key.

The publishable key identifies the application component and is explicitly low privilege / safe for public clients. It does not grant database bypass authority. The user's access JWT remains the identity credential.

A6 must never require a Supabase secret key or legacy `service_role` key.

## Proposed HTTP/Auth boundary

A6 reserves a separate dashboard realm:

```text
/dashboard/v1/**
```

Future routes under this namespace use Supabase user-session authentication only.

Existing machine routes remain under `/v1/**` and continue to use SwiftPay A1 machine Bearer authentication.

A6 itself does not need to expose a diagnostic/business route merely to prove the verifier. It provides an executable reusable runtime service for subsequent dashboard routes.

### Authorization header

Dashboard request format:

```text
Authorization: Bearer <Supabase Auth access token>
```

Parsing is strict:

- exactly one Bearer token;
- no whitespace-separated extra credential;
- empty/missing/malformed header is invalid;
- token is never logged.

The same header syntax exists in the machine realm, but route ownership determines which verifier is called. There is no verifier fallback.

## Proposed server verifier transport

Production dashboard verification performs one request to the configured Supabase Auth service for the supplied access token.

Conceptual request:

```text
GET <supabase-project-url>/auth/v1/user
apikey: <publishable-key>
Authorization: Bearer <user-access-token>
```

A6 must use a transport/verifier dependency boundary so tests remain deterministic and do not call hosted Supabase Auth.

The production transport must:

- accept only an HTTPS project URL;
- build the fixed `/auth/v1/user` path itself;
- never accept an arbitrary caller-controlled Auth URL/path;
- send the publishable key only in `apikey`;
- send the user token only in `Authorization`;
- perform one request with no hidden retry;
- use a bounded timeout;
- ignore redirect responses rather than forwarding credentials cross-origin;
- bound/parse response data conservatively;
- never log token/key/user response bodies.

## Authentication outcome classification

A6 must distinguish invalid identity from infrastructure failure.

### Invalid session -> authentication denied

Examples:

- missing/malformed Bearer header;
- Auth explicitly rejects the user token as unauthenticated/invalid/expired;
- successful Auth response has no usable user ID only when the response itself clearly denotes no authenticated user.

Future HTTP mapping: `401 invalid_dashboard_session`.

### Auth service unavailable -> infrastructure failure

Examples:

- timeout;
- DNS/network/TLS failure;
- redirect;
- provider 429;
- provider 5xx;
- malformed/unparseable successful response;
- unexpected response class that cannot prove invalid identity safely.

Future HTTP mapping: `503 dashboard_authentication_unavailable`.

An Auth outage must never be reported as proof that a previously valid user is invalid.

## Verified principal

The Auth verifier produces a minimal principal:

```text
DashboardUserPrincipal
  userId: UUID
```

Optional display/profile metadata is outside the authorization contract and must not be carried as authority.

The principal does not contain:

- merchant ID from JWT metadata;
- merchant role from JWT metadata;
- environment authorization;
- KYC/lifecycle permission;
- financial capability.

Those are resolved from canonical current database state when the route requires them.

## Merchant context composition

Future dashboard routes call a reusable authorization service with:

```text
principal.userId
requested merchantId
requested environment
route-required minimum role
```

The service invokes only:

```text
app.require_dashboard_merchant_context(user_id, merchant_id, environment, required_role)
```

and returns the current canonical context:

```text
merchantId
environment
membershipRole
```

No direct `auth.users` or `app.merchant_members` query is added to the API runtime.

### Membership denial classification

K4 authorization denial is an authorization failure, not an authentication failure.

Future HTTP mapping should be `403 operation_forbidden` (or a dashboard-specific equivalent frozen by the consuming route), without leaking whether another merchant/user/membership exists.

Invalid environment/input is a deterministic request-validation failure.

Unexpected database errors are infrastructure/internal failures.

A6 service contracts should preserve those categories for later HTTP consumers.

## Session revocation / freshness boundary

Online Auth verification gives SwiftPay a current Auth user response for each authentication attempt. K4 separately re-checks the current `auth.users` row and current merchant membership before authorization.

Therefore:

- deleted/anonymous/missing users fail K4 even if a forged/stale caller tried to present a user ID through an internal bug;
- disabled/removed merchant membership takes effect immediately at the K4 database boundary;
- merchant role changes are read from current database state, not session claims.

A6 does not implement refresh-token rotation or browser session renewal. Those remain frontend/Supabase Auth concerns.

## MFA / AAL boundary

Supabase user access tokens can carry authentication assurance information, but A6 V0 does not turn AAL into merchant role authority.

Generic dashboard authentication accepts a valid current user session. Later highly sensitive actions such as signing-secret rotation, credential rotation or payout approval may require a separately frozen step-up/MFA contract.

A6 must not silently claim that all authenticated dashboard sessions are sufficient for every administrative operation.

## CORS / cookies / CSRF boundary

A6 authenticates API requests using an explicit Bearer access token. It does not introduce server-side session cookies or cookie-based authorization.

Therefore A6 itself does not add a new cookie/CSRF trust model. A future web frontend may store/refresh Supabase sessions using an SSR/browser library, but it sends the access token to SwiftPay's dashboard API explicitly.

CORS/origin policy for the eventual dashboard frontend is a separate deployment/application decision and must not substitute for authentication.

## Testability

A6 should be testable without hosted Auth users.

Required deterministic tests include:

- strict Bearer parsing;
- verified user ID success;
- invalid/expired token classification;
- 429/5xx/network/timeout/redirect -> unavailable rather than invalid;
- malformed successful response -> unavailable;
- exactly one Auth transport attempt;
- credentials not included in errors/loggable return values;
- no service-role/secret-key configuration surface;
- no machine-token fallback in dashboard realm;
- K4 store uses only `require_dashboard_merchant_context`;
- member/admin/owner hierarchy behavior through the real isolated database;
- revoked/deleted/anonymous/missing user and inactive membership rejection through K4;
- no direct table privilege expansion.

A6 requires no database migration if the existing K4 routine is sufficient.

## Non-objectives

- Sign-up/login UI.
- Password, magic-link, OAuth or MFA enrollment flows.
- Browser cookie/session storage.
- User invitation/member-management APIs.
- Webhook endpoint CRUD.
- API credential CRUD/rotation.
- KYC operations.
- Provider integration/authentication.
- Local JWKS verification/caching.
- Supabase JWT signing-key migration/rotation.
- Supabase secret/service-role key usage.
- Merchant lifecycle/KYC financial capability decisions.
- Any monetary execution.

## Required next artifact

`docs/specs/dashboard-session-authentication-v0.yaml` must freeze:

- principal type;
- dashboard auth realm;
- strict token parsing;
- Auth request/transport contract;
- timeout/redirect/retry policy;
- response validation;
- error taxonomy;
- K4 store contract;
- deterministic RED acceptance matrix;
- explicit no-secret/no-service-role/no-direct-DML invariants.

No implementation is authorized until that spec is frozen and the RED suite fails cleanly only because the A6 runtime behavior does not yet exist.
