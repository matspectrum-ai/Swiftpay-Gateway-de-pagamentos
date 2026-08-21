# A15 — Machine Access-Token Signing Key Rotation — Problem Analysis

Date: 2026-08-18  
State: **PROBLEM_ANALYSIS**  
Implementation authority: **NONE**

## Problem

A1 machine authentication currently signs and verifies every HS256 access token with one process-wide secret from `SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY`. Canonical A1 tokens have an exact 900-second TTL and their protected header is only `{ "alg": "HS256" }`; there is no `kid` and no bounded verifier keyring.

That single-key model is deterministic and fail-closed, but it creates an operational rotation gap:

- replacing the only signing key immediately invalidates every outstanding machine token even when its A1 credential remains valid;
- retaining the old key preserves old tokens but prevents issuance under a new key;
- there is no cryptographically explicit way to select one verification key without trying multiple secrets;
- there is no bounded overlap period for zero-downtime rotation;
- the runtime configuration cannot distinguish active signing authority from verify-only retirement authority;
- pre-A15 tokens have no `kid`, so a migration must define their treatment explicitly rather than infer one.

For a payment gateway, inability to rotate a bearer-token signing authority cleanly is a production security/operations risk even though tokens are short-lived.

## Existing evidence and constraints

### A1 token contract

Current `packages/auth/src/index.ts`:

- algorithm is fixed to HS256;
- issuer is `swiftpay`;
- audience is `swiftpay-api`;
- TTL is exactly 900 seconds;
- clock tolerance is zero;
- canonical claims include merchant, credential, environment, secret version and JTI;
- bearer authentication revalidates credential status, merchant lifecycle, merchant/environment identity and secret version against PostgreSQL after JWT verification;
- wrong signing key and expiration fail closed.

Current A1 contract test freezes the protected header to exactly `{ alg: 'HS256' }`, proving that key identity is currently absent.

### Runtime/config contract

Current API bootstrap receives one `accessTokenSigningKey` string and passes one `signingKey` into the A1 token-exchange/authentication composition.

Current `@swiftpay/config` validates only one signing secret of at least 32 UTF-8 bytes. It has no active key identifier, verifier keyring or explicit no-`kid` migration slot.

### Other cryptographic authorities are intentionally different problems

A15 must not become a generic “rotate every secret” slice:

- A9 dashboard cursors use one HMAC key, but cursor rotation has short-lived pagination UX semantics rather than bearer-session continuity semantics;
- A14 abuse-subject HMAC rotation changes persistent limiter bucket identities and can temporarily reset/split quotas;
- A7 webhook RSA wrapping already has explicit key IDs and a bounded private-key ring;
- legacy A4 AES webhook-secret rows require persisted-data migration/retirement semantics, not JWT verification semantics;
- API credential secrets, provider credentials and Supabase session keys have separate owners/lifecycles.

Mixing those into one contract would reduce cohesion and make rollback/verification ambiguous.

## A15 scope

A15 is limited to the SwiftPay-issued A1 **machine access-token HS256 signing authority**.

It should provide:

1. one explicit active signing key ID;
2. one bounded validated keyring containing the active key and zero or more verify-only previous keys;
3. `kid` on every newly issued machine access token;
4. exact-key verification selected from `kid`, never trial-all-key verification;
5. one explicit optional migration slot for pre-A15 tokens that have no `kid`;
6. deterministic removal of that no-`kid` compatibility authority after the maximum 900-second token lifetime has elapsed;
7. no change to A1 claims, algorithm, issuer, audience, TTL, zero clock tolerance or database revalidation;
8. no database migration and no provider/financial authority.

## Threat model

A15 must fail closed against:

- attacker-controlled unknown `kid` values;
- missing `kid` after the explicit legacy compatibility slot is removed;
- duplicate or malformed key IDs;
- undersized secrets;
- a configured active ID absent from the keyring;
- unknown fields or malformed keyring entries;
- keyring sizes large enough to create uncontrolled operational state;
- algorithm confusion (`none`, HS384/HS512, asymmetric algorithms, etc.);
- “try every configured secret until one verifies” behavior;
- fallback from unknown `kid` to the active key;
- fallback from malformed no-`kid` token to the active key;
- secret/keyring values appearing in thrown errors, logs, token claims or public HTTP errors;
- mutation of caller-owned keyring configuration after validation;
- accidental weakening of A1 DB revalidation/revocation semantics.

## Proposed authority model

### Key IDs

Use an opaque operational identifier with a closed safe shape, recommended:

`^[a-z0-9][a-z0-9._-]{0,63}$`

The ID is not secret. It exists only to select one verification secret deterministically.

