# A17 — Legacy Webhook AES Secret Retirement — Problem Analysis

Date: 2026-08-18

Status: **FROZEN PROBLEM ANALYSIS**  
Implementation authority: **NONE**

## 1. Problem statement

SwiftPay A7 made RSA-OAEP-SHA256 wrapping with an explicit wrapping-key ID the authoritative mechanism for newly created and rotated merchant webhook signing secrets. The current A7 database command accepts only `rsa-oaep-sha256-v1` for new endpoint secret material.

However, A4/A7 still carry a pre-A7 compatibility path for `aes-256-gcm-v1` webhook signing-secret ciphertext:

- worker configuration still requires `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY`;
- `packages/webhooks/src/legacy.ts` still exposes AES-256-GCM secret decryption;
- `packages/webhooks/src/a7-delivery.ts` still branches between legacy AES decryption and RSA unwrap;
- `app.webhook_endpoint_secret_versions.ciphertext_format` still permits both `aes-256-gcm-v1` and `rsa-oaep-sha256-v1`;
- the A7 foundation migration classified any pre-A7 endpoint secret rows as `aes-256-gcm-v1` for migration compatibility.

This leaves an independent long-lived symmetric cryptographic authority in the production worker even though all authoritative post-A7 secret issuance is RSA-wrapped.

Before production launch, SwiftPay should determine whether that legacy compatibility is still required. If it is not required, retaining it increases secret-management surface, deployment complexity and the chance of an accidental future AES legacy dependency without providing current product value.

## 2. Current executable and hosted evidence

Repository evidence:

1. `packages/config/src/core.ts`
   - defines `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY`;
   - requires it for worker configuration;
   - validates it as one exact 32-byte base64url-no-padding AES key.
2. `apps/worker/src/index.ts` and `apps/worker/src/runtime.ts`
   - pass the single legacy AES key into every configured webhook delivery service;
   - pass the RSA private-key keyring separately when configured.
3. `packages/webhooks/src/legacy.ts`
   - decrypts only `aes-256-gcm-v1` with the single AES key and endpoint/version-bound AAD.
4. `packages/webhooks/src/a7-delivery.ts`
   - treats missing ciphertext format as legacy AES for backwards compatibility;
   - decrypts `aes-256-gcm-v1` through the symmetric key;
   - unwraps `rsa-oaep-sha256-v1` through the explicit `wrappingKeyId` and private keyring.
5. `20260816073330_webhook_endpoint_management_foundation.sql`
   - permits both ciphertext formats in `app.webhook_endpoint_secret_versions`;
   - migrates any pre-A7 endpoint current/previous secrets into version history as `aes-256-gcm-v1`.
6. `20260816073500_webhook_endpoint_management_behavior.sql`
   - current `app.create_dashboard_webhook_endpoint(...)` accepts only `rsa-oaep-sha256-v1` plus an explicit wrapping key ID;
   - current claim semantics return the stored format/key ID for the exact snapshotted secret version.

Canonical hosted Supabase evidence, read on 2026-08-18 from project `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`):

- `app.webhook_endpoints`: **0 rows**;
- `app.webhook_endpoint_secret_versions`: **0 rows**;
- `aes-256-gcm-v1` secret versions: **0**;
- `rsa-oaep-sha256-v1` secret versions: **0**.

Therefore no hosted merchant webhook secret requires legacy AES decryption today.

## 3. Why this is a pre-launch hardening opportunity

The legacy AES path is currently compatibility-only, not authoritative issuance behavior. Because the canonical hosted database has no webhook endpoints or secret versions, SwiftPay can potentially remove the compatibility before any real merchant data depends on it.

Doing this after launch would be more expensive because a safe retirement would first need to prove or migrate every persisted AES secret version, coordinate rolling worker deployments and preserve delivery retry semantics during the transition.

Doing it now can simplify the production cryptographic contract to one mechanism for persisted merchant webhook signing secrets: RSA-OAEP-SHA256 wrapping with explicit key IDs and a bounded worker private-key keyring.

## 4. A17 goals

A17 should, if subsequent spec/contract evidence confirms the boundary:

1. eliminate the runtime requirement for `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY`;
2. eliminate executable AES webhook-secret decryption from the authoritative delivery path;
3. make RSA-OAEP-SHA256 + explicit wrapping key ID the only accepted persisted webhook-secret ciphertext format after the A17 migration;
4. require a valid non-empty worker private-key keyring whenever webhook delivery runtime is configured;
5. preserve exact A7 wrapping-key rotation semantics: old RSA private keys may remain verify/decrypt-only for versions wrapped under those IDs while new API issuance uses the configured current wrapping public key;
6. preserve A4/A7 delivery fencing, immutable endpoint URL and secret-version snapshots, retry classification, HMAC request signing and terminal behavior;
7. fail closed if any database targeted by the A17 schema migration still contains legacy AES secret versions rather than silently deleting, rewriting or pretending to migrate ciphertext without plaintext authority;
8. retain zero provider/financial authority and introduce no live PSP behavior.

## 5. Explicit non-goals

A17 is not authority to:

