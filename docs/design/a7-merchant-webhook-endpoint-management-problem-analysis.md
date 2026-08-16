# SwiftPay V2 — A7 Merchant Webhook Endpoint Management — Problem Analysis

Date: 2026-08-16
Status: **FROZEN PROBLEM ANALYSIS — implementation not authorized until spec + clean RED**

## Problem statement

A4 proves durable, signed, retryable merchant webhook delivery, and A6 proves server-side Supabase dashboard-session verification composed with the current K3/K4 merchant/environment/role truth. The remaining merchant-usability gap is that an authorized dashboard user still cannot safely create, inspect, change, disable, re-enable or rotate a merchant webhook endpoint.

This is security-sensitive configuration, not ordinary CRUD. Changing a target URL can redirect merchant event data. Changing subscriptions changes the data-exposure surface. Rotating a signing secret changes the receiver trust relationship. A write surface that is merely merchant-scoped but not idempotent, audited, concurrency-safe and key-isolated would weaken already accepted A4/K4 properties.

A7 therefore has to add management without:

- widening A1 machine credentials into administrative credentials;
- giving the API A4's worker-only symmetric decryption key;
- allowing browser/Data API mutation of `app.webhook_endpoints`;
- redirecting already-created deliveries when an endpoint URL changes;
- losing signing-secret versions referenced by durable deliveries;
- persisting or replaying plaintext signing secrets;
- allowing stale administrators to overwrite newer endpoint configuration;
- inventing subscriptions for events SwiftPay does not yet emit;
- changing Payment, ledger, balance, provider, payout or refund state.

## Proven predecessor state

### A4 delivery runtime

A4 already freezes:

- durable `webhook_events`, `webhook_deliveries` and `merchant_webhook_delivery` jobs;
- one immutable `signing_secret_version` snapshot on each delivery;
- HMAC-SHA256 over exact transmitted bytes;
- strict HTTPS/443 + DNS/IP/redirect/SSRF policy checked at dispatch;
- at-least-once remote HTTP semantics with stable event/delivery identity;
- maximum eight durable dispatch attempts and no hidden HTTP retry;
- worker-only claim/resolve routines;
- worker-only `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY` for legacy `aes-256-gcm-v1` ciphertext;
- no financial authority.

A4 currently selects the endpoint URL from the mutable endpoint row at claim time. That was acceptable while no endpoint-management API existed. It is not acceptable once merchants can edit the URL: a later edit must not silently redirect an already-created delivery.

A4 also stores only current + one previous secret ciphertext on `webhook_endpoints`. That shape cannot safely represent two rapid rotations while durable deliveries still reference multiple historical `signing_secret_version` values.

### A6 dashboard authorization

A6 already freezes the correct administrative identity chain:

```text
strict dashboard Bearer
  -> online Supabase Auth user verification
  -> verified user UUID only
  -> app.require_dashboard_merchant_context(...)
  -> current merchant/environment/membership role
```

Machine `/v1/**` authentication and dashboard `/dashboard/v1/**` authentication are separate realms with no fallback.

A7 must reuse this boundary. It must not infer merchant or role authority from JWT metadata and must not grant webhook-management capability to A1 machine credentials.

### Existing generic primitives

The schema already has two useful primitives that A7 should compose rather than duplicate:

1. `app.request_idempotency`, uniquely scoped by merchant + environment + operation + normalized idempotency key.
2. append-only `app.audit_events` through `app.record_audit_event(...)`, whose source identity is replay-safe and rejects conflicting immutable data.

`swiftpay_api` has no direct table privileges and does not have generic direct audit authority. A7 should preserve that shape by exposing operation-specific SECURITY DEFINER routines that compose authorization, idempotency, mutation and audit transactionally.

## Decision 1 — route realm and authorization

A7 is a dashboard/admin surface under:

`/dashboard/v1/merchants/:merchantId/environments/:environment/webhook-endpoints`

Minimum roles:

- list/get: `member`;
- create/update/disable/re-enable/rotate-secret: `admin`.

Requiring `owner` only for rotation would not materially reduce privilege because an `admin` able to create a new endpoint can already redirect subscribed event data and receive a new signing secret. `admin` is therefore the coherent minimum mutation role for V0.

