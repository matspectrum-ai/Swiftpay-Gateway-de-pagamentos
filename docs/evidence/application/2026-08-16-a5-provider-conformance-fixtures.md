# SwiftPay V2 — A5 Provider Conformance Fixtures — Evidence

Date: 2026-08-16
Status: **DONE — fixture conformance only; no live-provider activation**

Problem Analysis: `docs/design/a5-provider-conformance-problem-analysis.md`
Spec: `docs/specs/provider-conformance-v0.yaml`
Implementation: `packages/providers/src/index.ts`
Fixtures: `tests/application/provider-fixtures/{akkadpag,flevopay}/`
Contracts: `tests/application/028_a5_provider_contract.contract.test.mjs` through `031_a5_fixture_security_network.contract.test.mjs`

## Scope accepted

A5 establishes a deterministic, network-free conformance boundary for the two retained SwiftPay V1 provider targets:

- AkkadPag;
- FlevoPay.

A5 deliberately does **not** claim that historical adapter behavior is a current production contract. It proves that SwiftPay V2 can preserve the source-confirmed protocol knowledge behind a small capability-oriented adapter boundary while failing closed anywhere current provider evidence is insufficient.

No live provider request, DNS lookup, provider credential, provider account, money movement, database migration or hosted Supabase mutation is part of A5.

## Evidence model accepted

Provider facts are classified as:

- `proven_current`;
- `proven_legacy`;
- `inferred_non_authoritative`;
- `unknown`.

Only `proven_current` evidence may independently unlock a production operation. `proven_legacy` may define deterministic fixture compatibility but cannot establish current endpoint, idempotency, recovery or webhook-authentication guarantees.

The A5 operation-state ceiling is `fixture_only`. Production activation is impossible inside this slice.

## Current lineage decision

### AkkadPag

The retained legacy revision proves the historical contract around:

- `https://api.akkadpag.com/v1/`;
- HTTP Basic authentication from `publicKey:secretKey`;
- Pix-in `POST transactions`;
- Pix-in query `GET transactions/{paymentId}`;
- Pix-out `POST transfers` with `x-withdrawal-key`;
- Pix-out query `GET transfers/{transferId}`.

Public material rechecked on 2026-08-16 describes a materially different AkadPay contract under `painel.akadpay.com.br`, including different routes and credential placement. No provider-owned evidence available to this audit proves that AkadPay is the contractual successor/equivalent of the retained AkkadPag API.

Therefore:

- AkkadPag legacy behavior is `proven_legacy`;
- AkadPay public behavior is discovery evidence only for this retained adapter;
- importing AkadPay semantics into the AkkadPag adapter is forbidden;
- current AkkadPag production endpoint/idempotency/webhook semantics remain `EVIDENCE_REQUIRED`.

### FlevoPay

The retained revision proves the historical contract around:

- `https://app.flevopay.com.br/api/v1/`;
- `X-API-Key` authentication;
- Pix-in `POST transaction`;
- status lookup `GET query?action=get_transaction&id=...`;
- seller lookup `GET seller`;
- no Pix-out operation in the audited adapter.

Current public FlevoPay material references a newer API host and API-key integration at a marketing level, but does not expose enough exact technical evidence to prove create/query/idempotency/recovery/webhook semantics or to enable Pix-out.

Therefore:

- the historical contract is `proven_legacy`;
- current production lineage/details remain `EVIDENCE_REQUIRED`;
- FlevoPay Pix-out remains locally unsupported.

## Frozen capability matrix

A5 exposes exactly:

```text
AkkadPag
  activation        fixture_only
  Pix In            true
  Pix query         true
  Pix Out           true (fixture contract only)
  refund            false
  webhook authority false

FlevoPay
  activation        fixture_only
  Pix In            true
  Pix query         true
  Pix Out           false
  refund            false
  webhook authority false
```

Unsupported operations fail before provider transport.

## Corrected legacy semantics

A5 intentionally does not preserve unsafe legacy behavior.

### No synthetic customer identity

Both retained legacy services substituted placeholder customer identity/contact values when input was missing. A5 instead validates required real input and returns `pre_execution_failure` before transport. No fake CPF/CNPJ, phone, email or name is generated.

### No blind monetary retry

