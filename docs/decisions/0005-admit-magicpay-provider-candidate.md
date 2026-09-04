# ADR 0005 — Admit MagicPay as Third Provider Candidate

Status: Accepted
Date: 2026-09-03

## Context

ADR 0004 selected native thin provider adapters and froze the initial V1 runtime provider set to AkkadPag and FlevoPay. It also established that adding a third processor requires an explicit product/architecture decision, measurable value, a provider capability contract and conformance tests before any enabled monetary operation.

The current SwiftPay product direction explicitly selects MagicPay for the next provider integration effort. Provider-owned MagicPay documentation and credentials have been supplied out-of-repository, and A28 already froze the non-authorizing authentication/request subset.

Additional provider-owned documentation evidence supplied on 2026-09-03 now exposes the create-sale success/error envelope, the find-sale response envelope and the Pix `expiresInDays` request option.

## Decision

MagicPay is admitted as the third SwiftPay provider **candidate**.

This ADR changes only the provider scope decision from ADR 0004. It does not change the native-thin-adapter architecture and it does not authorize runtime traffic.

The provider candidate set is now:

1. AkkadPag
2. FlevoPay
3. MagicPay

MagicPay may receive provider-specific specs, contracts, normalization code and conformance tests.

MagicPay MUST NOT receive Production monetary authority until the existing activation/recovery gates are satisfied.

## Runtime authority remains unchanged

Acceptance of MagicPay as a provider candidate is not equivalent to:

- A10 registration or activation;
- `sandbox_proven`;
- `production_enabled`;
- A11 monetary binding;
- authenticated provider proof;
- permission to create a payable Pix;
- permission to process a MagicPay postback as authoritative;
- permission to withdraw, refund or anticipate funds.

Until a later explicit activation slice, SwiftPay repository defaults continue to authorize zero MagicPay provider operations.

## Required MagicPay gates before live Pix create

At minimum:

1. provider-owned request and response contract;
2. canonical Pix payload semantics;
3. exact transaction query contract;
4. provider idempotency semantics or an equivalent safe create identity;
5. ambiguous-create recovery after timeout/connection loss;
6. environment classification and authenticated safe proof;
7. webhook authenticity/replay contract or an explicitly approved polling/reconciliation substitute;
8. fail-first live-adapter/A11 bridge tests;
9. deliberate A10 activation transition.

## A29 consequence

A29 is permitted to implement only network-free MagicPay response/query normalization and request construction based on the newly supplied provider documentation.

A29 does not implement or export a live MagicPay adapter and does not modify A10/A11 authority.

## Relationship to ADR 0004

ADR 0004 remains accepted for:

- native thin provider adapters;
- capability-oriented routing;
- provider invisibility;
- fail-before-I/O for unsupported capabilities;
- explicit provider evidence and recovery requirements.

This ADR supersedes only ADR 0004's exact two-provider maximum for the current product direction.

## Invariants

- provider-specific payloads remain private to the provider layer;
- provider credentials remain server-side and out of durable documentation;
- no external ambiguity is converted into definitive failure without evidence;
- no provider webhook is financially authoritative without explicit verification;
- SwiftPay owns canonical payment/ledger state;
- addition of MagicPay must not weaken default-deny activation semantics.