Every route first uses A6. Every trusted database routine also re-evaluates K4 authorization with the verified `userId` before reading or mutating endpoint state. The second K4 check is deliberate defense in depth and ensures a role downgrade/disable that races between HTTP authorization and the database mutation fails closed.

No A1 machine-token fallback is allowed.

## Decision 2 — endpoint lifecycle is disable, not delete

A7 does not expose DELETE.

Endpoint state remains:

- `active`;
- `disabled`.

Disabling:

- prevents new event fanout immediately after commit;
- transactionally terminalizes currently `pending` not-yet-leased deliveries for that endpoint as `disabled` and completes their paired jobs without incrementing attempts;
- does not erase events/deliveries/audit history;
- cannot recall a request already handed to a worker transport path before disable committed.

Already leased/in-flight remote HTTP may therefore complete once. This is an explicit at-least-once limitation, not a claim of instantaneous remote revocation.

Re-enable affects only future eligible fanout. Deliveries already terminalized as `disabled` are never resurrected.

## Decision 3 — URL mutation and immutable delivery destination

A7 adds `endpoint_url_snapshot` to `app.webhook_deliveries` and backfills it from the referenced endpoint.

New fanout snapshots both:

- endpoint URL;
- signing-secret version.

Worker claim must use the delivery URL snapshot, not the current endpoint URL.

This prevents an endpoint edit from redirecting already-created durable work.

To avoid surprising delivery to a stale target during ordinary endpoint changes, V0 permits URL mutation only while the endpoint is `disabled`. The intended sequence is:

```text
disable -> pending deliveries terminalized -> update URL -> re-enable
```

A delivery already leased before disable may still issue one remote request, as documented above.

Subscriptions may change while active because subscription changes apply only to future fanout; existing delivery identity/fanout is immutable.

The API must validate the normalized URL against the same A4 endpoint policy before persistence. The worker still resolves and validates DNS again for every actual dispatch, so management-time validation is not treated as an SSRF bypass token.

## Decision 4 — executable subscription vocabulary

A7 V0 accepts exactly the currently executable merchant event:

- `payment.paid`.

The API rejects unknown, duplicate, empty or aspirational event names. Refund/payout events remain unavailable until their event producers and public payload contracts are executable.

Subscriptions are canonicalized as a sorted unique array before hashing/persistence.

## Decision 5 — signing-secret plaintext format and one-time disclosure

A7 signing secrets use:

```text
whsec_<base64url(randomBytes(32), no padding)>
```

Properties:

- 32 CSPRNG random bytes;
- plaintext is generated only in trusted API memory;
- plaintext is returned only on the winning create/rotate response;
- plaintext is never stored in PostgreSQL, request idempotency snapshots, audit metadata, job payloads or logs;
- list/get/update/disable/re-enable never return plaintext;
- exact idempotency replay of create/rotate never generates or returns another secret.

If the first successful create/rotate response is lost, a replay returns the completed public operation projection with `secretAvailable: false`. The merchant must perform a new explicit rotation with a new idempotency key to obtain a new plaintext secret. Persisting plaintext merely to make HTTP replay return it is explicitly rejected.

## Decision 6 — API encrypt-only / worker decrypt key custody

The A4 symmetric AES key remains worker-only and is not added to API configuration.

New A7 secrets use a versioned asymmetric wrapping format:

- algorithm: RSA-OAEP;
- OAEP/MGF1 hash: SHA-256 explicitly;
- public key: API only, non-secret encrypt authority;
- private keys: worker-only keyring;
- minimum RSA modulus: 2048 bits;
- ciphertext encoding: base64url without padding;
- wrapping key identifier: explicit, bounded deployment-controlled ID.

The OAEP label binds ciphertext to:

```text
swiftpay-webhook-secret-wrap-v1
<endpoint-id>
<secret-version>
<wrapping-key-id>
```

This prevents a valid ciphertext from being transplanted to another endpoint/version/key identity and successfully unwrapped.

Node 24 provides `publicEncrypt`/`privateDecrypt` with RSA OAEP, configurable `oaepHash` and `oaepLabel`. The implementation must set `oaepHash: 'sha256'` explicitly; it must never inherit the Node API default.

