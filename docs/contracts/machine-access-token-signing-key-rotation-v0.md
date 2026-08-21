# A15 — Machine Access-Token Signing Key Rotation — Contract V0

Status: **FROZEN / TESTS REQUIRED BEFORE IMPLEMENTATION**

Authoritative specification: `docs/specs/machine-access-token-signing-key-rotation-v0.yaml`.

## 1. Boundary

A15 changes only SwiftPay-issued A1 machine Bearer token signing/verification authority. It adds deterministic bounded HS256 key rotation without changing token claims, public token response, database revalidation, provider authority or financial behavior.

A15 does not rotate A9 cursor HMACs, A14 abuse HMACs, webhook keys, API credential secrets or provider credentials.

## 2. Configuration contract

The API runtime MUST use exactly these A15 variables:

- `SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID` — required active non-secret key ID;
- `SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS` — required JSON array containing 1..4 signing/verification entries;
- `SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY` — optional verify-only migration secret.

`SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY` is the pre-A15 single-key variable. An A15 runtime MUST NOT silently fall back to it. A configuration containing only the old variable is invalid.

### 2.1 Keyring entry

Every `SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS` entry has exactly:

```json
{"id":"key-id","secret":"secret-material"}
```

No extra or missing field is accepted.

Requirements:

- array length 1..4;
- key ID matches `^[a-z0-9][a-z0-9._-]{0,63}$`;
- each secret contains at least 32 UTF-8 bytes;
- IDs are unique;
- ring secrets are unique;
- active ID is present exactly once;
- malformed JSON, non-array representation, duplicate state or unknown fields fail closed;
- validated configuration is immutable from caller mutation;
- errors never echo secret material or the raw keyring JSON.

The optional legacy no-`kid` secret also requires at least 32 UTF-8 bytes. It may equal one ring secret because first-rollout compatibility commonly verifies pre-A15 tokens with the same secret that becomes an explicitly identified A15 key. It is never used for new issuance.

## 3. Runtime signing authority

`@swiftpay/auth` MUST export `createAccessTokenSigningAuthority`.

The factory validates and brands the A15 authority. `issueAccessToken`, `verifyAccessToken`, `authenticateAccessToken` and production token exchange MUST accept only an authority created by this factory. A structurally similar caller object is not authority.

The authority is immutable for runtime behavior: mutation of source arrays/objects after construction cannot alter active/verification key selection.

## 4. New-token issuance

New A15 tokens preserve:

- HS256 only;
- issuer `swiftpay`;
- audience `swiftpay-api`;
- exact TTL 900 seconds;
- canonical A1 identity claims and claim validation.

Their protected header is exactly:

```json
{"alg":"HS256","kid":"<active-key-id>"}
```

No additional protected-header field is emitted.

Exactly the active key signs new tokens. Verify-only keys and the legacy no-`kid` key MUST NOT be used for issuance.

The HTTP token-exchange success body remains exactly the A1 shape: access token, `Bearer`, 900-second expiry and environment. No separate HTTP `kid` field is added.

## 5. Verification and key selection

Header parsing selects candidate authority but never establishes validity by itself.

### 5.1 Token with `kid`

The protected header must contain exactly `alg` and `kid`, with `alg=HS256` and canonical A15 key ID.

- known `kid`: verify using exactly that ring key;
- unknown/malformed `kid`: reject before database revalidation;
- no fallback to active key;
- no iteration across other ring keys.

### 5.2 Pre-A15 token without `kid`

A no-`kid` protected header must be exactly `{ "alg": "HS256" }`.

- if the explicit legacy no-`kid` secret exists: verify using exactly that secret;
- if absent: reject before database revalidation;
- never try ring keys as no-`kid` fallback.

### 5.3 Other headers/algorithms

Additional protected-header fields, a non-HS256 algorithm, malformed header state or algorithm confusion are rejected.

JWT signature, issuer, audience, time and canonical claim validation stay fail-closed with zero clock tolerance.

## 6. Migration contract

Pre-A15 tokens can live for at most 900 seconds.

Zero-downtime first rollout:

1. configure the A15 active ID and bounded ring;
2. optionally set the old pre-A15 signing secret as the explicit legacy no-`kid` verifier;
3. all newly issued tokens immediately contain `kid`;
4. keep the legacy slot only until at least 900 seconds after the last pre-A15 issuance;
5. remove the legacy slot;
6. all later no-`kid` tokens fail closed.

Operators may intentionally hard-cut old tokens by omitting the legacy slot. This must be explicit; there is no implicit old-variable fallback.

## 7. A1/A8 semantics preserved

After cryptographic verification, machine Bearer authentication MUST still perform the existing PostgreSQL credential revalidation.

Credential inactivity/revocation, merchant suspension, merchant/environment mismatch or `secret_version` drift continue to invalidate tokens immediately. A15 does not let a valid signature bypass A8 rotation/revocation effects.

## 8. Failure/redaction contract

At the HTTP boundary, unknown/retired `kid`, bad signature, missing legacy authority and other token-verification failures remain indistinguishable invalid machine authentication.

No error/log/public response may expose:

- ring secret values;
- legacy secret value;
- raw keyring JSON;
- whether a legacy compatibility slot is configured.

Configuration errors may identify only the field/rule violated.

## 9. Non-authority guarantees

A15 adds:

- no Supabase migration;
- no new RPC;
- no runtime database privilege;
- no provider credential;
- no provider call;
- no A10 state change;
- no A5→A11 bridge;
- no Payment/ProviderAttempt/ledger/payout/refund/webhook/reconciliation mutation.

## 10. TDD gate

Before implementation, fail-first tests MUST prove the new A15 boundary is missing while all A1-A14 contracts remain GREEN.

Implementation is authorized only after that clean RED proof is captured in `docs/evidence/application/2026-08-18-a15-machine-access-token-signing-key-rotation-red.md`.