# A14 — Trusted Ingress, Abuse & Rate-Limit Hardening — Problem Analysis

Status: **FROZEN PROBLEM ANALYSIS**  
Date: 2026-08-18  
Implementation authority: **NONE**

## 1. Problem

SwiftPay now has a strong application/security baseline through A13, but its public API still lacks a coherent production abuse-control boundary.

A1 deliberately implemented only the successful token-issuance quota. That quota is distributed in PostgreSQL and prevents an already authenticated API credential from issuing more than ten access tokens per hour. It is intentionally consumed only after credential existence/status, secret verification and exact-IP policy succeed, because consuming a credential-scoped quota before secret verification would let an attacker who knows a public key deny service to the legitimate merchant.

That design is correct for credential issuance but leaves broader production abuse questions unresolved:

- how are unauthenticated token-exchange attempts bounded before expensive secret verification?
- how are authenticated machine clients prevented from flooding Payment/balance reads or create operations?
- how are dashboard sessions prevented from amplifying repeated online Supabase Auth checks and downstream K4/database work?
- how is the unauthenticated database-touching `/health/ready` endpoint protected from internet-originated request floods?
- which network address is authoritative when the API is deployed behind a reverse proxy/load balancer?
- how are limits made consistent across multiple API instances without relying on per-process memory?

A14 must solve the abuse-control trust model before any generic rate-limit middleware is introduced.

## 2. Current repository facts

### 2.1 A1 successful token issuance quota already exists

`POST /v1/auth/token` is unauthenticated and preserves the legacy `client_credentials` request shape.

A1 currently:

1. validates the request;
2. looks up the credential by public key;
3. verifies active credential + active merchant;
4. verifies the scrypt secret;
5. evaluates the exact-IP allowlist;
6. atomically consumes the credential token-issuance quota;
7. signs a 900-second access token.

The PostgreSQL quota is exactly 10 successful issuances per credential in a fixed 3600-second window. Denial returns a deterministic `429 auth_rate_limit_exceeded` plus `Retry-After` and does not mutate `last_used_at`.

A1 explicitly states that invalid-secret distributed brute-force/WAF controls are out of scope.

### 2.2 Current client IP authority is the direct Fastify peer

Token exchange passes `request.ip` into the A1 IP policy.

The current Fastify bootstrap does not configure `trustProxy`; caller-controlled `X-Forwarded-For` is therefore not authoritative. The A1 contract explicitly freezes this behavior until deployment topology defines trusted proxy hops.

`SWIFTPAY_API_HOST` defaults to `127.0.0.1`, but may be configured to another bind address. The repository does not yet freeze a production ingress proxy/load-balancer identity contract.

Therefore an application rate limiter keyed to forwarded client IP would be unsafe today, while a limiter keyed only to the direct peer could collapse all users behind a reverse proxy into one bucket.

### 2.3 Authenticated machine routes have no general request quota

The public machine realm currently includes:

- `POST /v1/transactions`;
- `GET /v1/transactions/:id`;
- `GET /v1/balance`.

Every request verifies the bearer token and revalidates current credential/merchant state through the trusted database boundary. This prevents stale/revoked credentials but does not bound request volume per credential/merchant.

### 2.4 Dashboard routes have no SwiftPay abuse quota

Dashboard session verification performs an online `GET <supabase>/auth/v1/user` call for each authorization attempt. Successful verification then passes through current K4 merchant/environment/role authorization before dashboard business behavior.

Dashboard routes include webhook endpoint administration, API credential administration and transaction list/detail. A7/A8 mutations already have authorization, optimistic concurrency and idempotency controls, but none of these are request-rate controls.

Repeated invalid/valid dashboard traffic can therefore amplify calls to Supabase Auth and trusted database routines even when no business mutation succeeds.

### 2.5 Health surfaces are distinct

- `/health/live` is a process-liveness response and performs no database readiness work.
- `/health/ready` executes the database readiness boundary and is currently unauthenticated on the API listener.
- A13 metrics use a separate opt-in listener bound only to `127.0.0.1` and do not expand the public API surface.

Readiness must not become an unbounded public database-amplification endpoint in a production deployment.

## 3. Goal

Define a production-safe, horizontally consistent abuse-control model for SwiftPay public ingress that:

- preserves the existing A1 credential issuance quota and anti-denial rationale;
- establishes which network identity is trustworthy before any IP-based control;
- introduces bounded request admission before protected business side effects;
- provides distributed post-authentication limits for machine/dashboard principals;
- protects expensive unauthenticated/runtime dependency boundaries without trusting spoofable forwarding headers;
- returns deterministic merchant-safe throttling responses;
- does not leak or persist raw secrets/tokens/PII as rate-limit keys;
- does not change financial/provider authority.