Deployment configuration:

API:

- `SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID`;
- `SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY` — base64url DER SPKI RSA public key.

Worker:

- `SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS` — secret JSON keyring mapping wrapping-key IDs to base64url DER PKCS8 RSA private keys;
- existing `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY` remains only for legacy `aes-256-gcm-v1` rows until those rows are no longer required.

The API must reject any private-key configuration. The worker must fail closed when a referenced wrapping-key ID is absent or ciphertext unwrap fails.

A future KMS/HSM may replace this local asymmetric wrapping boundary without changing the database version-history semantics.

## Decision 7 — multi-version secret history with bounded overlap

A7 introduces `app.webhook_endpoint_secret_versions` as the canonical version history.

Each row identifies:

- endpoint ID;
- positive secret version;
- ciphertext format;
- wrapping-key ID when required;
- ciphertext;
- `usable_until` nullable timestamp;
- creation timestamp.

Unique identity is `(webhook_endpoint_id, secret_version)`.

Backfill:

- every current A4 secret becomes an `aes-256-gcm-v1` row with `usable_until = null`;
- an existing previous A4 secret becomes an `aes-256-gcm-v1` row with its existing `previous_secret_expires_at`.

On A7 rotation:

1. lock endpoint;
2. verify expected endpoint revision;
3. insert new version `current + 1` using RSA-OAEP-SHA256 ciphertext;
4. set the prior current version `usable_until = rotation_time + 24 hours`;
5. leave older version rows and their already-frozen expiry untouched;
6. move endpoint current version pointer to the new version;
7. append audit + complete idempotency in the same transaction.

The history table solves rapid-rotation correctness without making old secrets usable indefinitely. Worker claim returns the exact snapshotted version only if:

- it is the current version; or
- its `usable_until` is strictly in the future.

Otherwise the secret is unavailable and the delivery resolves terminal without HTTP, preserving A4 fail-closed behavior.

Secret-version pruning is out of scope for A7 V0.

## Decision 8 — signature-version header

Because multiple valid secret versions may coexist during rotation overlap, A7 adds a non-secret delivery header:

`X-SwiftPay-Signature-Version: <positive integer>`

It equals the delivery's immutable `signing_secret_version` and is stable across retries. This lets merchant receivers select the correct retained secret without trial-verifying an unbounded set.

The HMAC input itself remains the frozen A4 input; adding this routing header does not change signature bytes.

## Decision 9 — optimistic concurrency

A7 adds positive `revision` to `app.webhook_endpoints`, initialized to `1`.

Every successful endpoint mutation increments revision exactly once.

Item mutations require `expectedRevision`. A mismatch returns a conflict with no mutation, no new secret, no audit event and no idempotency completion as success.

This prevents two dashboard administrators from silently last-writer-wins overwriting URL/subscriptions/lifecycle/secret state.

## Decision 10 — durable idempotency for every write

Every A7 mutation requires normalized `Idempotency-Key` using the already accepted 1..160 character shape.

Operations use distinct durable operation names:

- `dashboard_webhook_endpoint_create_v0`;
- `dashboard_webhook_endpoint_update_v0`;
- `dashboard_webhook_endpoint_disable_v0`;
- `dashboard_webhook_endpoint_enable_v0`;
- `dashboard_webhook_endpoint_rotate_secret_v0`.

Canonical request hashes include only caller-controlled semantic input plus route merchant/environment/endpoint identity and expected revision. Random endpoint IDs, generated secrets, ciphertext randomness and request IDs are excluded.

Same key + same request:

- completed -> return original public response snapshot, marked replay;
- in progress -> no second mutation and no second secret disclosure;
- failed deterministic validation/conflict -> no hidden retry mutation.

Same key + different request hash -> `idempotency_conflict`.

The durable idempotency response snapshot must never contain plaintext signing secret or ciphertext.

## Decision 11 — transactional append-only audit

Each successful write creates exactly one append-only audit event inside the same database transaction as endpoint mutation and idempotency completion.

Audit actor:

- `actor_kind = user`;
- `actor_subject = verified Supabase user UUID`.