- rotate merchant webhook HMAC signing secrets themselves; A7 already owns merchant-triggered secret rotation;
- redesign the public merchant webhook signature protocol;
- change webhook replay/timestamp semantics;
- change endpoint URL SSRF policy or HTTP transport behavior;
- change webhook retry/backoff/fencing semantics;
- add provider webhook ingress;
- rotate A14 abuse HMAC authority;
- change A15 machine access-token signing authority;
- change A16 dashboard cursor HMAC authority;
- change provider credentials or activate A5/A11 provider traffic;
- synthesize or decrypt historical AES secret material for migration;
- perform any live PSP call.

## 6. Proposed post-A17 authority model to freeze later

The specification should evaluate and freeze a model with these properties:

### API issuance side

- `SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID` remains the explicit current wrapping key ID.
- `SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY` remains the current RSA public wrapping authority.
- every newly created/rotated webhook signing-secret version is stored as `rsa-oaep-sha256-v1` with that explicit key ID.

### Worker decryption side

- `SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS` becomes the sole persisted-secret decryption authority;
- the keyring remains bounded and keyed by explicit wrapping key ID;
- each claim is decrypted only with the exact private key named by its persisted `wrapping_key_id`;
- unknown/missing key IDs fail closed as configuration/secret unavailable;
- no trial-all private-key behavior is introduced;
- retaining an old private key permits bounded overlap for old RSA-wrapped secret versions; removing it deliberately retires those versions once no usable delivery can reference them.

### Database side

- post-A17 `app.webhook_endpoint_secret_versions.ciphertext_format` permits only `rsa-oaep-sha256-v1`;
- `wrapping_key_id` is mandatory for every row;
- migration must fail if legacy AES rows exist;
- no automatic ciphertext conversion is attempted.

## 7. TDD and migration requirements

Before implementation, A17 requires:

1. YAML specification;
2. explicit application/database contracts;
3. fail-first tests proving the legacy AES authority is still present before implementation;
4. database RED proving the schema still permits/inserts AES secret-version rows before the A17 migration;
5. application RED proving worker configuration/runtime still depends on the AES key and delivery still accepts AES ciphertext;
6. GREEN proof that all pre-A17 non-legacy webhook behavior remains intact;
7. local full migration replay from zero;
8. K5/K6 and full pgTAP regression;
9. K7/A1/A2/A3/A4/A6/A7/A8/A9/A14 real-database runtime regression acceptance;
10. hosted pre-migration assertion that AES secret-version count is still zero immediately before applying any migration;
11. hosted post-migration schema/privilege/advisor verification;
12. explicit zero Payment/ProviderAttempt/live-PSP side-effect evidence.

## 8. Migration safety rule

The migration must not infer that AES ciphertext can be converted to RSA ciphertext. Ciphertext alone is insufficient to perform a legitimate re-wrap without the old decryption authority and plaintext secret.

Therefore the safe migration rule is:

- if legacy AES rows exist: **abort and require a separately reviewed data-migration plan**;
- if legacy AES rows do not exist: narrow the schema/runtime contract and remove the obsolete authority.

The current canonical hosted state satisfies the second case, but that must be rechecked immediately before any hosted migration is applied.

## 9. Risks to test explicitly

- worker starts without a private keyring even though all current secrets are RSA-wrapped;
- a claim with a missing/unknown wrapping key ID falls through to another key;
- old RSA key removal unexpectedly affects versions wrapped under a different key ID;
- database still accepts `aes-256-gcm-v1` after A17;
- legacy format inference remains through a missing/null ciphertext format;
- historical A4 fixtures accidentally preserve production AES authority through test-only helpers;
- API current wrap key and worker private keyring become inconsistent without a detectable deployment failure boundary;
- cleanup weakens delivery fencing, retry or HMAC signing behavior;
- migration changes grants/RLS/runtime capabilities unintentionally;
- removal of the AES config field changes unrelated worker startup/config ordering unexpectedly.

## 10. Open questions for the specification phase

The A17 spec must resolve, from repository behavior and tests rather than assumption:

1. whether worker startup should require a non-empty private keyring unconditionally or only when webhook delivery is enabled/configured;
2. whether deployment acceptance should prove that the API current wrapping key ID is present in the worker private keyring using a shared CI/deployment fixture;
3. which historical A4/A7 tests should be preserved as explicit legacy-history evidence versus migrated to RSA-only production behavior;
4. whether the old AES helpers remain exported only for historical fixture decoding/tests or are removed entirely from production package exports;
5. whether any legacy `webhook_endpoints.secret_ciphertext` columns/constraints can be narrowed in the same migration without expanding A17 beyond the minimum safe slice.

## 11. Exit criteria for Problem Analysis

Problem Analysis is complete when the repository records that:

- current authoritative A7 issuance is RSA-only;
- the worker/schema still retain AES compatibility;
- canonical hosted state has zero endpoint/secret-version rows and therefore zero legacy AES data;
- silent AES-to-RSA conversion is forbidden;
- the next allowed artifact is an A17 YAML specification that resolves the open questions above.

No implementation, migration or production configuration change is authorized by this document.