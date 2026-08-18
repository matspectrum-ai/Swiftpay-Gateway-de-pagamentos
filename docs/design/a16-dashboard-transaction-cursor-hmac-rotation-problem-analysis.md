# A16 — Dashboard Transaction Cursor HMAC Rotation — Problem Analysis

Status: **PROBLEM_ANALYSIS / NO IMPLEMENTATION AUTHORITY**

Date: 2026-08-18

## Problem

A9 authenticates dashboard transaction pagination cursors with a dedicated HMAC-SHA256 integrity key. The current accepted runtime contract uses one `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY` and emits `a9v0.<payload>.<signature>` tokens with no key identifier.

That design correctly isolates cursor integrity from access-token signing, but it has no safe overlapping-key rotation mechanism. Replacing the single key immediately invalidates every outstanding cursor, while retaining the old key indefinitely prevents deliberate retirement.

A15 solved a similar lifecycle problem for machine Bearer signing, but A9 cursors have materially different semantics:

- cursors are opaque integrity tokens, not JWTs;
- they have no intrinsic expiration timestamp;
- they are bound to merchant/environment/filter state rather than an authenticated principal claim set;
- cursor invalidation is safe and maps to the existing `invalid_cursor` validation result;
- cursor rotation must not alter database reads, pagination ordering, tenant authorization or transaction projections.

A16 therefore must be a separate application-only slice.

## Current evidence in the repository

`packages/payments/src/a9.ts` currently:

- accepts exactly one cursor HMAC key;
- requires at least 32 UTF-8 bytes;
- emits `a9v0.<payload>.<signature>`;
- signs version + payload with HMAC-SHA256;
- binds the payload to merchant ID, environment, normalized filter digest, createdAt and paymentId;
- uses constant-time comparison;
- returns the existing generic `invalid_cursor` violation for malformed/tampered/scope-mismatched tokens.

`packages/config/src/index.ts` currently requires `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY` as one string.

`apps/api/src/runtime.ts` passes that single key directly to `createDashboardTransactionCursorCodec`.

No database state, Supabase RPC or provider authority depends on the cursor key.

## Security/operational risks

### R1 — emergency rotation causes total cursor invalidation

A compromised or suspected key cannot be replaced while preserving an overlap window for already-issued cursors.

### R2 — naive multi-key verification creates ambiguous authority

Trying every configured HMAC key for every token obscures which key authorized the cursor and makes retirement/error behavior less deterministic.

### R3 — implicit fallback preserves obsolete secrets indefinitely

Keeping the old single-key environment variable as an automatic fallback would make key retirement non-obvious and could silently extend compromise exposure.

### R4 — changing cursor format can weaken scope binding

Rotation must not remove merchant/environment/filter binding or change the canonical pagination payload.

### R5 — mixing A9 and A14 rotation would couple unrelated failure domains

A14 abuse-HMAC rotation changes persisted rate-limit subject identity and bucket continuity. A9 cursor rotation only changes verification of opaque client-held pagination tokens. They must not share lifecycle/configuration authority.

## A16 boundary

A16 will change only dashboard transaction cursor cryptographic key selection and configuration.

It will not change:

- dashboard authentication/authorization;
- A9 filters, pagination ordering or store RPCs;
- transaction list/detail projections;
- database schema or Supabase privileges;
- A14 abuse HMAC;
- A15 access-token signing authority;
- webhook signing/wrapping/encryption keys;
- PSP credentials, A10 state or A11 transport;
- HTTP routes/status/error vocabulary other than accepting the new cursor token format under the existing `invalid_cursor` contract.

## Decisions to freeze in the spec

1. New cursor format is `a9v1.<kid>.<payload>.<signature>`.
2. `kid` is a non-secret bounded identifier and is authenticated as part of the HMAC input.
3. Runtime configuration contains exactly one active key ID and a bounded keyring of 1..4 unique `{id, secret}` entries.
4. Every key secret is at least 32 UTF-8 bytes; IDs and secrets are unique.
5. The active key ID must identify exactly one configured key.
6. New cursor issuance uses only the active key.
7. `a9v1` verification selects exactly one key by `kid`; unknown/malformed `kid` fails closed. No trial-all verification.
8. Existing `a9v0` cursors may be accepted only when an explicit verify-only legacy-v0 key is configured.
9. The legacy-v0 key is never used for new issuance and is not part of the current keyring.
10. Removing the legacy-v0 key immediately invalidates all remaining `a9v0` tokens through the existing `invalid_cursor` result.
11. Removing a non-active v1 key from the keyring immediately invalidates v1 tokens carrying that `kid`.
12. The old `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEY` variable has no implicit fallback authority after A16.
13. Payload semantics remain exactly merchant + environment + filter digest + createdAt + paymentId.
14. HMAC remains SHA-256 with constant-time signature comparison.
15. All malformed, unknown-key, tampered, scope-mismatched and filter-mismatched cursor failures remain externally indistinguishable as `invalid_cursor`.
16. A16 introduces no DB/network/financial/provider side effects.

## Proposed runtime configuration names

- `SWIFTPAY_DASHBOARD_CURSOR_ACTIVE_KEY_ID`
- `SWIFTPAY_DASHBOARD_CURSOR_HMAC_KEYS`
- `SWIFTPAY_DASHBOARD_CURSOR_LEGACY_V0_KEY` — optional, verify-only migration slot

The keyring representation should mirror A15's explicit JSON-entry pattern for operational consistency, while remaining a separate authority and type.

## TDD gate

Before implementation, fail-first tests must prove at minimum:

- frozen exports/config names;
- keyring validation and immutability;
- active-only issuance;
- v1 `kid` authentication/selection;
- unknown `kid` fail-closed with no trial-all behavior;
- overlap rotation with old non-active v1 key;
- retirement behavior;
- explicit legacy-v0 verification and removal behavior;
- no old single-key fallback;
- unchanged merchant/environment/filter binding;
- unchanged A9 read-service/store/public error behavior;
- zero database/provider authority changes.

No implementation is authorized until the full pre-A16 application/runtime/database baseline is GREEN and only A16 expectations are RED.