# A15 — Machine Access-Token Signing Key Rotation — RED Evidence

Date: 2026-08-18  
State: **TDD_RED / IMPLEMENTATION AUTHORIZED**  
Branch: `agent/foundation-phase-0`

## Frozen authority

- Problem Analysis: `docs/design/a15-machine-access-token-signing-key-rotation-problem-analysis.md`
- Specification: `docs/specs/machine-access-token-signing-key-rotation-v0.yaml`
- Contract: `docs/contracts/machine-access-token-signing-key-rotation-v0.md`
- Fail-first tests: `tests/application/057_a15_machine_access_token_signing_key_rotation.contract.test.mjs`
- RED head: `e75335e90966bf7cc0f19a5c8eff30e8d53efdba`

A15 is deliberately narrow: it changes only A1 machine access-token HS256 signing/verification authority. It does not include A9 cursor HMAC, A14 abuse HMAC, webhook crypto, provider credentials, database schema or provider runtime wiring.

## Application CLEAN RED

GitHub Actions run `32107998211`.

The application-contract job completed with the intended RED result:

- frozen dependency install: GREEN;
- TypeScript typecheck: GREEN;
- build: GREEN;
- total tests: **322**;
- pass: **307**;
- fail: **15**.

Interpretation:

- all **306 pre-A15 application contracts passed**;
- the A15 file defines 16 tests;
- one A15 redaction/non-authority guarantee was already satisfied by the existing codebase;
- the remaining **15 A15 tests failed** because the frozen A15 keyring/config/`kid`/runtime boundary does not yet exist;
- no pre-existing A1-A14 application contract regressed.

The intended missing behavior includes:

- `createAccessTokenSigningAuthority` export;
- new active-key/keyring/legacy-no-`kid` configuration;
- immutable validated authority branding;
- exact `{alg:'HS256',kid:<active>}` issuance;
- deterministic known-`kid` key selection;
- no unknown-`kid` fallback/trial-all verification;
- explicit no-`kid` legacy migration slot;
- production runtime keyring wiring with no implicit old single-key fallback.

## Runtime regression proof

The `runtime-database-acceptance` job in Application run `32107998211` completed **GREEN**.

Passed:

- K7 real runtime database acceptance;
- A1 token authentication acceptance;
- A2 Pix runtime acceptance;
- A3 paid/ledger/balance acceptance;
- A4 merchant webhook runtime acceptance;
- A6 dashboard authorization acceptance;
- A7 webhook endpoint management acceptance;
- A8 API credential management acceptance;
- A9 merchant transaction operations acceptance;
- A14 ingress abuse acceptance.

Therefore the fail-first A15 test commit did not disturb the existing real runtime path.

## Database regression proof

GitHub Actions run `32107998170`: **GREEN**.

- deterministic sandbox fixtures / K5: GREEN;
- production-like runtime topology / K6: GREEN;
- pgTAP: **41 files / 1298 assertions PASS**.

The pgTAP job explicitly reported:

`All tests successful. Files=41, Tests=1298 ... Result: PASS`

No database migration or privilege change is part of A15.

## TDD conclusion

This is a valid CLEAN RED gate:

- specification and contract are frozen;
- prior behavior is GREEN;
- database/runtime regressions are GREEN;
- failures are isolated to the intended new A15 behavior.

Minimal A15 implementation is now authorized. Refactoring remains prohibited until the frozen A15 contracts are GREEN.