Audit action vocabulary:

- `webhook_endpoint.created`;
- `webhook_endpoint.updated`;
- `webhook_endpoint.disabled`;
- `webhook_endpoint.enabled`;
- `webhook_endpoint.secret_rotated`.

Audit metadata may contain safe booleans/version/revision/change-field names. It must not contain:

- plaintext secret;
- ciphertext;
- wrapping public/private key material;
- full endpoint URL or query string;
- Authorization header/session token.

The operation-specific SECURITY DEFINER routine calls `app.record_audit_event(...)` internally. `swiftpay_api` does not receive generic audit execution authority.

Exact idempotency replay does not append another audit event.

## Decision 12 — public/dashboard projections

Endpoint responses may expose:

- id;
- merchantId;
- environment;
- normalized URL;
- status;
- subscribedEvents;
- current secretVersion;
- revision;
- createdAt;
- updatedAt.

Only the winning create/rotate response additionally exposes:

- `signingSecret` plaintext;
- `secretAvailable: true`.

Replayed create/rotate returns:

- `signingSecret: null`;
- `secretAvailable: false`.

Never expose ciphertext, wrapping-key ID, private/public wrapping key material, historical secret ciphertexts or audit internals.

## Database capability boundary

A7 uses narrow SECURITY DEFINER routines executable only by `swiftpay_api`.

Conceptual capabilities:

- list endpoint projections;
- get one endpoint projection;
- create endpoint with already-wrapped secret;
- update URL/subscriptions;
- disable;
- enable;
- rotate to an already-wrapped new secret/version.

Every routine re-checks K4 context. Mutation routines own request idempotency + append-only audit transactionally.

Direct `SELECT/INSERT/UPDATE/DELETE` on endpoint, secret-version, idempotency or audit tables remains forbidden to `swiftpay_api`. `anon`, `authenticated` and `service_role` receive no A7 routine execution authority.

Worker capabilities remain claim/resolve only; worker receives no endpoint-management mutation authority.

## Failure semantics

- missing/invalid dashboard session -> 401;
- Supabase Auth unavailable -> 503;
- current K4 role insufficient/member disabled -> 403;
- malformed merchant/environment/endpoint/request/URL/subscription/idempotency key -> 400;
- foreign/missing endpoint -> 404 without cross-merchant disclosure;
- expected revision mismatch -> 409;
- idempotency key reused with a different request -> 409;
- same idempotent operation still in progress -> 409;
- database/internal/key-wrap infrastructure failure -> sanitized 500;
- no failure response contains token, plaintext secret, ciphertext, key material or internal SQL.

## Explicit non-objectives

A7 V0 does not include:

- webhook event/delivery list UI;
- manual test event or redelivery;
- arbitrary webhook event types;
- endpoint DELETE;
- custom per-endpoint retry policy;
- machine-token webhook administration scopes;
- provider webhook ingress;
- provider calls;
- KMS/HSM integration;
- secret-version pruning;
- dashboard login/signup UX;
- Payment/ledger/balance/payout/refund mutation;
- live merchant receiver acceptance over the public Internet in CI.

## Required TDD proof

Before implementation:

1. freeze `merchant-webhook-endpoint-management-v0.yaml`;
2. write pgTAP structural/behavior contracts and application contracts;
3. write an isolated real-database acceptance harness;
4. prove a clean RED where A1-A6 and existing DB/runtime gates remain green and A7 fails only for missing A7 behavior;
5. only then add schema/routines/application behavior;
6. after GREEN, synchronize any A7 migrations to canonical hosted Supabase `swiftpay v2` and run Security Advisor;
7. record evidence and update readiness/TODO/PR.

## Frozen Problem Analysis conclusion

A7 is safe to specify and test now. A6 removed the dashboard-principal blocker. The signing-secret custody blocker is resolved by an encrypt-only API / decrypt-only worker RSA-OAEP-SHA256 boundary with versioned key IDs, while the A4 symmetric key remains worker-only for legacy ciphertext.

The remaining work is specification and TDD, not architectural discovery. No A7 production implementation is authorized until the YAML contract is frozen and clean RED is demonstrated.
