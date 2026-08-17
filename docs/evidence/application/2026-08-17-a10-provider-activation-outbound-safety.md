# A10 — Provider Activation & Outbound Safety — GREEN / NETWORK-FREE

Date: 2026-08-17  
Branch: `agent/foundation-phase-0`  
Status: **DONE / GREEN / NETWORK-FREE**

## Contract authority

- Problem Analysis: `docs/design/a10-provider-activation-outbound-safety-problem-analysis.md`
- Spec: `docs/specs/provider-activation-outbound-safety-v0.yaml`
- Contract: `docs/contracts/provider-activation-outbound-safety-v0.md`
- Current retained-provider revalidation: `docs/evidence/providers/2026-08-17-current-provider-revalidation.md`
- RED evidence: `docs/evidence/application/2026-08-17-a10-provider-activation-outbound-safety-red.md`

## Implemented boundary

A10 adds a repository-versioned, fail-closed provider activation boundary to `packages/providers`.

Exports:

- `PROVIDER_ACTIVATION_SCHEMA_VERSION`;
- `DEFAULT_PROVIDER_ACTIVATION_REGISTRY`;
- `parseProviderActivationRegistry`;
- `createProviderOperationAuthorizer`.

The parser:

- accepts only the exact frozen registry/record shapes;
- rejects unknown/missing fields, enum drift and duplicate `(provider, operation, environment)` identities;
- binds evidence-bearing states to exact lineage, HTTPS provider origin, SHA-256 evidence digest and canonical review timestamp;
- rejects userinfo/query/fragment/localhost/IP-literal provider origins;
- clones and freezes accepted configuration so later caller mutation cannot change authority.

The authorizer:

- looks up the exact provider + operation + environment tuple;
- requires exact case-sensitive contract lineage;
- keeps `unsupported`, `fixture_only` and `current_contract_proven` denied for runtime provider traffic;
- permits Sandbox only from `sandbox_proven` or `production_enabled` on the exact Sandbox record;
- permits Production only from `production_enabled` on the exact Production record;
- returns an immutable in-memory grant containing only approved origin/evidence/decision context;
- contains no provider credential, customer or Payment data.

## Initial authority state

Default registry version:

```text
2026-08-17.0
```

AkkadPag retained lineage:

```text
akkadpag-legacy-api-v1
```

All current AkkadPag records remain `fixture_only`.

FlevoPay retained lineage:

```text
flevopay-legacy-app-api-v1
```

Pix-in/query/recovery/webhook records remain `fixture_only`; Pix-out records remain `unsupported`.

**Authorized provider runtime operations in the checked-in default registry: 0.**

Current public AkadPay evidence cannot authorize the retained AkkadPag lineage by brand similarity.

## Final GREEN proof

Implementation head:

`0308844c4aedb1d359068becfd29d1f4a234b064`

Application workflow `32011311478`: **GREEN**.

Application-contract job `95331276961`:

- typecheck: PASS;
- build: PASS;
- application contracts: **250/250 PASS**;
- A10 contracts: **10/10 PASS**.

Runtime-database-acceptance job `95331276811`: **GREEN**.

Real isolated PostgreSQL regression acceptance remains PASS for:

- K7;
- A1;
- A2;
- A3;
- A4;
- A6;
- A7;
- A8;
- A9.

Database workflow `32011311485`: **GREEN**.

- pgTAP job `95331277035`: existing **40 files / 1292 assertions PASS**;
- K5 sandbox fixtures job `95331277127`: PASS;
- K6 runtime topology job `95331277028`: PASS.

## Refactor/review result

No behavior-changing refactor was required after GREEN.

The activation gate remains isolated in `packages/providers/src/activation.ts`; the existing A5 provider adapter mappings remain in `packages/providers/src/index.ts` and only re-export the new module. This preserves high cohesion and avoids mixing contract-evidence authority with provider DTO mapping.

## Side-effect proof

A10 V0 introduced:

- no Fetch/Undici/Node HTTP transport;
- no DNS/socket transport;
- no provider monetary request;
- no provider credential storage or resolution;
- no Fastify route;
- no Payment/ProviderAttempt/ProviderEvent mutation;
- no ledger/payout/refund/job/webhook/idempotency/audit/KYC side effect;
- no database migration;
- no hosted Supabase change.

No live AkkadPag, AkadPay or FlevoPay call occurred.

## Readiness consequence

A10 materially reduces the probability of accidental premature PSP activation, but it does not close the external provider contract gate or prove authenticated current sandbox behavior.

Therefore the conservative readiness checkpoint remains unchanged:

- core architecture/domain/database/platform: ~99%;
- first end-to-end Pix sandbox MVP: ~97%;
- production-capable Pix V1: ~60%;
- weighted V1 engineering completion: ~75%.

## Next boundary

The next production-oriented slice must again begin with Problem Analysis. A future live HTTP transport may only consume an A10 authorization grant and must remain unusable under the current zero-authority default registry.

Provider-owned current contract/lineage evidence remains the external gate before any registry transition above `fixture_only`/`unsupported`.