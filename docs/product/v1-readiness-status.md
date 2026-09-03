# SwiftPay V2 — V1 Readiness Status

Date: 2026-09-03 (America/Santarem)  
Canonical source: `main`  
A25 canonicalization branch: PR #5 (`agent/a25-hosted-sandbox-e2e-bootstrap`)

This document reports engineering/readiness by risk, not by lines of code or number of files.

## Executive estimate

| Dimension | Current estimate | Interpretation |
| --- | ---: | --- |
| Core architecture/domain/database/platform | **~99%** | Core payment, financial, security and trusted-runtime foundations are essentially established. |
| First end-to-end Pix Sandbox MVP | **~99%** | Hosted database/runtime Sandbox flow is now proven as the exact API LOGIN identity; deployed HTTP/browser compute and secret injection remain. |
| Production-capable Pix V1 | **~62%** | Major production blockers remain retained-PSP evidence/activation and launch operations, not core data modeling. |
| Weighted V1 engineering completion | **~79%** | Remaining raw implementation is smaller but disproportionately launch- and provider-risk heavy. |

Do not interpret 79% engineering completion as 79% launch safety. Production-capable readiness is intentionally lower because provider authority and operational gates dominate real-money risk.

## What is already real

### Platform and financial core

- private Supabase/PostgreSQL canonical state;
- identity/compliance/provider catalog foundations;
- request idempotency and provider-attempt model;
- append-oriented double-entry ledger and merchant balance;
- payout/refund/reservation/reconciliation database foundations;
- durable jobs and merchant webhook persistence;
- trusted API/worker runtime database capability groups;
- credentialless hosted runtime LOGIN bootstrap;
- exact runtime capability manifest and attestation.

### Pix application path

- API credential token exchange and Bearer authentication;
- authenticated Pix create/get;
- deterministic Sandbox emulator;
- paid transition + ledger + balance for the authenticated emulator path;
- merchant webhook delivery runtime;
- conservative `execution_unknown` semantics;
- strict provider default-deny activation boundary;
- strict provider HTTPS transport primitive, intentionally unbound from retained live adapters.

### Merchant product

- React/Vite merchant dashboard;
- Supabase Auth login/session/logout;
- merchant/environment context discovery;
- transaction list/detail;
- API credential management;
- webhook endpoint management;
- one-time secret reveal semantics;
- Sandbox hosted checkout and fixed-amount Payment Links;
- separate anonymous checkout SPA/API surface with Production fail-closed.

### Security / production foundations

- safe structured logging and server-owned correlation;
- bounded operational metrics/OpenMetrics;
- ingress abuse/rate limiting;
- access-token and cursor key rotation;
- webhook RSA secret wrapping and legacy AES retirement;
- abuse-subject HMAC rotation;
- Fastify logging compatibility;
- exact least-privilege runtime capability attestation.

## Latest hosted state

Canonical Supabase project: `swiftpay v2` (`vsidrgbbyzibqfjkuiqb`).

A23/A24/A26/A27 hosted migrations are applied. A25's operational runtime LOGIN bootstrap is applied outside Supabase migration history and installs no hosted password.

Current hosted attestation after A25/A26/A27:

- `swiftpay_api` effective `app` EXECUTE capabilities: **30**
- `swiftpay_worker` effective `app` EXECUTE capabilities: **6**
- Data API effective `app` EXECUTE: **0**
- runtime direct `app` object ACL: **0**
- invalid A23 runtime compatibility references: **0**
- Payment Links rows after final A25 rollback: **0**
- Payments rows after final A25 rollback: **0**
- ProviderAttempts rows after final A25 rollback: **0**
- retained-provider monetary traffic during A23-A27/A25 validation: **0**
- hosted runtime credential installed by A25: **no**

Security Advisor still reports one INFO `rls_enabled_no_policy` for `app.payment_links`. The table remains intentionally private: RLS is enabled, Data API/table authority is absent and trusted SECURITY DEFINER routines are the access boundary. This INFO is recorded and must only change through a dedicated contract if the policy model changes.

## Current quality gates

### A25 formal RED

RED SHA `c83690f41d2f1d7b5d4cce613905853c7fa8508c`, Application workflow `32544773993`:

- 397 application tests total;
- 395 PASS;
- exactly two intended failures for the absent shared hosted bootstrap and K6 reuse;
- runtime database acceptance GREEN.

### A25 initial GREEN

Implementation head `27814232144fa194ed2dbd006c6ce876927caaef`:

- Application workflow `32544895450`: application contracts + runtime DB acceptance GREEN;
- Database workflow `32544895405`: pgTAP + runtime topology + K5 + K6 GREEN.

### A26/A27 runtime compatibility repair

A26 formal RED workflow `32545329166` exposed the missing PostgreSQL JSONB object-arity primitive under the hosted runtime.

A27 then isolated six invalid `pg_catalog.coalesce(...)` references in the A23 resolver.

Final database baseline after both repairs:

- **48 pgTAP files / 1403 assertions PASS**;
- A26 #047: **15/15 PASS**;
- A27 #048: **6/6 PASS**.

### Integrated A25+A26+A27 CI