## 4. Non-goals

A14 does **not** authorize:

- a live PSP call or A5→A11 provider bridge;
- provider activation changes;
- CAPTCHA, browser fingerprinting or bot-detection vendor integration;
- choosing a CDN/WAF/load-balancer vendor;
- replacing Supabase Auth;
- changing A1 secret-verification parameters or token TTL;
- changing Payment idempotency semantics;
- adding merchant pricing/plan-based limits;
- KYC/compliance policy changes;
- distributed tracing/exporter work;
- performance-advisor cleanup unrelated to abuse controls.

## 5. Threats and failure modes

### 5.1 Credential stuffing / scrypt exhaustion

A known valid public key can cause repeated scrypt verification attempts with invalid secrets. The successful issuance quota does not protect this path because it correctly runs after secret verification.

A14 must not solve this by consuming the merchant credential quota before secret verification, because that creates a public-key denial-of-service primitive.

### 5.2 Authenticated machine flooding

A valid credential/token can repeatedly invoke authenticated routes, causing JWT work, database revalidation and business/database reads or create attempts. Idempotency prevents duplicate logical create effects for the same key, but it does not limit request volume.

### 5.3 Dashboard authentication amplification

Every dashboard authorization attempt can cause an outbound Supabase Auth call before SwiftPay knows the user identity. A per-user limiter applied only after online verification cannot protect the upstream Auth call itself.

### 5.4 Readiness amplification

Repeated unauthenticated `/health/ready` requests can repeatedly touch the database readiness boundary. Health checks need infrastructure trust semantics, not open-ended public polling semantics.

### 5.5 Forwarded-header spoofing

Trusting `X-Forwarded-For` without a frozen proxy trust chain lets callers choose their own limiter key or bypass IP allowlists/abuse controls.

### 5.6 Shared-proxy bucket collapse

Using only the direct peer when the direct peer is a load balancer can cause all customers to share one limiter bucket, allowing one client to throttle everyone.

### 5.7 Public-key quota poisoning

A pre-auth bucket keyed only by `publicKey` allows an attacker to exhaust another merchant's budget without possessing the secret.

### 5.8 Unbounded limiter state

A distributed limiter keyed by arbitrary attacker input can itself become a storage/CPU denial-of-service vector. Key derivation, retention and cleanup must be bounded.

### 5.9 Limiting after side effects

A rate-limit decision taken after idempotency claim, Payment creation, webhook mutation or credential mutation is too late. Admission must occur before the protected side effect.

### 5.10 Throttling changing correctness

A throttled request must not convert ambiguous provider execution into failure, break Payment idempotency, consume idempotency ownership, alter ledger state or change worker retry semantics.

## 6. Identity/trust classes to freeze in specification

A14 should treat ingress as several explicit trust classes rather than one global limiter:

### 6.1 Pre-auth token exchange

Identity available before secret verification:

- direct network peer;
- public key (attacker-controlled/guessable and therefore insufficient by itself).

Any real client-IP key requires a frozen trusted-proxy contract first.

### 6.2 Authenticated machine principal

After successful bearer authentication SwiftPay has bounded canonical identity:

- `credentialId`;
- `merchantId`;
- `environment`.

Credential-scoped distributed quotas are safe from public-key poisoning because the caller has proven token authority.

### 6.3 Dashboard session/user principal

After online Supabase verification SwiftPay has `userId`; after K4 authorization it also has merchant/environment/role context.

Post-auth dashboard quotas may use this canonical identity, but a separate ingress control is needed if the goal is to protect Supabase Auth itself.

### 6.4 Infrastructure health caller

Liveness/readiness callers are deployment infrastructure, not merchant principals. Their trust boundary should be explicit and should not reuse merchant/dashboard authentication.

## 7. Required invariants for the future spec

1. Existing A1 10/hour successful credential issuance quota remains authoritative and unchanged unless separately justified.
2. Invalid-secret attempts never consume that merchant credential issuance quota.
3. `X-Forwarded-For`/forwarded headers remain untrusted unless the exact proxy trust contract is explicitly configured and tested.
4. Any authoritative application limit that must hold across API replicas is distributed; per-process memory is not the source of truth.
5. Rate-limit keys cannot contain plaintext bearer tokens, Secret Keys, Supabase access tokens, customer data, raw request bodies or provider payloads.
6. If network addresses are persisted/centralized as abuse keys, raw IP persistence should be avoided; use a dedicated one-way keyed derivation if selected by the spec.
7. Caller-controlled `publicKey`, route IDs or arbitrary headers cannot be the sole distributed abuse identity.
8. Rate-limit admission happens before protected business/idempotency/financial side effects.
9. A denied request returns a stable 429 contract with bounded `Retry-After` and no internal limiter-key disclosure.
10. Throttling never grants additional authority and never changes A10/A11 provider activation state.
11. Rate-limit/storage failure semantics are explicit: fail-open vs fail-closed must be selected per route class rather than hidden in middleware.
12. A12 logs and A13 metrics must not expose limiter keys, raw IPs, tokens or high-cardinality attacker input.

