# SwiftPay V2 — Financial Invariants

Status: Foundational contract. Exact posting rules are still pending fund-flow analysis.

These invariants apply to every future implementation of payments, fees, balances, refunds and payouts.

## 1. Monetary representation

- BRL amounts are integer centavos.
- Floating-point values are forbidden for persisted or calculated financial amounts.
- Percentage rates use integer basis points unless a later ADR explicitly changes the representation.
- Rounding rules must be deterministic and covered by tests.

## 2. Ledger authority

- The ledger is the authoritative record of financial movement.
- A payment status is not itself a balance.
- A dashboard KPI is not a balance.
- Provider-reported balance is reconciliation evidence, not a substitute for the internal ledger.
- Cached balances may exist only as transactional read optimizations that can be reconciled against entries.

## 3. Immutability

- Posted ledger entries are append-only.
- Corrections use compensating/reversal postings.
- Historical monetary rows are not edited to make balances appear correct.
- Financial snapshots used by a transaction (fee, provider cost assumptions, settlement amount) are preserved with the source transaction.

## 4. Idempotency

Every financial effect has a stable source identity.

At minimum:

- one Pix payment completion event cannot credit the merchant twice;
- one refund event cannot debit twice;
- one payout request cannot reserve/debit funds twice;
- one payout completion event cannot finalize twice;
- webhook redelivery cannot reproduce a financial posting.

Database uniqueness must enforce critical idempotency where possible.

## 5. Atomicity

When a canonical state transition creates a financial effect, the state transition and the corresponding ledger posting should occur in the same PostgreSQL transaction whenever technically possible.

Examples:

- payment `pending -> paid` + payment settlement posting;
- payout `requested -> processing` + available-to-blocked movement;
- payout `processing -> completed` + blocked-to-payout-out movement;
- payout failure + blocked-to-available release.

External provider calls occur outside the database transaction and require explicit recovery states.

## 6. No hidden balance mutation

Application code must not arbitrarily increment/decrement balance fields without an associated ledger transaction or approved database posting function.

Any cached account balance update must occur inside the same transaction as its ledger entries.

## 7. Tenant and environment scope

Every merchant financial object is scoped by:

- merchant;
- environment;
- currency where applicable.

Cross-merchant postings require an explicit platform/provider account relationship and must never be produced by a missing filter or implicit default.

## 8. Provider invisibility

Provider fees, provider transaction identifiers and provider-specific settlement mechanics are internal unless a public contract explicitly exposes a normalized equivalent.

Merchant-facing financial values must use SwiftPay-defined semantics.

## 9. Fee snapshot

At payment creation, the pricing decision used for that payment becomes immutable financial evidence.

The payment should be able to explain:

- gross amount;
- merchant/platform fee charged;
- provider cost when known/estimated;
- merchant net amount;
- reserve/settlement amount if applicable;
- pricing rule/version that produced the values.

Changing merchant pricing later must not mutate historical payments.

## 10. Provider fee vs merchant fee

The fee charged to the merchant and the cost charged by the provider are distinct concepts.

`platform_revenue` or equivalent economic result must not be inferred by conflating them.

If provider cost is not known at authorization/creation time, the system must define when it becomes authoritative and how reconciliation corrects estimates.

## 11. Negative balances

Negative merchant available balance is forbidden by default.

Any business case that permits debt/negative balances requires an explicit ADR and account-level policy.

Payout reservation must use an atomic sufficient-balance check.

## 12. Payout reservation

If payouts are included:

- requesting/approving a payout reserves funds before the external transfer;
- reserved funds are not simultaneously available for another payout;
- provider failure releases or moves the reservation according to an explicit state machine;
- unknown provider result must not silently release funds until outcome is reconciled.

## 13. Refunds

If refunds are included:

- total refunded amount cannot exceed the original eligible amount;
- partial refunds are cumulative and concurrency-safe;
- merchant financial impact is deterministic;
- fee refund policy is explicit rather than assumed;
- provider and internal refund identifiers are idempotent;
- insufficient internal merchant balance behavior is specified before implementation.

## 14. Webhook ordering

Provider webhook ordering cannot be trusted.

State transitions must reject or safely absorb stale/duplicate events. A later stale `pending` event must not move a paid payment backward.

## 15. Unknown external result

An HTTP timeout or connection failure after calling a provider is not proof the external operation failed.

The system must preserve an `unknown/recovery-needed` internal condition or equivalent and reconcile by stable provider/client idempotency reference before retrying an operation that could duplicate money movement.

## 16. Reconciliation

The system must be able to compare at least:

- internal payment state;
- internal ledger;
- provider transaction state;
- provider settlement/payout state where available.

Discrepancies are recorded and corrected through explicit adjustment/reversal transactions, never by editing history silently.

## 17. Auditability

Every privileged financial action must record:

- actor/system identity;
- operation;
- source object;
- timestamp;
- reason when manual;
- resulting financial transaction reference.

Sensitive values and secrets are excluded from audit payloads.

## 18. Database-enforced invariants target

The schema should enforce, where applicable:

- non-negative transaction amounts;
- unique merchant external/idempotency keys in their defined scope;
- unique provider webhook event identity/hash;
- unique ledger source posting identity;
- valid debit/credit amount (> 0);
- valid transaction/account currency match;
- payout amount > 0;
- no duplicate active credential identifiers;
- valid state transitions through controlled functions when financial effects are involved.

## 19. Required test classes before financial implementation

At minimum:

- duplicate payment-completed webhook;
- concurrent duplicate payment-completed webhook;
- stale/out-of-order webhook;
- duplicate ledger command;
- payout race against same available balance;
- payout provider timeout/unknown result;
- payout failure releases exactly once;
- fee boundary/rounding cases;
- cross-merchant RLS/access attempt;
- transaction rollback after injected failure between state and posting;
- ledger recomputation equals cached/read balance.

## 20. Open financial decisions

The following are intentionally unresolved until fund-flow/provider analysis is complete:

- exact chart of accounts;
- whether merchant reserve exists in V2;
- compensation/settlement delay semantics;
- provider auto-split treatment;
- refund fee policy;
- platform settlement/payout accounting;
- whether provider-specific merchant balance buckets survive;
- whether all providers use the same fund-flow model.

No code should invent answers to these questions.