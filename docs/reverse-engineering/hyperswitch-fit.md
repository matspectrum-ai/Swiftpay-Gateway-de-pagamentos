# Hyperswitch Fit — SwiftPay Pix Provider Set

Status: Preliminary evidence; orchestration ADR remains open.

Checked: 2026-08-13

Hyperswitch repository examined: `juspay/hyperswitch`

Observed current ref from GitHub code-search results: `78197f4827c02fc05664b72046d5842f0a1c127a`.

## Question

Would adopting Hyperswitch materially reduce the amount of provider integration code SwiftPay V2 must own for the providers currently implemented in legacy SwiftPay?

## Method

For each current SwiftPay `AcquirerType`, search the current Hyperswitch repository for the exact provider brand name.

Where a term could collide with generic language (notably `ActivePayments` vs the generic analytics concept "active payments"), restrict search to:

`crates/hyperswitch_connectors`

The connector path was sanity-checked with `Stripe`, which returns the expected connector implementation under:

`crates/hyperswitch_connectors/src/connectors/stripe.rs`

This verifies that the search target includes actual Hyperswitch connectors.

## Results

| SwiftPay legacy provider | Exact-brand connector occurrence found in Hyperswitch connector code? |
|---|---:|
| Accithus | no |
| ActivePayments | no |
| AkkadPag | no |
| Bankizi | no |
| Coldfy | no |
| FlevoPay | no |
| HeartPay | no |
| HunterPay | no |
| IHubBanking | no |
| MagicPay | no |
| Pluggou | no |
| Rapdyn | no |

For FlevoPay, AkkadPag and Accithus, exact-brand searches returned zero across the repository. For the remaining names, connector-scoped searches returned zero. `ActivePayments` has unrelated matches in Hyperswitch analytics for the generic concept of active payments, but zero matches under the connector crate.

## What this establishes

There is currently no evidence that Hyperswitch ships first-party connectors under the exact brands used by any of SwiftPay's 12 current provider adapters.

Therefore, if V2 retains these providers under these integrations, adopting Hyperswitch should currently be budgeted as requiring custom connector work rather than assuming existing connector coverage.

## What this does NOT establish

This does not prove that all 12 integrations are impossible to map onto an existing Hyperswitch connector.

Remaining checks:

- determine whether any provider is white-labeling an upstream PSP already supported by Hyperswitch;
- determine whether current SwiftPay provider names differ from legal/company/processor names;
- identify which of the 12 providers are actually retained for V2;
- verify whether any retained provider has a private/community connector outside the main `juspay/hyperswitch` repository;
- compare Pix-out/payout support, not only Pix-in;
- verify provider-specific webhook and idempotency requirements against the Hyperswitch connector interface.

## Architectural implication

The original expected advantage of Hyperswitch was that it could absorb provider orchestration and connector maintenance.

For SwiftPay's current provider set, the connector-coverage evidence weakens that advantage materially:

```text
Hyperswitch path
SwiftPay
  -> Hyperswitch
      -> custom FlevoPay connector
      -> custom AkkadPag connector
      -> custom ... connectors

Native V2 path
SwiftPay
  -> small typed PixProvider interface
      -> FlevoPay adapter
      -> AkkadPag adapter
      -> ... retained adapters
```

In both paths SwiftPay must preserve/port the same external API knowledge if the connector does not already exist.

Hyperswitch would additionally introduce:

- a separate orchestration runtime;
- Rust connector implementation conventions;
- deployment/upgrade/observability responsibility for another service;
- mapping between Hyperswitch payment semantics and SwiftPay's canonical payment/ledger semantics.

It may still be justified if V2 requires enough of Hyperswitch's routing, retry, attempt, connector lifecycle or future expansion capabilities.

## Current engineering recommendation

Do **not** adopt Hyperswitch by default for the first Pix-only vertical slice.

Use the native thin-provider architecture as the current planning baseline unless subsequent evidence shows that:

1. a significant retained provider subset maps to existing Hyperswitch connectors, or
2. required orchestration features would otherwise cause SwiftPay's native provider layer to grow substantially beyond a thin adapter/router.

This is a planning recommendation, not a closed ADR. `docs/decisions/0004-provider-orchestration.md` remains open until the retained provider set and full webhook/payout audit are complete.

## Next evidence required

1. Mark legacy providers as `RETAIN | RETIRE | UNRESOLVED`.
2. Audit provider webhook handlers/auth/status converters for retained providers.
3. Audit provider clients/DTOs for external idempotency support and exact HTTP contracts.
4. Identify white-label/upstream relationships, if any.
5. Compare implementation effort for one representative connector (preferably AkkadPag or FlevoPay) in native TypeScript versus Hyperswitch Rust conventions before closing ADR 0004.