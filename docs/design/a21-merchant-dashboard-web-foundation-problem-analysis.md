# A21 — Merchant Dashboard Web Foundation — Problem Analysis

Status: `PROBLEM_ANALYSIS`  
Date: 2026-08-19  
Branch: `agent/foundation-phase-0`

## Why this slice exists

SwiftPay V2 has a substantial merchant-dashboard **backend** but no merchant-dashboard **web application**. The repository currently has only `apps/api` and `apps/worker`; A6/A7/A8/A9 expose trusted dashboard authentication/authorization and merchant administration/read APIs, but there is no browser UI that a merchant can open and use.

This is now the highest-value internal product slice that can advance independently of the externally blocked retained-PSP contract gate.

## Existing authority that A21 must reuse

A21 must not duplicate or bypass already accepted boundaries:

- A6: Supabase Auth online dashboard session verification and merchant/environment role authorization;
- A7: dashboard webhook endpoint administration;
- A8: dashboard API credential administration with AAL2 step-up for sensitive mutations;
- A9/A16: dashboard transaction list/detail and authenticated keyset cursors;
- A14/A18: public ingress abuse controls and HMAC rotation;
- A12/A13/A19: safe logging, metrics and Fastify logging compatibility;
- A20: exact trusted API/worker database capability attestation.

The browser must never receive `swiftpay_api`, `swiftpay_worker`, service-role, PostgreSQL or protected-table authority.

## Concrete product gap discovered

A6/A7/A8/A9 routes are merchant/environment-scoped and require a `merchantId` and environment in the request path, but the current trusted API capability set has **no dashboard bootstrap/context-discovery RPC or route** that lets a newly authenticated user enumerate the merchant/environment contexts they are actually authorized to access.

Therefore a polished dashboard cannot safely start by asking the browser to invent, hardcode or directly query protected membership state.

A21 must solve this bootstrap problem before treating the web shell as production-usable.

## Candidate A21 boundary

The smallest useful first visible dashboard slice is:

1. a real web application workload under `apps/`;
2. Supabase Auth merchant sign-in/sign-out/session handling using only browser-safe publishable configuration;
3. a trusted read-only dashboard bootstrap endpoint that returns only the current verified user's authorized merchant/environment contexts and role-safe display metadata;
4. merchant/environment context selection in the web app;
5. transaction list screen backed only by A9;
6. transaction detail screen backed only by A9;
7. loading, empty, expired-session, forbidden and API-unavailable states;
8. no direct browser access to `app` tables or privileged Supabase database APIs.

A7 webhook management UI and A8 API credential management UI are intentionally strong candidates for the immediately following slices because their backend contracts are already hosted, but they should not inflate A21 beyond a reviewable first user-visible vertical slice.

## Not in A21

- live PSP activation or A5→A11 bridge;
- Pix monetary creation from the dashboard;
- provider webhook ingress;
- KYC review UI;
- payout/refund UI;
- hosted checkout or Payment Links;
- reporting/analytics beyond A9 transaction list/detail;
- admin/backoffice superuser surface;
- browser service-role/database credentials;
- direct browser SQL/Data API access to protected SwiftPay state.

## Decisions that must be frozen before implementation

The A21 YAML specification must choose and freeze:

- web framework/build/runtime and exact workspace integration;
- browser/server rendering boundary;
- dashboard API origin/configuration model;
- Supabase browser Auth client configuration and session persistence model;
- CSRF/cookie/Bearer strategy for browser→SwiftPay dashboard API calls;
- dashboard bootstrap/context-discovery HTTP contract;
- database RPC/projection required for safe context discovery;
- merchant/environment selection semantics;
- exact transaction-list/detail page states;
- cache/no-store behavior for authenticated financial metadata;
- CSP/security-header baseline;
- deployment topology for the web workload without granting it trusted database roles.

No framework or deployment provider is authorized merely by this problem analysis.

## TDD boundary

Before implementation, fail-first tests must prove at minimum:

- no dashboard web workload currently exists;
- no safe dashboard context-discovery route currently exists;
- browser code cannot import/use trusted PostgreSQL runtime credentials;
- browser code cannot use service-role authority;
- successful bootstrap derives user identity only from verified A6 session authority;
- bootstrap returns only authorized merchant/environment contexts;
- transaction UI requests only A9 routes and does not access database state directly;
- session expiry/401, forbidden/403 and API-unavailable states fail closed without leaking internal details.

## Success criterion

A21 is complete only when a merchant can open the actual web application, authenticate through the frozen browser-safe Auth boundary, discover/select an authorized SwiftPay merchant/environment context and view transaction list/detail through the already accepted A9 backend — with no privileged browser/database/provider authority.

This is the first slice where SwiftPay V2 becomes visibly usable as a merchant-facing product rather than primarily an API/runtime foundation.
