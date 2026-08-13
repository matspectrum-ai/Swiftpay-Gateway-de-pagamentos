# ADR 0004 — Provider Orchestration Strategy

Status: Proposed / Open

Date: 2026-08-13

## Decision to make

Choose the provider execution layer for SwiftPay V2 Pix operations.

The two current candidates are:

1. native thin SwiftPay Pix adapters;
2. Hyperswitch configured as a Pix-only orchestration engine.

No implementation may accidentally make this choice before the legacy provider audit and target requirements are complete.

## Option A — Native thin Pix adapters

### Shape

```text
SwiftPay Gateway
  -> ProviderRouter
      -> PixProvider interface
          -> FlevoPay
          -> AkkadPag
          -> other retained PSPs
```

### Advantages

- smallest runtime and deployment topology;
- direct fit for a Pix-only product;
- straightforward port of existing provider-specific knowledge;
- provider contract can stay extremely small;
- no unused card/boleto/wallet orchestration surface;
- easiest integration with a Supabase-centered modular monolith.

### Costs

- SwiftPay owns provider lifecycle, retries and routing;
- connector maintenance remains internal;
- advanced orchestration features must be implemented if later needed.

## Option B — Hyperswitch Pix-only

### Shape

```text
SwiftPay Gateway
  -> Hyperswitch
      -> PSP connector(s)
```

SwiftPay remains authoritative for merchant, KYC, pricing, ledger, balance, payout business rules and merchant webhooks.

### Advantages

- mature orchestration concepts;
- payment attempts/routing foundation;
- future multi-provider capabilities;
- possible reduction in orchestration code owned directly by SwiftPay.

### Costs

- another runtime/service to deploy and operate;
- Brazilian providers may require custom connectors;
- existing SwiftPay provider quirks still need to be ported and tested;
- semantic integration with SwiftPay fees/ledger must remain explicit;
- much of Hyperswitch's broader payment-method surface is unused in Pix-only V2.

## Evidence required before decision

The decision must not be based on feature lists alone. Phase 0 must establish:

- which legacy Pix providers are actually retained;
- which retained providers already have suitable Hyperswitch connectors;
- effort to port FlevoPay/AkkadPag/other required providers;
- whether provider routing/failover sophistication is needed at first release;
- whether Pix-out/payout support fits the same orchestration boundary;
- deployment/observability cost of Hyperswitch versus native adapters;
- public API compatibility implications;
- provider webhook normalization implications;
- operational ownership expectations.

## Default if evidence is inconclusive

Prefer the smaller native adapter architecture for the first Pix-only release.

This is a simplicity default, not a final decision. Hyperswitch should win only if it removes enough real provider/orchestration work to justify the additional service boundary.

## Non-negotiable regardless of choice

- provider-specific payloads do not leak into the public SwiftPay API;
- provider credentials remain server-side;
- provider webhooks are authenticated and idempotent;
- canonical payment state belongs to SwiftPay;
- SwiftPay financial ledger remains authoritative;
- provider timeout/unknown-result recovery must be explicit;
- connector behavior must have conformance tests derived from legacy evidence.