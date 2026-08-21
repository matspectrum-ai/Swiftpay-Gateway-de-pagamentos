# Legacy API Credentials and Internal Authentication

Status: core audit complete; V2 contract required before implementation

Date: 2026-08-13
Legacy revision: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Merchant API credentials

### Secret generation and storage

Legacy credential generation uses `RandomNumberGenerator`:

- client id: `pk_{environment}_...` with 24 random bytes encoded as hex;
- client secret: `sk_{environment}_...` with 32 random bytes encoded as hex;
- only SHA-256 of the generated high-entropy secret is stored in `ClientSecretHash`;
- plaintext secret is returned by create/regenerate responses;
- normal credential list responses contain the client id but not the secret.

This one-time-secret pattern is worth preserving. V2 should use a constant-time verifier for the derived/hash comparison and never persist plaintext merchant API secrets.

### Revocation and token invalidation

`MerchantApiCredential` contains `Status` and `SecretVersion`.

The public payment API revalidates credential state/version after JWT authentication, so a revoked credential is rejected on subsequent requests and regenerating a credential increments `SecretVersion`, invalidating JWTs issued under the previous secret version.

This behavior is worth preserving.

### IP allow-list semantics

The management model calls the field `AllowedIpRange`, but creation validates only a string length. The public token flow treats it as comma-separated exact IP strings (or `*`), not as a real CIDR/range model.

V2 must either:

- support validated IP/CIDR allow lists explicitly; or
- name the feature according to its actual semantics.

Do not carry the misleading `Range` contract unchanged.

## Conflicting credential-management paths

The legacy API contains both direct and step-up flows.

Direct paths include:

- `POST /v1/merchant/{merchantId}/api-credentials` — creates and returns a secret immediately;
- `DELETE /v1/merchant/{merchantId}/api-credentials/{credentialId}` — revokes immediately.

Separate request/confirm paths also exist for create, regenerate and delete, using a six-digit email code.

The current frontend server actions call the direct create/delete endpoints. They also reference a direct `/regenerate` path even though the audited backend exposes request/confirm regeneration rather than a matching direct regenerate endpoint.

Result: the codebase contains two incompatible security policies and the stronger email-confirmation policy is not the sole management boundary. V2 must expose one canonical policy only.

## Email challenge model

`ApiCredentialCode` stores:

- merchant/user/credential association;
- action (`Create`, `Regenerate`, `Delete`);
- SHA-256 code hash;
- status;
- expiration;
- requested credential snapshots.

A new request expires older pending codes of the same action/context. Codes expire after 10 minutes.

Positive properties:

- plaintext code is not persisted;
- request is bound to merchant/user/action and, when applicable, credential;
- expired/replaced/used states are explicit.

### Brute-force weakness

The confirmation code is six numeric digits. No attempt counter, failed-attempt state or per-challenge lockout exists on `ApiCredentialCode`.

The management API has a global production/staging sliding-window limit of 600 requests/minute per partition, but the credential confirmation endpoints do not have a dedicated low limit in the audited code.

Therefore the global limiter is not a sufficient replacement for challenge-specific brute-force control.

### Concurrent-consumption weakness

Confirmation performs a read of a `Pending` code, then mutates it to `Used` and saves changes. `PrimaryDbContext` defines ordinary indexes on code hash and merchant id, but no unique pending-code/CAS constraint or concurrency token was observed for `ApiCredentialCode`.

Two concurrent confirmations can therefore both plausibly read the same code as pending before either commit. For create this can create two credentials; for regeneration it can rotate the same credential more than once, causing one returned secret to be invalidated immediately by the competing confirmation.

V2 must consume any step-up challenge atomically, e.g. a transaction/SQL function or conditional `UPDATE ... WHERE status = pending AND expires_at > now RETURNING ...`.

## Credential count and rotation UX

No active-credential count restriction was observed in the audited create paths.

Multiple credentials can be useful for safe integration migration, so V2 should not force a single merchant secret. The product contract should define explicit limits and a zero-downtime rotation workflow rather than accidental unlimited credentials.

A credential should have a stable public identity. Rotating a secret should not require changing the public client identifier unless there is a specific security reason. Immediate old-token invalidation remains desirable after the old secret is retired.

## Internal API authentication

The payment application contains two implementations:

1. `InternalApiKeyPreProcessor`;
2. `InternalApiKeyMiddleware`.

Both use `X-Internal-Api-Key` and `PlatformSettings:InternalApiKey`.

### Effective protection

Search for `UseInternalApiKey` found only the middleware extension definition, not an installation in the payment pipeline. The middleware therefore appears unused at the audited revision.

The seven non-provider internal groups found in the endpoint-group layer explicitly attach `InternalApiKeyPreProcessor`:

- transactions;
- cashouts;
- acquirers;
- orders;
- submerchants;
- payment links;
- platform payouts.

Thus there is no evidence from these groups that ordinary internal endpoints are unauthenticated: `AllowAnonymous()` bypasses normal user auth, but the group preprocessor checks the internal key.

Provider webhook groups are a separate trust boundary and use provider webhook authentication rules; the previously recorded AkkadPag exception remains a provider-webhook issue rather than an internal-service-key issue.

### Structural weaknesses

The internal service model still has undesirable properties:

- one global shared secret represents every internal caller;
- no caller/service identity or scopes;
- no key version/rotation metadata in the auth protocol;
- comparison uses ordinary ordinal string equality rather than a constant-time primitive;
- protection is opt-in on every internal group, so a future group can forget the preprocessor;
- duplicate middleware/preprocessor implementations create ambiguity about the real security boundary.

## V2 requirements

### Merchant API credentials

1. Generate secrets from a CSPRNG and store no plaintext secret.
2. Reveal a newly generated secret only at creation/rotation.
3. Keep credential revocation and secret-version invalidation immediate.
4. Use one canonical management workflow; no direct endpoint may bypass required step-up controls.
5. For sensitive credential operations, use recent re-authentication/MFA/OTP according to the final Supabase Auth design.
6. If OTP/challenges are used, rate-limit both issuance and verification, track failed attempts and lock/expire after a small bounded count.
7. Consume a challenge atomically and exactly once.
8. Validate actual IP/CIDR allow lists with explicit semantics.
9. Define a bounded number of active credentials and a deliberate zero-downtime rotation story.
10. Audit every create/rotate/revoke event with actor, credential id, time and request context without logging secrets.

### Internal application boundaries

1. Prefer eliminating internal HTTP calls when modules live in the same V2 process/database boundary.
2. Do not recreate a single global `InternalApiKey` unless an external service boundary actually exists.
3. If a separate worker/service requires authenticated HTTP, give each workload its own rotatable identity/secret and least-privilege scope.
4. Make internal-route authentication fail closed by default rather than requiring each new group to remember a preprocessor.
5. Use constant-time secret verification.
6. Keep provider webhooks on a distinct provider-authentication boundary.

## V2 simplification implication

The new architecture can remove most legacy internal-API authentication complexity by keeping Payment, Ledger, Wallet and orchestration modules inside the same modular monolith and using the database/outbox for worker handoff.

That is both simpler and safer than rebuilding a large `/v1/internal/*` surface protected by one shared global key.