Integrated head before final documentation: `ea1914bc9a9c50f2bcb1f67585350bef098555f9`.

Application workflow `32548379380`:

- application contracts GREEN;
- runtime database acceptance GREEN;
- K7/A14/A18/A1-A9 GREEN.

Database workflow `32548379307`:

- pgTAP GREEN;
- K5 GREEN;
- initial K6 runtime-topology attempt did not start tests because the GitHub runner could not bind host port `54322`.

Isolated runtime-topology retry job `96971120366`:

- isolated Postgres GREEN;
- runtime identity provisioning GREEN;
- K6 structural contracts GREEN;
- API own connection GREEN;
- worker own connection GREEN.

The first failure is classified as runner infrastructure, not code.

## Hosted A25 Sandbox DB E2E is now proven

A25 executes a controlled positive hosted Sandbox flow in one PostgreSQL transaction as the exact application LOGIN identity:

```text
current_user = swiftpay_api_runtime
```

The smoke proves:

1. authorized Sandbox Payment Link creation;
2. idempotent replay with no duplicate;
3. Production creation fail-closed;
4. cross-tenant administration denial;
5. public projection with no internal identifiers;
6. checkout prepare/replay/conflict semantics;
7. single-winner ProviderAttempt claim;
8. contract-valid Sandbox success resolution;
9. completed replay/conflict semantics;
10. exact one-link/one-payment/one-attempt internal deltas;
11. no paid transition, ledger posting, jobs, payouts, refunds or retained provider I/O;
12. explicit rollback to zero business fixture state.

The PostgreSQL 17 automatic creator-admin membership is also understood and frozen correctly: a preexisting `ADMIN TRUE, SET FALSE, INHERIT FALSE` creator relationship is allowed, while temporary smoke SET/INHERIT authority must return false after rollback.

Evidence:

- `docs/evidence/application/2026-08-21-a25-hosted-runtime-identity-sandbox-db-e2e.md`
- `docs/evidence/application/2026-08-21-a26-a23-jsonb-object-arity-runtime-fix.md`
- `docs/evidence/application/2026-08-21-a27-a23-coalesce-special-form-runtime-fix.md`

## Why Sandbox is ~99%, not 100%

The database/runtime-role path is now proven hosted. What is not yet proven is the deployed compute path.

Remaining Sandbox closure:

1. freeze server-side runtime database credential/bootstrap/rotation contract;
2. deploy the actual SwiftPay V2 API/checkout compute rather than reusing unrelated historical Vercel projects;
3. inject the runtime database credential only server-side;
4. prove Fastify HTTP routing, CORS/TLS and health/readiness behavior;
5. create/open a Payment Link through the deployed HTTP/browser path;
6. create the deterministic Sandbox Pix through deployed compute;
7. prove replay/tenant/security invariants end-to-end over HTTP;
8. preserve clean fixture/rollback or deterministic cleanup semantics.

That is the next internal slice.

## Why production capability remains ~62%

The real-money critical path is still intentionally blocked. Existing fixture adapters plus A10/A11 do **not** authorize a live provider call.

A MagicPay credential set and provider documentation URL have now been supplied for evaluation, but credentials alone are not proof of environment, endpoint contract, idempotency, webhook authority or safe activation.

Before Production Pix can be enabled for any retained provider, we still require:

- provider-owned current contract/lineage evidence;
- exact environment classification;
- exact authentication and base URL;
- exact create/query/idempotency contract;
- ambiguous-execution recovery semantics;
- webhook authentication/replay identity;
- status vocabulary/rate limits;
- authenticated non-destructive proof first;
- dedicated adapter/bridge Problem Analysis → YAML → contracts → RED → GREEN;
- deliberate A10 activation state transition.

No live withdrawal is authorized during provider discovery.

## Remaining V1 engineering

### High priority / launch critical

1. **Final A25 PR canonicalization** — run final docs/test CI and merge PR #5.
2. **Deployed HTTP runtime E2E** — actual V2 API/checkout + server-side DB credential contract.
3. **MagicPay current contract/environment evidence** — verify the supplied provider against current docs without committing secrets.
4. **Authenticated safe provider proof** — non-destructive first; Sandbox/homologation if available.
5. **Provider bridge + activation** — only after evidence closes.
6. **Provider webhook/recovery/reconciliation runtime**.
7. **Deployment/cutover/rollback/backup contract**.
8. **Production secrets/bootstrap and rotation drills**.
9. **Load/capacity testing and measured tuning**.
10. **Production WAF/network hardening**.
11. **External observability dashboards/alerts/SLO policy**.
12. **Branch protection / required checks on `main`**.

### Merchant product completion

- KYC/compliance operations;
- payout API/UI;
- refund API/UI;
- reporting/analytics;
- Production checkout/Payment Links once PSP authority exists.

## Practical interpretation

The project is no longer an early prototype. Most difficult internal invariants — payment state, financial accounting, idempotency, tenant boundaries, secrets, runtime least privilege, abuse controls and merchant administration — have executable contracts and hosted database evidence.

What remains is smaller in raw code volume but higher in launch risk. The next meaningful milestone is not another database primitive: it is deployed HTTP runtime proof plus a rigorously evidenced provider bridge.