### Bounded keyring

Recommended maximum: **4** keys.

Rationale: a 900-second token lifetime normally requires only current + previous key during rotation. Four permits one active key plus bounded emergency/rollback overlap without creating an unbounded secret inventory.

Each secret retains the A1 minimum of 32 UTF-8 bytes.

The active key ID must exist exactly once in the validated ring. Every ring entry must have exact fields only.

### Protected header

Newly issued A15 tokens should carry exactly:

```json
{"alg":"HS256","kid":"<active-key-id>"}
```

No `typ`, `jku`, `jwk`, `x5u`, embedded key or algorithm agility is required.

### Verification selection

Verification should inspect only the protected header sufficiently to select authority, then perform the actual `jwtVerify` using exactly one secret and the frozen HS256/issuer/audience/time policy.

- known `kid` -> verify with exactly that key;
- unknown or malformed `kid` -> reject before DB revalidation;
- missing `kid` -> verify only with the explicit legacy-no-`kid` secret when that slot is configured;
- missing `kid` with no legacy slot -> reject;
- never iterate the ring looking for a signature match.

Untrusted header parsing must not create authority by itself.

## Pre-A15 migration problem

Tokens issued before A15 contain no `kid` and may remain valid for at most 900 seconds.

A zero-downtime first rollout therefore needs an explicit compatibility window. Recommended model:

- configure the new active key ID + bounded keyring for all new issuance;
- optionally configure exactly one `legacyNoKidKey` containing the pre-A15 signing secret;
- new tokens immediately receive `kid` and are not dependent on the legacy slot;
- no-`kid` tokens can be verified only by the explicit legacy key;
- after at least 900 seconds from the last pre-A15 issuance, remove the legacy slot;
- subsequent no-`kid` tokens fail closed.

This is intentionally one key, not a no-`kid` keyring. It prevents ambiguous trial verification and gives operations a finite retirement step.

A hard-cut rotation that invalidates all outstanding tokens remains possible operationally by omitting the legacy slot, but it must be deliberate rather than accidental.

## Proposed configuration boundary

The spec should freeze exact names and representation, but the recommended model is:

- active key ID: one required non-secret string;
- signing/verification keyring: one required bounded JSON representation containing key IDs and secrets, including the active key;
- optional legacy no-`kid` secret: one explicit migration-only secret.

The existing single `SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY` contract should not silently become a multi-key fallback. Any backward-compatibility environment variable behavior must be explicit in the A15 spec and tests.

## Public/application compatibility

A15 changes the canonical protected header but should not change the public token endpoint response shape:

- `accessToken`
- `tokenType: Bearer`
- `expiresIn: 900`
- `environment`

No `kid` needs to be separately exposed in the JSON response because it is already present in the JWT protected header.

A15 must preserve immediate invalidation by A8 credential rotation/revocation because PostgreSQL bearer revalidation still occurs after cryptographic verification.

## Failure semantics

JWT/key-selection failures remain ordinary invalid machine credentials at the HTTP boundary. They must not reveal whether:

- a key ID is unknown;
- the signature is wrong;
- a legacy no-`kid` slot exists;
- a previous key has been retired.

Configuration errors may name the invalid configuration field/rule but must never echo key material.

## No database or provider changes

A15 requires no Supabase migration and no new RPC authority.

It must not:

- call a PSP;
- change A10 provider activation state;
- wire A5 adapters to A11;
- modify Payment, ProviderAttempt, ledger, payout/refund, webhook or reconciliation state;
- change API/worker database privileges.

## Acceptance criteria for moving from Problem Analysis to Specification

The A15 YAML spec may be frozen only if it explicitly defines:

1. exact config variable names/JSON shape;
2. exact key-ID grammar and keyring maximum;
3. active-key membership and duplicate/unknown-field handling;
4. exact new protected header;
5. exact known/unknown/missing-`kid` verification behavior;
6. exact legacy no-`kid` migration behavior;
7. no trial-all-key behavior;
8. unchanged HS256/issuer/audience/900s/zero-tolerance/claims semantics;
9. unchanged A1 DB revalidation and A8 revocation behavior;
10. redaction-safe configuration/JWT failure behavior;
11. no database/provider/financial authority;
12. fail-first tests that prove A15 is missing while A1-A14 remain GREEN.

## Current decision

Proceed with A15 as a **narrow machine access-token signing-key rotation slice**. Do not include A9 cursor HMAC, A14 abuse HMAC, A7/A4 webhook crypto or provider credentials in this slice.

Next permitted step: freeze `docs/specs/machine-access-token-signing-key-rotation-v0.yaml`. No implementation is authorized yet.