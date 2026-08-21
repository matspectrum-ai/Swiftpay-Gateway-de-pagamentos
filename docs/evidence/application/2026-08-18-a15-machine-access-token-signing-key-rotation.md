# A15 — Machine Access-Token Signing Key Rotation — Final Evidence

Date: 2026-08-18
Status: **DONE / GREEN / APPLICATION-ONLY**

## Scope

A15 replaces the single HS256 machine access-token signing secret with an explicit bounded keyring authority while preserving the A1 token contract, exact 900-second lifetime, database-backed bearer revalidation, tenant/environment semantics and public HTTP behavior.

A15 does not add a database migration, provider bridge, provider credential, monetary authority, network authority or financial state mutation.

## Frozen design artifacts

- Problem Analysis: `docs/design/a15-machine-access-token-signing-key-rotation-problem-analysis.md`
- Specification: `docs/specs/machine-access-token-signing-key-rotation-v0.yaml`
- Contract: `docs/contracts/machine-access-token-signing-key-rotation-v0.md`
- Fail-first contracts: `tests/application/057_a15_machine_access_token_signing_key_rotation.contract.test.mjs`
- RED evidence: `docs/evidence/application/2026-08-18-a15-machine-access-token-signing-key-rotation-red.md`

## Accepted authority contract

Production configuration is now expressed only through:

- `SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID`
- `SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS`
- optional `SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY`

The old `SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY` is not an implicit production fallback.

The keyring is bounded to one through four entries. Key identifiers and key material are validated before runtime composition; duplicate identifiers/secrets, undersized secrets, malformed structures and an active identifier absent from the keyring fail closed.

`@swiftpay/auth` exposes a branded, immutable signing authority. Callers cannot pass a structurally similar plain object as signing authority.

Every newly issued machine JWT has the exact protected-header authority `{ alg: "HS256", kid: "<active-key-id>" }` and is signed only by the active key. Verification selects a configured key by exact `kid`; unknown or malformed `kid`, extra protected-header fields and algorithm drift fail closed without trying other configured keys.

A pre-A15 JWT without `kid` can be verified only through the explicit `legacy-no-kid` verify-only slot. Removing that slot immediately removes no-`kid` compatibility. Operationally, the slot is needed for at most the existing access-token lifetime: 900 seconds after the last token issued under the pre-A15 configuration.

Issuer remains `swiftpay`, audience remains `swiftpay-api`, lifetime remains exactly 900 seconds, canonical machine claims remain unchanged, and successful signature verification still requires current PostgreSQL credential/merchant/environment/secret-version revalidation before a `MachinePrincipal` is produced.

## CLEAN RED proof

Application workflow: `32107998211`

- Typecheck: GREEN
- Build: GREEN
- Application contracts: expected RED
- Total: 322
- Prior contracts: 306 GREEN
- A15 failures: 15 exactly
- A15 redaction invariant already satisfied: 1 A15 test GREEN
- No unrelated application regression
- Real PostgreSQL runtime acceptance K7/A1-A14: GREEN

Database workflow: `32107998170`

- pgTAP: 41 files / 1298 assertions GREEN
- K5 deterministic sandbox fixtures: GREEN
- K6 runtime topology: GREEN

This established a clean TDD transition before implementation.

## GREEN convergence

The first implementation gate (`32108743444`) reached 318/322 with typecheck/build GREEN and all 16 A15 contracts GREEN. The four failures were historical K7/A2/A3 fixtures still invoking the superseded single-key interface; no A15 behavior failed.

A later candidate reached 322/322 but real-runtime acceptance correctly exposed shell/runtime harnesses that still required `SWIFTPAY_ACCESS_TOKEN_SIGNING_KEY`. Those harnesses were migrated rather than reintroducing an obsolete compatibility variable. K7 and A1 then passed, after which A2 exposed the same stale runtime fixture pattern. A2/A3 and the A8 bearer revalidation driver were migrated to the frozen A15 authority.

This convergence preserved the test intent rather than weakening assertions or adding a hidden fallback.

## Final accepted implementation head

Code/acceptance head: `1ad6fb9b44d89e05d598db81f15c11ef745da6f9`

### Application workflow

Run: `32116297016`

- Typecheck: GREEN
- Build: GREEN
- Application contracts: **322/322 PASS**
- Failures: 0
- K7 real runtime database acceptance: GREEN
- A1 real token authentication acceptance: GREEN
- A2 real Pix runtime acceptance: GREEN
- A3 real paid/ledger/balance acceptance: GREEN
- A4 real merchant webhook runtime acceptance: GREEN
- A6 dashboard authorization real-database acceptance: GREEN
- A7 webhook endpoint management real-database acceptance: GREEN
- A8 API credential management real-database acceptance: GREEN
- A9 merchant transaction operations real-database acceptance: GREEN
- A14 ingress abuse real-database acceptance: GREEN

### Database workflow

Run: `32116297019`

- pgTAP: **41 files / 1298 assertions PASS**
- K5 deterministic sandbox fixtures: GREEN
- K6 structural/runtime topology: GREEN
- API runtime identity verification: GREEN
- Worker runtime identity verification: GREEN

## Safety evidence

- No A15 database migration exists.
- Canonical hosted Supabase schema was not changed by A15.
- No provider HTTP call was introduced or executed.
- No A5 adapter was wired to A11.
- A10 provider activation states were not promoted.
- Default retained-provider live authority remains zero.
- No Payment or ProviderAttempt state is created by A15.
- Provider current-contract/authenticated-sandbox blocker remains unchanged.

## Operational rotation sequence

1. Add the new key to `SWIFTPAY_ACCESS_TOKEN_SIGNING_KEYS` while retaining the previous `kid` entry for verification.
2. Set `SWIFTPAY_ACCESS_TOKEN_ACTIVE_KEY_ID` to the new key and restart/roll the API deployment atomically with the new configuration.
3. New tokens are issued with the new `kid`; old `kid` tokens remain verifiable through their exact retained key.
4. Keep a former configured `kid` only as long as already-issued tokens using it can remain valid.
5. For tokens issued before A15 and therefore lacking `kid`, use `SWIFTPAY_ACCESS_TOKEN_LEGACY_NO_KID_KEY` only during the bounded transition, for at most 900 seconds after the last pre-A15 issuance.
6. Remove expired verify-only keys/legacy slot after the bounded overlap.
7. Never reuse a key identifier for different key material.

## Closure

A15 is **DONE / GREEN**. It closes the machine access-token signing-key rotation foundation without changing SwiftPay's provider readiness or granting monetary execution authority.
