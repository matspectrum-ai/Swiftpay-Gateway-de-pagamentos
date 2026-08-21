# A1 — API credential token authentication evidence

Date: 2026-08-15
Branch: `agent/foundation-phase-0`
Spec: `docs/specs/api-credential-token-exchange-v0.yaml`
Final code checkpoint: `3924b93452351c6368b3521d42a5a69d351b63f4`

## Result

A1 is GREEN. SwiftPay V2 now has an executable machine-to-machine authentication boundary for the public API:

- `POST /v1/auth/token` with `client_credentials`;
- opaque Secret Key verification using the canonical `scrypt-v1` verifier;
- JWT access tokens signed with HS256 through `jose`, issuer `swiftpay`, audience `swiftpay-api`, TTL 900 seconds;
- exact-IP allowlist enforcement using the Fastify-derived client IP;
- atomic PostgreSQL issuance quota of 10 successful tokens per credential per 3600-second window;
- reusable Bearer verification with mandatory current database revalidation of credential, merchant, environment and `secret_version`;
- sanitized and existence-indistinguishable invalid-credential failures;
- no direct runtime table DML for authentication state;
- no payment, ledger, job or merchant-webhook side effects.

Credential create/rotate/revoke dashboard endpoints remain outside A1. The next product slice is `pix-create-get-emulator-v0`.

## TDD history

A1 was implemented as explicit RED → GREEN contracts:

1. auth primitives — `tests/application/006_auth_primitives.contract.test.mjs`;
2. token exchange orchestration — `007_token_exchange_service.contract.test.mjs`;
3. trusted database auth store — `008_api_credential_auth_store.contract.test.mjs`;
4. executable API runtime wiring — `009_api_auth_runtime_wiring.contract.test.mjs`;
5. Bearer database revalidation — `010_bearer_revalidation.contract.test.mjs`;
6. real sandbox runtime fixture/harness — `011_a1_real_runtime_fixture.contract.test.mjs` plus `011_a1_real_runtime_acceptance.sh`.

The implementation was not declared complete until the real runtime acceptance was GREEN.

## Runtime acceptance

Final Application contracts run `31872424000` completed GREEN on the post-refactor checkpoint.

The `runtime-database-acceptance` job proved both K7 and A1 against an isolated real PostgreSQL/Supabase runtime. The A1 harness observed:

- wrong Secret Key: `401`;
- unknown Public Key: `401` with the same public failure shape;
- revoked credential: `401`;
- inactive merchant: `401`;
- denied client IP: `403`;
- successful token issuances 1 through 9: `200`;
- concurrent 10th/11th issuance through two independent API processes: exactly one `200` and one `429`;
- the rate-limited response includes a positive integer `Retry-After`;
- old JWT accepted while credential state/version matches;
- old JWT rejected immediately after credential revocation;
- old JWT rejected after restoring the credential with a newer `secret_version`;
- test Secret Key and stored verifier absent from captured API logs;
- `app.payments`, `app.ledger_transactions`, `app.jobs`, and `app.webhook_events` remain empty.

The final harness output ended with `SwiftPay A1 real runtime acceptance: OK`.

## Database contracts

Final Database contracts run `31872423956` completed GREEN across all lanes:

- canonical pgTAP database lane: PASS — 31 files / 1050 tests;
- deterministic K5 sandbox fixture lane: PASS;
- K6 runtime-topology lane: PASS.

The A1 database boundary is represented by:

- `20260815052828_api_credential_token_auth_foundation.sql`;
- `20260815054302_api_credential_token_auth_behavior.sql`;
- `app.lookup_api_credential_for_token(text)`;
- `app.consume_api_token_issuance(uuid)`;
- `app.get_api_credential_auth_state(uuid)`;
- `app.api_credential_token_windows`.

The trusted API capability may execute only the narrow authentication routines required by A1. Direct table DML is not introduced as an authentication mechanism.

## Security properties proven

- Public Key input is normalized; Secret Key input is opaque and is never trimmed.
- Malformed stored verifier data fails closed.
- Secret comparison uses scrypt-derived keys and constant-time comparison.
- JWT signing configuration fails closed when the signing key is missing or shorter than 32 UTF-8 bytes.
- JWTs contain merchant/credential identifiers, environment, secret version and token id, but no Secret Key or verifier material.
- Token signature validity alone is insufficient for protected access; database state is revalidated on every Bearer authentication boundary.
- Revocation and secret-version rotation immediately invalidate an otherwise cryptographically valid token.
- Invalid credentials and IP-denied requests do not consume quota.
- The distributed issuance limit is enforced by PostgreSQL, not process-local memory.

## Refactor closure

After the first full GREEN runtime run, the obsolete `AuthNotImplementedError` and `createUnimplementedTokenExchangeHandler` placeholder exports were removed from `packages/auth`.

The complete application and database workflows were rerun after that refactor and remained GREEN. No HTTP contract, database migration or authorization grant changed in the refactor.

## Boundary after A1

```text
merchant machine client
  -> POST /v1/auth/token
  -> Fastify API
  -> swiftpay_api_runtime
  -> narrow app auth routines
  -> 900s Bearer JWT
  -> reusable Bearer verification
  -> current credential/merchant database revalidation
```

The next slice must use this machine principal to implement authenticated Pix create/get, database idempotency and a deterministic provider emulator before any live AkkadPag or FlevoPay call.
