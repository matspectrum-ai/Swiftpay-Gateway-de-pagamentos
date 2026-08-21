# SwiftPay V2 — Sandbox Contract

Status: Phase 1 foundational contract

## Objective

Sandbox must let merchants test the same public concepts as Production without any possibility of moving or fabricating Production money.

## Environment isolation

Sandbox and Production are distinct scopes across:

- API credentials/tokens;
- merchants' financial resources;
- Payments/Refunds/Payouts;
- provider accounts;
- ledger accounts/postings;
- idempotency keys;
- webhook endpoints/events/deliveries;
- analytics/conversion events.

A Sandbox identifier/key cannot be used to mutate or resolve a Production resource, and vice versa.

Environment is enforced in trusted backend/database identity, not only hidden by the UI.

## No Production simulation

Simulation operations are structurally unavailable for Production.

A server/database guard rejects any simulation command whose target/resource environment is not Sandbox, regardless of caller role.

Admin privilege does not bypass this invariant.

## Same public mental model

Sandbox should mirror the merchant-facing flow closely:

```text
create Pix -> pending -> simulate paid/expired
request payout -> processing -> simulate completed/failed/unknown where supported
request refund -> processing -> simulate completed/failed/unknown where supported
merchant webhook delivery
balance/ledger projection
```

The same canonical domain states/posting templates are used, but Sandbox provider execution is replaced by deterministic simulator evidence.

Do not create a separate fake domain model.

## Deterministic simulator

Simulator actions are explicit, auditable and idempotent.

Each simulation command has a stable source ID and applies at most once financially.

Supported test scenarios include at least:

```text
Pix pending -> paid
Pix pending -> expired
late paid after expired
provider create execution_unknown -> recovered pending/paid
payout completed
payout definitively failed
payout execution_unknown -> later completed/failed
refund completed
partial refunds, including repeated equal amounts
refund execution_unknown -> later terminal
merchant webhook retry/failure
```

Invalid state transitions are rejected by the same domain rules as Production.

## Provider adapter boundary

Sandbox does not require every real PSP to offer a provider sandbox. The SwiftPay deterministic simulator is sufficient for canonical domain/API testing.

Provider-specific conformance tests may use a PSP sandbox/stub separately. Those tests prove the adapter contract and do not weaken SwiftPay Sandbox isolation.

## Data clarity

Every Sandbox response/resource is visibly marked as Sandbox where ambiguity could cause operational mistakes.

Sandbox data never contributes to Production:

- revenue;
- conversion metrics;
- seller ranking;
- wallet balance;
- provider settlement;
- treasury reporting.

## Webhooks

Sandbox may deliver real HTTP webhooks to merchant-configured Sandbox endpoints so integrations can be tested end-to-end. Payloads/event IDs remain environment-scoped and cannot be replayed into Production processing.

## Reset/seed

Development/testing may provide deterministic Sandbox reset/seed workflows. Reset cannot target Production and cannot be implemented as an environment parameter trusted directly from the browser.

## Required fail-first tests

1. Sandbox credential cannot access Production resource;
2. Production credential cannot invoke simulator;
3. admin/operator cannot simulate a Production financial transition;
4. Sandbox idempotency key does not collide with Production scope;
5. simulated paid uses the same canonical payment/ledger template as Production evidence;
6. duplicate simulation source cannot double-post ledger;
7. invalid simulated transition is rejected;
8. repeated equal partial refunds remain distinct and reconcile correctly;
9. unknown payout/refund simulation preserves blocked funds until terminal resolution;
10. Sandbox webhooks are signed/delivered by the normal merchant-webhook machinery;
11. Sandbox sales never appear in Production analytics/ranking/balance;
12. reset/seed path cannot affect Production rows.
