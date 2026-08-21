# A16 — Dashboard Transaction Cursor HMAC Rotation Contract V0

Status: **FROZEN**

This contract supersedes only the A9 single-key cursor-integrity configuration and token format for newly issued cursors. All other A9 behavior remains authoritative.

## 1. Configuration authority

The API runtime MUST use:

- `SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID`;
- `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS`;
- optional `SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY`.

The former `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY` MUST NOT provide implicit fallback authority.

The current keyring MUST contain 1..4 entries. Each entry MUST have exactly `id` and `secret` fields. IDs MUST match `^[a-z0-9][a-z0-9._-]{0,63}$`, be unique, and identify non-secret operational key IDs. Current keyring secrets MUST be unique and at least 32 UTF-8 bytes.

The active key ID MUST match exactly one current keyring entry. Configuration MUST fail closed otherwise.

The optional legacy-v0 secret is verify-only and MUST be at least 32 UTF-8 bytes. It MUST never be used for new cursor issuance.

## 2. Runtime snapshot

`createDashboardTransactionCursorCodec` MUST runtime-validate and snapshot the supplied authority. Mutating the caller's input array or entry objects after construction MUST NOT change issuance or verification behavior.

Malformed configuration MUST throw before cursor use.

## 3. New cursor issuance

Every newly issued cursor MUST use exactly:

`a9v1.<kid>.<payload>.<signature>`

where:

- `<kid>` is the active key ID;
- `<payload>` is canonical base64url-no-padding of the existing A9 JSON tuple `[merchantId, environment, filterDigest, createdAt, paymentId]`;
- `<signature>` is canonical base64url-no-padding HMAC-SHA256 over the ASCII string `a9v1.<kid>.<payload>`;
- only the active key may sign new cursors.

The `kid` is not secret, but it MUST be authenticated because it is part of the HMAC input.

A16 MUST NOT add issued-at, expiry, user ID, provider identity, money or other data to the cursor payload.

## 4. V1 verification

An `a9v1` cursor MUST contain exactly four segments.

Verification MUST:

1. validate token/version/`kid`/canonical base64url structure;
2. look up exactly one configured key by `kid`;
3. fail closed if the key ID is unknown, malformed or retired;
4. calculate exactly one HMAC with the selected key;
5. compare the 32-byte signature using constant-time comparison;
6. parse and validate the existing A9 payload tuple;
7. enforce exact merchant/environment/filter binding.

Trial-all-key verification is forbidden.

## 5. Legacy A9 V0 verification

An existing `a9v0.<payload>.<signature>` cursor MAY verify only when the explicit legacy-v0 key is configured.

Legacy verification MUST use only that one legacy key and the original HMAC input `a9v0.<payload>`.

The legacy key MUST NOT sign new cursors.

When the legacy-v0 slot is removed, every remaining `a9v0` cursor MUST fail as `invalid_cursor`.

There is no implicit fallback from an `a9v0` token to the current v1 keyring.

## 6. Rotation and retirement

A normal v1 rotation is:

1. add the next key while retaining the previous key;
2. set the next key as active;
3. new cursors use the next `kid`;
4. old v1 cursors continue to verify through their exact old `kid` while that key remains;
5. removing the retired key invalidates cursors carrying that `kid`.

This is deliberate cursor invalidation and MUST surface through the existing generic invalid-cursor contract.

## 7. Failure surface

All cursor-integrity failures MUST remain externally indistinguishable:

- field: `cursor`;
- code: `invalid_cursor`;
- message: `Invalid transaction cursor.`

This includes malformed/unknown versions, malformed/unknown/retired key IDs, missing legacy authority, malformed payload/signature, signature failure, and route/filter binding mismatch.

No key ID lookup error may reveal whether a particular retired secret existed historically. No secret material may be echoed.

## 8. Preserved A9 behavior

A16 MUST preserve:

- transaction list/detail route namespace;
- ordinary dashboard member authorization;
- keyset ordering and limit+1 behavior;
- exact filter normalization/digest semantics;
- merchant/environment isolation;
- transaction projection/privacy rules;
- database RPC usage;
- HTTP error mapping and no-store caching.

A16 adds no mutation endpoint.

## 9. Explicit exclusions

A16 MUST NOT modify:

- PostgreSQL schema, migrations or RPC grants;
- Supabase hosted state;
- A14 abuse HMAC authority;
- A15 Bearer signing keyring;
- webhook delivery/endpoint cryptographic authorities;
- API credential secrets;
- provider credentials, A10 registry or A11 transport;
- provider/network/financial authority.

## 10. TDD acceptance gate

Implementation is authorized only after fail-first tests demonstrate that the pre-A16 baseline remains GREEN and failures are restricted to the frozen A16 authority/token/configuration changes.

Final acceptance requires application contracts, real-database runtime acceptance, K5, K6 and pgTAP to remain GREEN.