A provider monetary operation receives one transport invocation at most. Timeout, reset, malformed successful response, unproven 4xx or ambiguous 5xx produces `execution_unknown`; A5 never sends a second create/payout request automatically.

### Unknown provider status fails closed

The legacy status converters defaulted unknown AkkadPag/FlevoPay statuses to `pending`/`processing`. A5 returns `unrecognized_provider_status` instead. Unknown evidence cannot silently move canonical financial state.

### FlevoPay Pix-out remains unsupported

The adapter returns `unsupported` without transport. Current marketing references are insufficient to change the frozen retained capability contract.

### Provider webhook authority remains unavailable

Because exact current provider verification/replay contracts are not proven, both adapters return:

```json
{
  "kind": "verification_unavailable",
  "trusted": false
}
```

A provider webhook therefore cannot become trusted financial evidence through A5.

## Fixture corpus

A5 adds 23 sanitized synthetic JSON artifacts across AkkadPag and FlevoPay.

The corpus covers:

- successful Pix creation;
- malformed 2xx monetary response;
- ambiguous/unproven 4xx;
- ambiguous 5xx;
- transport ambiguity;
- pending/paid/unknown status query vectors;
- AkkadPag payout processing/completed/unknown status vectors;
- provider manifest/provenance metadata.

Fixtures use reserved synthetic domains and fake fixture credentials. Manifests explicitly state `fixture_only` provenance and block production activation.

## RED evidence

Clean RED head: `10a7051afee1cdd07105c6f08bfac6a5f143ea35`.

Application workflow: `31926931467`.

The clean RED gate proved:

- frozen dependency install: PASS;
- TypeScript typecheck: PASS;
- build: PASS;
- 147 application tests executed;
- 132 pre-A5/fixture-guard tests PASS;
- exactly 15 A5 behavior tests FAIL because the executable provider scaffold returned `not_implemented` rather than the frozen contract values;
- no `ERR_MODULE_NOT_FOUND`, parser failure or harness failure remained.

The same RED head also preserved K7/A1/A2/A3/A4 real-runtime acceptance and the independent database lanes.

This is the required TDD proof that implementation followed executable contracts rather than preceding them.

## GREEN evidence

GREEN implementation head: `3583f57e5090ce89284b7929980d738396aafd58`.

Application workflow: `31927064932` — **GREEN**.

Accepted application evidence:

- frozen dependency install: PASS;
- typecheck: PASS;
- build: PASS;
- **147/147 application contracts PASS**;
- A5 common capability/validation/uncertainty contracts: PASS;
- AkkadPag fixture conformance: PASS;
- FlevoPay fixture conformance: PASS;
- fixture provenance/security/network guard: PASS;
- K7/A1/A2/A3/A4 real runtime database acceptance: PASS.

Database workflow: `31927064836` — **GREEN**.

Accepted database evidence:

- pgTAP: PASS;
- K5 deterministic sandbox fixtures: PASS;
- K6 runtime topology/least privilege: PASS;
- no A5 schema or migration was introduced.

## Security / network proof

The provider package contains no live Node HTTP/HTTPS/net/TLS/DNS transport and no native `fetch` call. Transport is an injected interface used only by deterministic tests in A5.

A5 commits no real provider credentials or production endpoints as executable network configuration. Monetary retry loops do not exist in the adapter implementation.

## Production activation status

A5 being GREEN does **not** authorize live money movement.

The following remain required before a provider operation can move beyond `fixture_only`:

1. provider-owned current technical documentation bound to the exact retained/current lineage, or authenticated current sandbox evidence;
2. exact current production/sandbox base URLs;
3. current credential placement/rotation rules;
4. authoritative create/query correlation identity;
5. current idempotency/recovery semantics for ambiguous monetary execution;
6. exact webhook authentication, replay identity and event semantics;
7. current status vocabulary and rate-limit behavior;
8. separate live-provider bootstrap/security acceptance.

No live monetary call is permitted merely because A5 fixtures are GREEN.

## Closure decision

**A5 provider conformance fixtures: DONE.**

SwiftPay now has an executable, network-free retained-provider boundary whose unsafe/unknown cases fail closed. The remaining provider critical path is external/current contract evidence followed by separately gated live transport/adapters and provider webhook/recovery acceptance.
