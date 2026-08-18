# A17 — Legacy Webhook AES Secret Retirement Contract V0

Status: **FROZEN**  
Implementation authority: **NONE until CLEAN RED is recorded**

Problem Analysis: `docs/design/a17-legacy-webhook-aes-secret-retirement-problem-analysis.md`  
Specification: `docs/specs/legacy-webhook-aes-secret-retirement-v0.yaml`

## 1. Contract purpose

A17 removes the pre-A7 AES-256-GCM compatibility authority for persisted merchant webhook signing secrets before production launch. After A17, persisted merchant webhook signing secrets have one production cryptographic envelope only: `rsa-oaep-sha256-v1` with an explicit wrapping-key ID and exact-key worker unwrap.

A17 changes no merchant webhook HTTP signature protocol, retry/fencing behavior, Payment state, provider state or retained-PSP authority.

## 2. Worker configuration contract

### Removed authority

The worker production configuration MUST NOT define, read, require, validate, echo or pass through:

- `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY`;
- `webhookEncryptionKey`.

The removed variable MUST NOT be accepted as a fallback for any RSA wrapping or delivery behavior.

### Required RSA unwrap authority

Worker configuration MUST require `SWIFTPAY_WEBHOOK_SECRET_WRAP_PRIVATE_KEYS`.

The value MUST be parsed through the existing explicit private-keyring validation boundary and MUST satisfy:

- object/keyring cardinality: 1 through 16 entries;
- every key ID matches `^[a-z0-9][a-z0-9._-]{0,63}$`;
- every entry is a base64url-no-padding PKCS#8 RSA private key;
- RSA modulus length is 2048 through 4096 bits;
- empty, malformed, weak, non-RSA or oversized authority fails before the worker enters its job loop;
- errors do not contain key material.

The validated worker configuration MUST expose a private-keyring value to runtime composition. It MUST NOT expose a legacy AES key.

## 3. API wrapping authority contract

A17 MUST preserve the A7 API-side wrapping contract:

- `SWIFTPAY_WEBHOOK_SECRET_WRAP_KEY_ID` identifies the current wrapping key;
- `SWIFTPAY_WEBHOOK_SECRET_WRAP_PUBLIC_KEY` is the corresponding current RSA public key;
- creation and secret rotation generate a fresh `whsec_` secret and persist only an RSA-OAEP-SHA256 ciphertext plus the explicit current key ID;
- replayed idempotent management commands never re-disclose plaintext secret material.

A17 does not change A7 role authorization, AAL/session semantics, endpoint policy, command idempotency or audit behavior.

## 4. Cross-workload deployment invariant

CI/deployment acceptance MUST prove that the exact API current wrapping key ID is present in the worker private-key keyring fixture used for the same deployment acceptance.

This is a deployment invariant only. API and worker runtime loaders remain independently scoped; no private key is loaded into the API and no public wrapping key is required by the worker solely to satisfy this invariant.

If the current API key ID has no exact worker private-key match, deployment acceptance MUST fail closed.

## 5. Webhook delivery service contract

The production delivery service constructor/runtime options MUST require RSA private-keyring authority and MUST NOT accept a legacy `encryptionKey` option.

For each claimed delivery:

1. `endpoint.signingSecretCiphertext` MUST be non-empty;
2. `endpoint.signingSecretCiphertextFormat` MUST equal exactly `rsa-oaep-sha256-v1`;
3. `endpoint.signingSecretWrappingKeyId` MUST be a valid explicit key ID;
4. the service selects exactly the private key named by that key ID;
5. the service unwraps the secret using the existing A7 OAEP label bound to endpoint ID, secret version and wrapping key ID;
6. it performs no trial-all-key loop and no fallback to another key;
7. only after successful unwrap may endpoint policy and HTTP transport proceed.

### Failure behavior

Before any network call:

- missing ciphertext or missing exact key authority -> terminal `configuration` outcome using the existing safe `signing_secret_unavailable` family;
- malformed/unsupported format, invalid key ID shape, malformed RSA ciphertext or decrypt failure -> terminal `configuration` outcome using the existing safe `signing_secret_invalid` family;
- `aes-256-gcm-v1` -> terminal configuration failure;
- missing ciphertext format -> terminal configuration failure; missing format MUST NOT imply AES.

No failure object/log may contain plaintext secret, private key, ciphertext, OAEP label or raw database error content.

## 6. Delivery behavior preserved exactly

A17 MUST preserve:

- exact durable `signing_secret_version` snapshot;
- exact durable `endpoint_url_snapshot`;
- request method/body canonicalization;
- `x-swiftpay-event`;
- `x-swiftpay-delivery`;
- `x-swiftpay-timestamp`;
- HMAC-SHA256 `x-swiftpay-signature` shape and verification semantics;
- `x-swiftpay-signature-version` equal to the snapshotted secret version;
- endpoint SSRF/DNS/redirect policy;
- one transport send per claimed attempt;
- retry/terminal classification;
- shared Job/WebhookDelivery lease fencing;
- disabled-endpoint local terminalization;
- financial side-effect isolation.

## 7. RSA wrapping-key rotation contract

RSA wrapping-key rotation remains explicit by persisted key ID:

- new secret versions are wrapped only with the current API wrapping key ID;
- worker may retain old private keys to decrypt still-usable older RSA-wrapped versions;
- an older key is selected only when the persisted version names that exact key ID;
- removing an old private key immediately makes versions under that ID unavailable to the worker;
- removing one key MUST NOT affect versions naming a different retained key;
- trial-all private-key verification/decryption is forbidden.