## 8. Candidate V0 policy classes

The forthcoming spec should choose exact classes and limits from a small closed set such as:

- `token_exchange_pre_auth`;
- `machine_read`;
- `machine_mutation`;
- `dashboard_read`;
- `dashboard_mutation`;
- `readiness_probe`.

Route templates may map into these classes, but the class vocabulary must be closed. Dynamic route parameters must not create distinct limiter classes.

`/health/live` should normally remain a cheap liveness primitive rather than share merchant quotas.

## 9. Distributed-state design questions to resolve before RED

Before specification, freeze:

- authoritative algorithm: fixed window, sliding window or token bucket;
- exact quota numbers and window/refill periods per policy class;
- whether machine quota is keyed by credential or merchant+environment;
- whether dashboard quota is keyed by user or user+merchant+environment;
- how pre-auth ingress identity is derived when deployed behind a proxy;
- whether trusted proxy configuration is exact IP/CIDR allowlist or another fail-closed topology primitive;
- whether a dedicated HMAC key is required to derive opaque network/session limiter keys;
- limiter table/routine shape if PostgreSQL is the distributed source of truth;
- bounded row retention/cleanup and maximum key churn;
- concurrency/fencing semantics across API replicas;
- timeout/failure behavior of the limiter dependency;
- whether readiness should move to an infrastructure-only listener or remain on the API listener with an explicit trusted-peer policy.

A14 must not select a production client-IP scheme without settling the proxy trust model.

## 10. Error/HTTP semantics to freeze

The future contract should define a common throttling envelope without erasing route-specific existing errors.

Candidate stable concept:

- HTTP 429;
- public error code `rate_limit_exceeded` for general request throttling;
- existing A1 `auth_rate_limit_exceeded` remains unchanged for successful token-issuance quota exhaustion;
- integer `Retry-After` bounded by the selected policy window;
- server-owned requestId retained through A12 correlation;
- `Cache-Control: private, no-store` on authenticated/dashboard throttled responses where appropriate.

The limiter must not reveal whether an unknown public key exists.

## 11. Observability boundary

A13 already records HTTP status classes through closed route templates, so 429 responses are visible without introducing attacker-controlled labels.

If A14 later adds dedicated abuse metrics, they require a closed policy/outcome vocabulary. Forbidden dimensions include:

- IP address or derived limiter key;
- public key;
- credential/user/merchant/payment IDs;
- token fingerprint;
- raw route/path/query;
- secret/error text.

A12 logging should record at most a stable low-cardinality throttle event plus requestId/policy class if separately frozen; never the abuse key.

## 12. Acceptance strategy

A14 must follow strict TDD. Fail-first tests should prove at minimum:

- forwarded client-IP headers do not become authoritative without trusted-proxy configuration;
- trusted-proxy configuration, if selected, is strict/fail-closed and cannot be caller-controlled;
- existing A1 successful issuance quota remains 10/hour and invalid secret attempts do not consume it;
- a valid authenticated machine principal is limited consistently across independent API/database instances;
- dashboard limits use only verified canonical authority;
- limiter denial occurs before Payment/idempotency/webhook/credential mutation side effects;
- 429 + Retry-After is deterministic and bounded;
- limiter keys/secrets/IP/token canaries never appear in public responses, A12 logs or A13 metric labels/output;
- attacker-controlled high-cardinality input cannot create unbounded policy classes;
- limiter-state retention is bounded;
- no provider activation/network authority change;
- all A1-A13 application contracts, K5/K6/pgTAP and K7/A1-A9 real-database acceptance remain GREEN.

## 13. Decision

Proceed no further than Problem Analysis until the V0 trust/algorithm policy is frozen.

The specification must resolve two things before any implementation is authorized:

1. the **trusted ingress identity model**, especially reverse-proxy handling for pre-auth and readiness traffic;
2. the **distributed quota model**, including exact policy classes, limits, keys, retention and failure semantics.

Until those decisions exist:

- do not enable Fastify `trustProxy` generically;
- do not trust `X-Forwarded-For`;
- do not add an in-memory limiter and call it production-safe;
- do not consume the A1 credential issuance quota on invalid-secret attempts;
- do not add arbitrary limiter keys/labels/log fields;
- do not change Payment/provider/financial behavior.

Provider evidence acquisition remains a parallel external track and does not block A14 planning.
