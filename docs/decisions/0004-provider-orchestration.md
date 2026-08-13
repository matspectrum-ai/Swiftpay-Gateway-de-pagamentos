# ADR 0004 — Provider Orchestration Strategy

Status: Accepted

Date: 2026-08-13

## Decision

Use **native thin provider adapters** for the first Pix-first SwiftPay V2 release.

Hyperswitch is not part of the initial runtime topology.

## Why

The audit found no first-party exact-brand Hyperswitch connector occurrence for any of the 12 legacy SwiftPay provider names. Retaining those providers would therefore still require SwiftPay to preserve and test provider-specific credentials, payloads, identifiers, status mappings and webhook behavior.

Adding Hyperswitch at this stage would introduce another runtime and another semantic boundary without proven reduction in connector work.

The legacy common provider surface is small enough to rebuild as a typed capability-oriented adapter layer, which fits the V2 goal of a small Supabase/PostgreSQL-centered architecture.

## Target shape

```text
SwiftPay API
  -> ProviderRouter
      -> PixProvider
          -> retained provider adapters
```

The provider interface will expose only supported capabilities. Pix-in, Pix-out and refund support are not assumed to be universal.

Provider selection and evidence are tracked in `../reverse-engineering/provider-retention.md`.

## Provider-count rule

Do not port all 12 providers by default. Prove one provider end-to-end, add a second when it gives meaningful redundancy/routing value, and add others only for measurable product or operational value.

## Consequences

Benefits:

- fewer services to deploy and observe;
- direct fit with the TypeScript/Supabase V2 direction;
- provider knowledge remains close to SwiftPay conformance tests;
- providers can be added or removed independently.

Costs:

- SwiftPay owns adapter maintenance and routing policy;
- each retained provider requires explicit conformance tests.

## Revisit triggers

Re-open this ADR if:

1. SwiftPay expands materially beyond Pix;
2. a significant retained provider set gains mature Hyperswitch connectors;
3. the native orchestration layer grows beyond a thin router/adapter boundary; or
4. Hyperswitch can demonstrably replace meaningful operational complexity.

## Invariants

- provider-specific payloads do not leak into the public SwiftPay API;
- provider credentials remain server-side;
- provider webhooks require explicit verification;
- SwiftPay owns canonical payment and financial state;
- external ambiguity/recovery behavior is specified per retained provider.