Operational retirement of an old private key must occur only after no still-usable delivery can reference versions wrapped under that ID. A17 does not itself add a key-retirement scheduler.

## 8. Production package export contract

After A17, production code in `@swiftpay/webhooks` MUST NOT export or retain an executable persisted-secret AES decryption authority, including:

- `decodeWebhookEncryptionKey`;
- `decryptWebhookSigningSecret`.

Tests may locally construct AES-shaped historical ciphertext solely to prove the A17 schema/runtime rejects it. Such helpers MUST remain in test code and MUST NOT be exported by production packages.

The merchant webhook request-signing primitives themselves remain HMAC-based and are not removed; A17 retires only AES encryption-at-rest compatibility for the signing secret.

## 9. Database contract

A17 adds one forward migration that narrows `app.webhook_endpoint_secret_versions`.

### Mandatory precondition

Before changing constraints, the migration MUST determine whether any row has:

`ciphertext_format = 'aes-256-gcm-v1'`.

If the count is non-zero, the migration MUST abort. It MUST NOT:

- delete those rows;
- null them;
- mark them expired to bypass the check;
- rewrite the format label;
- attempt AES-to-RSA ciphertext conversion;
- alter delivery references to evade the precondition.

A separate reviewed data-migration plan would be required in that case.

### Post-migration row invariants

Every `app.webhook_endpoint_secret_versions` row MUST satisfy:

- `ciphertext_format = 'rsa-oaep-sha256-v1'` exactly;
- `wrapping_key_id IS NOT NULL`;
- `wrapping_key_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'`;
- `secret_ciphertext ~ '^rsa-oaep-sha256-v1\$[A-Za-z0-9_-]+$'`.

The migration MUST preserve:

- primary key and foreign key behavior;
- version/history/`usable_until` semantics;
- current table privilege restrictions;
- zero direct API/worker table DML authority;
- existing RPC signatures and grants.

### Explicitly excluded schema changes

A17 MUST NOT drop or redesign:

- `app.webhook_endpoints.secret_ciphertext`;
- `app.webhook_endpoints.previous_secret_ciphertext`;
- current/previous version compatibility columns on `app.webhook_endpoints`.

Those columns are generic ciphertext storage used by current A7 behavior and are not themselves proof of AES authority.

A17 creates no new table, RPC, role or financial capability.

## 10. Historical A4/A7 test migration contract

A4 behavioral tests that currently depend on AES production fixtures MUST be migrated to RSA-wrapped fixtures while preserving the behavior under test: signed success, one durable retry, invalid/unavailable-secret terminalization, endpoint-policy terminalization, network exception behavior, concurrency and fencing.

The existing A7 compatibility test that currently proves AES delivery success MUST be inverted after A17:

- AES claim -> terminal before network;
- RSA claim -> success;
- missing exact RSA private key -> terminal before network;
- old/new RSA key-ID overlap behavior -> success only with exact matching retained keys.

The A7 real-database runtime acceptance MUST run without `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY` and continue proving endpoint management, secret rotation, two RSA secret versions, immutable delivery snapshots and exact request signatures.

## 11. Fail-first contract

Before implementation, tests MUST demonstrate a CLEAN RED containing only A17-intended failures.

At minimum the RED suite MUST prove the current tree still:

- exposes/requires `SWIFTPAY_WEBHOOK_SECRET_ENCRYPTION_KEY` in worker config;
- exposes/passes `webhookEncryptionKey` in worker runtime composition;
- allows the delivery service to decrypt AES claim material;
- defaults missing ciphertext format to AES;
- exports AES persisted-secret decrypt authority;
- permits worker private-keyring absence;
- permits an AES row with null wrapping key ID in `app.webhook_endpoint_secret_versions`.

All unrelated pre-A17 application contracts and database contracts must remain GREEN in the RED checkpoint.

## 12. GREEN verification contract

A17 is not DONE until all of the following are evidenced:

### Application

- full typecheck/build GREEN;
- complete application contracts GREEN;
- A17 fail-first contracts GREEN;
- K7/A1/A2/A3/A4/A6/A7/A8/A9/A14 real-database acceptance GREEN;
- A4 real acceptance uses RSA-only secret fixtures;
- A7 acceptance uses no legacy AES environment variable.

### Database

- clean migration replay from zero;
- K5 fixture contracts GREEN;
- K6 topology GREEN;
- full pgTAP GREEN;
- direct AES secret-version insertion rejected;
- null wrapping key ID rejected;
- RSA row shape accepted.

### Hosted canonical project

Immediately before migration:

- query and record total webhook secret-version rows;
- query and require AES row count = 0;
- record Payment row count;
- record ProviderAttempt row count.

After migration:

- prove only RSA format is permitted;
- prove wrapping key ID is non-null;
- prove privilege boundary unchanged;
- run Supabase security advisor and require 0 lints attributable to the change;
- prove Payment and ProviderAttempt counts unchanged;
- record zero retained-PSP calls.

## 13. Authority/readiness contract

A17 grants no provider or monetary authority. A10 default authorized retained-provider operations remain zero.

Closing A17 alone does not advance the conservative readiness percentages because the production Pix critical path remains blocked by exact provider-owned current-contract evidence and authenticated provider sandbox proof.