# A22 — Merchant Dashboard Integration Settings UI — Final Evidence

Date: 2026-08-19  
Status: **DONE / GREEN / APPLICATION-ONLY**

## Scope

A22 turns the A21 dashboard's placeholder integration navigation into executable merchant settings surfaces backed only by the already-hosted A7 webhook-endpoint and A8 API-credential management contracts.

Frozen artifacts:

- Problem Analysis: `docs/design/a22-merchant-dashboard-integration-settings-ui-problem-analysis.md`
- Spec: `docs/specs/merchant-dashboard-integration-settings-ui-v0.yaml`
- Contract: `docs/contracts/merchant-dashboard-integration-settings-ui-v0.md`
- Fail-first application contract: `tests/application/065_a22_merchant_dashboard_integration_settings_ui.contract.test.mjs`

Accepted implementation head before this evidence document:

`2647d4da55d9344a139cd9a0e18cd316f2d1f12f`

## TDD RED

Application workflow `32259787311`, application-contracts job `96090015535`:

- typecheck: GREEN;
- build: GREEN;
- total application contracts: **383**;
- PASS: **375**;
- FAIL: **8**.

The eight failures were exactly the frozen A22 absences:

1. settings navigation/routes;
2. API-credential browser client functions;
3. webhook-endpoint browser client functions;
4. mutation `Idempotency-Key` plus sanitized step-up/conflict mapping;
5. stable logical-mutation idempotency key across session-refresh retry;
6. one-time secret reveal/copy UX;
7. role-aware mutation presentation;
8. fixed `payment.paid` webhook UX and disabled-before-URL-edit behavior.

The A22 non-expansion assertions were already GREEN in RED: application-only scope, no migration, no runtime-capability drift, no browser database/provider/financial authority.

The same RED checkpoint's real PostgreSQL runtime regression remained GREEN for K7, A14, A18 and A1-A9.

## GREEN application proof

Final Application workflow: `32262432986`.

Application-contracts job `96099665975` completed successfully on the accepted A22 implementation:

- frozen dependency installation / supply-chain policy: GREEN;
- TypeScript typecheck: GREEN;
- production build: GREEN;
- application contracts: **383 / 383 PASS**;
- failures: **0**.

Implemented browser surface:

- `/settings/api-credentials`;
- `/settings/webhooks`;
- active SPA navigation and back/forward handling;
- API-credential list/create/rotate-secret/revoke;
- webhook list/create/disable/enable/disabled-URL-update/rotate-secret;
- fixed A7 V0 event selection: `payment.paid`;
- responsive settings forms/tables/cards and secret-reveal surface.

## Secret and idempotency invariants

A22 keeps plaintext integration secrets ephemeral in component state only.

- A8 `secretKey` is rendered only when the winning create/rotation response says it is available;
- A7 `signingSecret` is rendered only when the winning create/rotation response says it is available;
- secret values are not written to localStorage, sessionStorage or IndexedDB;
- secret state is cleared on dismissal, integration-view navigation and merchant/environment changes;
- replay responses do not redisclose plaintext secrets;
- no secret value becomes an application log field.

Every logical mutation allocates `const idempotencyKey = crypto.randomUUID()` before entering `withSessionRetry(...)`. If the user session expires and is refreshed, the same captured key is reused for the retried mutation. A new key is not generated for the retry.

## Authorization invariants

Browser role checks are presentation only. They do not replace A7/A8 server authority.

- A8 Sandbox mutations are presented only for `admin|owner`;
- A8 Production mutations are presented only for `owner`;
- A7 webhook mutations are presented only for `admin|owner`;
- A8 mutation AAL2 remains enforced by the trusted API's online-validated privileged session verifier;
- `step_up_required` is surfaced as a sanitized `Autenticação adicional necessária` state;
- A22 does not decode the JWT to manufacture AAL or role authority;
- direct Supabase database/Data API access remains absent from the dashboard.

## Final database proof

Database workflow `32262432998`:

- pgTAP: **44 files / 1340 assertions PASS**;
- runtime topology: GREEN;
- deterministic sandbox fixtures: GREEN.

A22 adds no migration and changes no database routine or privilege.

The canonical hosted capability set therefore remains the A21-attested exact set:

- `swiftpay_api`: **25** `app` EXECUTE signatures;
- `swiftpay_worker`: **6** `app` EXECUTE signatures.

No hosted Supabase write is required for A22.

## Runtime regression and A8 transient

The first final-head runtime job `96098638789` passed K7, A14, A18 and A1-A7, then the pre-existing A8 synthetic concurrent active-credential-cap acceptance observed only seven winning creates (`concurrent_limit_created_7`) and stopped before A9.

A22 changes only browser application code and did not alter A8, the trusted API, the database functions, migrations, runtime pool configuration or the 10-active-credential invariant. The same A8 acceptance had exhibited equivalent transient runner/pool contention before A22.

The runtime job was rerun **unchanged on the same accepted implementation SHA**. Rerun job `96099664047` completed GREEN:

- K7: GREEN;
- A14: GREEN;
- A18: GREEN;
- A1: GREEN;
- A2: GREEN;
- A3: GREEN;
- A4: GREEN;
- A6: GREEN;
- A7: GREEN;
- A8: `A8_ACCEPTANCE_OK credential management behavior`;
- A9: `A9_ACCEPTANCE_OK dashboard transaction read behavior`.

No production timeout, pool-size or A8 contract was weakened to obtain the passing result. The transient remains a separate runtime-test reliability concern, not an accepted A22 behavior change.

## Non-expansion / safety proof

A22 introduces:

- database migrations: **0**;
- new backend routes: **0**;
- new database routines: **0**;
- new runtime capabilities: **0**;
- provider activation changes: **0**;
- retained-provider network calls: **0**;
- financial mutation authority: **0**.

A5 remains fixture-only, A10 remains default-deny with zero retained-provider operations authorized, and A11 remains unbound from retained A5 adapters.

## Accepted result

A22 is accepted as **DONE / GREEN / APPLICATION-ONLY**. The merchant dashboard now exposes functional API-credential and merchant-webhook administration over the existing trusted SwiftPay API boundary while preserving one-time-secret, idempotency, AAL2, role, database and provider safety contracts.
