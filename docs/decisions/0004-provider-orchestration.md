# ADR 0004 — Provider Orchestration Strategy

Status: Accepted

Date: 2026-08-13

## Decision

Use **native thin provider adapters** for the first Pix-first SwiftPay V2 release.

Hyperswitch is not part of the initial runtime topology.

The active initial provider set is frozen to exactly:

1. **AkkadPag**
2. **FlevoPay**

The other ten audited legacy processors are deferred and must not receive V1 runtime adapters, routes, credential surfaces or webhook handlers unless a new explicit scope decision is accepted.

## Why

The audit found no first-party exact-brand Hyperswitch connector occurrence for the legacy SwiftPay provider set. Adding Hyperswitch would therefore introduce another runtime and semantic boundary without proven reduction in connector work.

With only AkkadPag and FlevoPay retained, the case for a small native layer is stronger: SwiftPay needs two precise provider contracts, not a generalized twelve-provider framework.

## Target shape

```text
SwiftPay API
  -> PaymentOrchestrator
      -> ProviderRouter
          -> AkkadPagAdapter
          -> FlevoPayAdapter
```

The provider interface is capability-oriented. Provider selection does not imply that every operation is supported.

Initial capability routing:

```text
Pix In   -> AkkadPag or FlevoPay, subject to routing policy/health
Pix Out  -> AkkadPag only
Refund   -> disabled per provider until retained-provider audit proves an exact execution/recovery contract
```

FlevoPay Pix Out is explicitly unsupported in the audited legacy adapter, so V2 must reject that route locally rather than discover it after making an external request.

Provider selection and retained-provider evidence are tracked in `../reverse-engineering/provider-retention.md`.

## Provider-count rule

Two providers are the initial maximum, not the beginning of an automatic migration queue.

Adding a third processor requires:

1. an explicit product/architecture decision;
2. measurable operational or commercial value;
3. a provider capability contract;
4. conformance tests for create/recovery/webhook and every enabled monetary operation.

## Consequences

Benefits:

- only two external processor contracts must be maintained initially;
- fewer credentials, webhook boundaries and provider-specific failure modes;
- smaller router and test matrix;
- no unnecessary generic connector platform;
- direct fit with the TypeScript/Supabase V2 direction;
- provider knowledge remains close to SwiftPay conformance tests.

Costs:

- SwiftPay owns both adapters and their recovery behavior;
- payout redundancy is initially limited because audited FlevoPay does not support Pix Out;
- each retained provider still requires deep verification before production enablement.

## Retained-provider requirements

### AkkadPag

Before production enablement, prove:

- credential/config shape including `withdrawalKey`;
- Pix-create request/response and status mapping;
- payout request identity and recovery;
- correct handling of provider `Processing` as non-terminal where applicable;
- fail-closed webhook authentication replacing the unsafe legacy application path;
- unknown-result semantics without blind monetary retry;
- refund execution/recovery before refund capability is enabled.

### FlevoPay

Before production enablement, prove:

- credential/config shape;
- Pix-create/status/reference semantics;
- webhook authentication and deterministic event identity;
- unknown-result recovery without blind monetary retry;
- explicit `supports_pix_out = false` capability;
- refund execution/recovery before refund capability is enabled.

## Revisit triggers

Re-open the orchestration decision if:

1. SwiftPay expands materially beyond Pix;
2. a third processor has a concrete business/operational requirement;
3. the native orchestration layer grows beyond a thin router/adapter boundary; or
4. Hyperswitch or another orchestration layer can demonstrably replace meaningful operational complexity rather than merely move it.

## Invariants

- provider-specific payloads do not leak into the public SwiftPay API;
- provider credentials remain server-side;
- provider webhooks require explicit fail-closed verification;
- SwiftPay owns canonical payment and financial state;
- external ambiguity/recovery behavior is specified per retained provider;
- unsupported capabilities fail before external I/O;
- provider routing changes funding location, not merchant ownership or ledger semantics.