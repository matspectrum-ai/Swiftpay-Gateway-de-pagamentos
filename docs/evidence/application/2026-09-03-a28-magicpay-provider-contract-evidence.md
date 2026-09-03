# A28 — MagicPay provider contract evidence

Date: 2026-09-03 (America/Santarem)
Status: GREEN for partial contract-safe application scope; live provider authority remains zero

## Source evidence

Provider-supplied integration guide SHA-256:

`b9b493227d45b880077383c145e9ca5a0c16e6fae327b84d2c614566b8c47104`

Provider documentation entry point:

`https://app.dashboardmagicpay.com/docs/intro/first-steps`

No real public, secret or withdrawal credential value is committed in this evidence or anywhere else in the A28 branch.

## Contract facts closed by the guide

The guide establishes:

- base URL `https://api.dashboardmagicpay.com/v1`;
- HTTP Basic Auth with public key as username and secret key as password;
- integer-centavo money representation;
- digit-only CPF/CNPJ/phone serialization;
- Pix cash-in request via `POST /transactions` with `paymentMethod=pix`;
- lookup route `GET /transactions/{id}`;
- read-only `GET /company` and `GET /balance/available`;
- `postbackUrl` delivery with transaction-shaped status body, 2xx acknowledgement and retry after non-2xx;
- `x-withdraw-key` requirement for withdrawal/anticipation routes.

## Gaps deliberately left open

A28 records, rather than guesses, the following missing provider-owned facts:

- successful Pix create response schema;
- Pix QR/copy-and-paste field location;
- transaction-query response envelope;
- create idempotency semantics;
- ambiguous-create recovery path;
- error certainty semantics;
- Sandbox/homologation environment;
- webhook authentication/signature;
- webhook replay identity;
- explicit rate limits.

`externalRef` is not treated as an idempotency guarantee.

## Safe authenticated probe attempt

Only documented non-destructive reads were considered: `/company`, `/transactions?page=1&pageSize=1`, and `/balance/available`.

The available execution environment could not resolve `api.dashboardmagicpay.com`; the probe therefore produced no provider request and no account response. This is recorded as an environment DNS limitation, not an authentication/provider failure.

A separate local GitHub clone attempt also could not resolve `github.com`, corroborating that the execution environment had DNS limitations during this work unit.

## TDD evidence

Formal RED head:

`ee1cd36325bc283fdf4153d7ee7d6c16efa5d964`

Application workflow:

`33809027827`

The `application-contracts` job completed FAILURE while install, typecheck and build were GREEN. The failure occurred only at `Run application contracts`, as intended before the dedicated MagicPay module existed. Runtime-database acceptance remained an independent existing gate.

## GREEN implementation

Implementation artifact:

`packages/providers/src/magicpay.ts`

The module provides only:

- exact partial-contract metadata;
- pure Basic-authenticated MagicPay Pix request construction;
- input normalization/validation before transport;
- read-only company and available-balance clients.

The module intentionally does not expose a live `createMagicPayAdapter`.

A safety refinement made during implementation keeps `magicpay.ts` outside `packages/providers/src/index.ts`; therefore the incomplete provider is not added to the normal public provider barrel.

GREEN application head before this evidence document:

`41af647e5cf3a4dcff206953168d5e770b77a6fc`

Application workflow:

`33809360204`

`application-contracts` job `100827316426` passed all steps:

- dependency install GREEN;
- typecheck GREEN;
- build GREEN;
- application contracts GREEN.

The same workflow's runtime-database-acceptance job is unchanged existing acceptance and was still executing when this evidence file was first written; no A28 database behavior exists.

## Authority attestation

A28 changes none of the following:

- `packages/providers/src/activation.ts` has no MagicPay registration;
- A10 activation remains default-deny for MagicPay;
- no A11 monetary binding exists;
- no payable Pix request was sent;
- no withdrawal request was sent;
- no refund request was sent;
- no MagicPay webhook is trusted;
- no provider credential was persisted in Git/CI/browser/application logs.

## Accepted scope

A28 may be considered `DONE / GREEN / APPLICATION-ONLY / EVIDENCE-PARTIAL` once final documentation-head Application CI remains GREEN.

It does not establish authenticated provider access, a live Pix adapter, Sandbox proof, Production authority, webhook authenticity, or idempotent monetary recovery.

## Next provider gate

A later live-provider slice must obtain and freeze:

1. exact successful Pix create response example/schema;
2. exact `GET /transactions/{id}` response example/schema;
3. provider idempotency/retry/ambiguous-execution recovery semantics;
4. Sandbox/homologation classification or an explicitly approved minimal Production smoke boundary;
5. webhook authenticity/replay semantics, or a deliberately query-only reconciliation design;
6. successful authenticated non-destructive proof from a network path that resolves the provider host;
7. fail-first live adapter + A11 bridge tests;
8. deliberate A10 activation only after the above evidence closes.
