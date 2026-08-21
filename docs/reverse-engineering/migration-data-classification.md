# Legacy -> SwiftPay V2 Data Migration Classification

Status: initial migration classification complete; cutover mapping and production data evidence still required

Date: 2026-08-13
Legacy reference: `SwiftPay-Prod/swiftpay---Prod@f60a515d2bbfa6ed8142f46fa778fb27068a700d`

## Purpose

This document classifies legacy SwiftPay data into four primary migration dispositions:

- `MIGRATE` — authoritative data needed by the V2 live product;
- `RECOMPUTE` — derived data that must be rebuilt from canonical sources;
- `ARCHIVE` — retain for history/compliance/support but do not import into the active V2 domain model by default;
- `DISCARD` — ephemeral/cache/runtime data with no legitimate migration value.

A fifth classification is used for financially dangerous live state:

- `RECONCILE_AT_CUTOVER` — cannot be copied mechanically; must be reconciled, frozen/snapshotted and converted under an explicit cutover procedure.

This is a classification contract, not a migration script.

## Core rule

> Never migrate a legacy derived balance, cache or status merely because a column exists.

For every migrated value we must know whether it is:

1. canonical business truth;
2. financial evidence;
3. a projection/cache;
4. ephemeral runtime state;
5. obsolete product data.

## Identity and merchant data

| Legacy data | Classification | V2 treatment |
|---|---|---|
| User identity/profile | `MIGRATE / REPLACE AUTH` | Preserve user identity/profile fields that are required. Supabase Auth becomes the identity provider; legacy password/session/token machinery is not migrated mechanically. |
| Merchant core identity | `MIGRATE` | Merchant ID mapping, legal/display identity, contact data and lifecycle state required by the retained product. |
| Merchant onboarding step | `DISCARD / RECOMPUTE` | Legacy step is UI workflow state. V2 onboarding/KYC state machine is different. |
| Merchant KYC status | `MIGRATE WITH VALIDATION` | Preserve evidence of prior decision only after validating that the case/evidence is acceptable under V2 compliance/provider requirements. |
| Merchant KYC fields | `MIGRATE SELECTIVELY` | Copy only retained Pix-first/compliance fields. Do not carry card/boleto-only requirements automatically. |
| KYC pending/complement items | `ARCHIVE` or `MIGRATE OPEN CASES` | Resolved historical requests are audit history. Open cases need explicit conversion into V2 review requests. |
| KYC documents | `MIGRATE WITH IMMUTABLE VERSIONING` | Copy accepted/current evidence into private V2 storage with hash, ownership, purpose and version metadata. Preserve legacy reference for audit. |
| Generic public merchant assets | `MIGRATE SELECTIVELY` | Logos/checkout assets only when referenced by retained V2 surfaces. |
| User/merchant preferences | `MIGRATE SELECTIVELY` | Only low-cost preferences with direct V2 equivalents. Do not block cutover on cosmetic state. |

## Authentication and secrets

| Legacy data | Classification | V2 treatment |
|---|---|---|
| Access/refresh tokens | `DISCARD` | All sessions expire at migration/cutover. |
| Trusted-device/session runtime state | `DISCARD` by default | Re-establish under V2 auth/security policy unless a specific risk requirement says otherwise. |
| Password hashes/custom auth internals | `DO NOT DIRECTLY MIGRATE` by default | Use Supabase Auth account migration/invitation/reset strategy defined separately. |
| API credential Client IDs | `MIGRATE SELECTIVELY` | Can preserve public IDs only if backward compatibility is approved. |
| API credential secret hashes | `ROTATE PREFERRED` | V2 changes credential/security model. Prefer issuing replacement secrets rather than silently carrying legacy credentials. If compatibility requires hash migration, prove algorithm/semantics and retain immediate revocation behavior. |
| API credential confirmation OTPs | `DISCARD` | Ephemeral challenges. |
| Provider secrets/credentials | `MIGRATE VIA SECRET PROCEDURE` | Never dump into general migration datasets. Re-enter or transfer through a controlled encrypted secret path and validate provider connectivity. |
| Webhook signing secrets | `REPLACE/ROTATE` | Legacy merchant webhook scheme is cryptographically weak. V2 endpoint secrets must be newly generated. |

## Provider configuration

| Legacy data | Classification | V2 treatment |
|---|---|---|
| Provider catalog | `MIGRATE SELECTIVELY` | Only retained providers/adapters. |
| Merchant-provider bindings | `MIGRATE SELECTIVELY` | Convert retained routing/default/allowed provider relationships. |
| Provider fee configuration | `MIGRATE WITH CONTRACT MAPPING` | Only after V2 fee/provider cost semantics are finalized. |
| Provider nominal/routing historical state | `ARCHIVE / RECOMPUTE` | Do not copy dynamic routing/cache state blindly. |
| Provider access-account/support metadata | `MIGRATE SELECTIVELY` | Only if operationally needed by retained adapters. |
| Provider dashboard/ranking caches | `DISCARD` | Derived. |

## Payments and sales

### Historical terminal payments

Completed/failed/expired/cancelled legacy payments are valuable for merchant history, support and migration parity, but their broad legacy entity shape must not dictate V2.

Recommended disposition:

- `ARCHIVE` full legacy records in immutable historical storage/read-only schema;
- `MIGRATE SELECTIVELY` a normalized payment-history projection if the V2 UI must show old sales alongside new sales;
- never replay historical terminal payments into the new live ledger as if they were new events.

Fields worth preserving in a normalized history include:

- legacy payment ID;
- merchant ID;
- external/reference ID;
- method;
- amount/fees/net snapshot;
- status;
- provider/reference IDs needed for support/reconciliation;
- environment;
- source (API/checkout/payment link where known);
- created/completed/refunded timestamps;
- customer reference/limited customer snapshot where legally appropriate;
- metadata/UTM fields that are safe and useful;
- link to immutable legacy record/audit evidence.

### Card and boleto

- historical card/boleto payments: `ARCHIVE`, optionally normalized for merchant history;
- card PAN/CVV or other high-risk legacy fields: **must not be copied into V2**;
- boleto runtime-specific fields: archive only unless needed for historical support.

V2 remains Pix-first.

### Pending/open payments

Payments that are non-terminal at cutover are `RECONCILE_AT_CUTOVER`.

They require provider-aware treatment because the external PSP can still complete them after the migration snapshot.

Possible cutover strategies must be explicitly chosen later:

1. let legacy drain all pre-cutover Pix charges until expiration;
2. route legacy provider webhooks to a migration bridge until old charges become terminal;
3. import open charges into a compatibility table with strict provider/source identity;
4. reject new legacy creation during a controlled freeze and wait for the remaining exposure window.

Do not blindly copy `Pending` rows and assume V2 owns their lifecycle.

## Refunds

| Refund-related data | Classification | V2 treatment |
|---|---|---|
| Historical full refunds | `ARCHIVE / NORMALIZE` | Preserve payment/refund history; do not invent V2 refund IDs from ambiguous legacy events without mapping evidence. |
| Historical partial refunds | `ARCHIVE + RECONSTRUCT CAREFULLY` | Legacy partial identity can be ambiguous. Never fabricate exact event identity from payment+amount alone. |
| Refunds in progress/unknown at cutover | `RECONCILE_AT_CUTOVER` | Provider query/webhook/manual reconciliation required before funds are released or V2 assumes final state. |

## Ledger and balances

This is the highest-risk migration area.

### Legacy ledger history

`LedgerTransaction` and `LedgerEntry` are financial evidence.

Recommended strategy:

- preserve the full legacy ledger in an immutable archive/read-only migration schema;
- do **not** transform years of legacy entries into V2 posting semantics unless a tested replay mapping proves equivalence;
- create explicit V2 opening-balance postings at cutover for the liabilities/assets that survive, backed by a reconciled cutover snapshot.

### Account.Balance caches

Legacy mutable `Account.Balance` values are `RECOMPUTE / RECONCILE`, never authoritative migration input by themselves.

At cutover:

```text
legacy ledger-derived balance
        vs
legacy Account.Balance cache
        vs
provider/external settlement evidence
        vs
open payouts/refunds/reserves
```

must reconcile under a signed-off procedure.

### Opening balance

V2 should represent migrated money through a special migration source, for example:

```text
source_type = migration_opening_balance
source_id   = cutover_snapshot_id
```

Opening postings must be immutable, documented and linked to the reconciliation snapshot.

Do not insert arbitrary account balances without ledger entries.

## Balance buckets / financial obligations

| Legacy state | Classification | V2 treatment |
|---|---|---|
| Merchant available | `RECONCILE_AT_CUTOVER` | Convert into V2 opening liability only after ledger/provider reconciliation. |
| Merchant pending | `RECONCILE_AT_CUTOVER` | Depends on unresolved payments/settlement. Do not treat as immediately available. |
| Merchant reserved | `RECONCILE_AT_CUTOVER` | Preserve only if the target reserve contract remains. Must account for known legacy reconciliation defects. |
| Merchant blocked | `RECONCILE_AT_CUTOVER` | Usually tied to payouts in progress; migrate together with payout execution state. |
| Merchant payouts-out | `ARCHIVE / RECOMPUTE` | Historical accounting evidence, not a seller balance bucket to copy directly. |
| Provider settlement/out accounts | `RECONCILE_AT_CUTOVER` | Must be reconciled against PSP evidence and target chart of accounts. |
| Platform blocked/payout accounts | `RECONCILE/DEFER` | Depends on final platform fund-flow contract. |

## Payouts / Pix-out

### Historical terminal payouts

`ARCHIVE` full legacy records; optionally migrate normalized payout history for merchant/admin UI.

### Pending/processing/confirming payouts

`RECONCILE_AT_CUTOVER`.

These cannot move between systems as ordinary rows because external execution may already have happened while the legacy system has an incomplete/ambiguous response.

Cutover must identify at least:

- requested but not externally submitted;
- submitted and provider-processing;
- execution-unknown;
- webhook-confirmed completed;
- definitively failed/rejected/cancelled.

Blocked funds move with the payout's reconciled state.

## Payout destinations / Pix keys

Merchant payout accounts/destinations are `MIGRATE SELECTIVELY` after:

- ownership validation;
- supported Pix key-type mapping;
- active/default-state normalization;
- removal of obsolete/invalid records;
- any required step-up/reverification policy.

## Wallet top-up

Legacy does not provide the canonical V2 wallet-top-up contract described in the new product vision.

No legacy sale should be reclassified as a top-up during migration.

V2 top-up begins as a new explicit source type after its fund-flow contract is approved.

## Customers

Customer data is `MIGRATE SELECTIVELY / ARCHIVE`.

V2 should not import synthetic fallback identity as trustworthy customer data.

Before live migration, classify values that may have been generated by legacy fallback behavior and either:

- exclude them;
- mark them as synthetic/unverified in archive;
- retain only within historical payment snapshots.

A customer record is not required for every V2 Pix payment unless product/provider requirements demand it.

## Checkout and Payment Links

| Data | Classification | V2 treatment |
|---|---|---|
| Active Payment Links | `MIGRATE WITH MAPPING` | Important merchant-facing URLs may require redirect/slug compatibility. Convert into V2 link schema over Payment Core. |
| Historical/inactive Payment Links | `ARCHIVE` | Keep for support/history unless URLs must continue resolving. |
| Active checkout definitions | `MIGRATE SELECTIVELY` | Convert only fields supported by V2 minimal checkout/branding schema. |
| Legacy checkout templates | `ARCHIVE / DISCARD FROM LIVE` | Do not migrate full template runtime architecture. |
| Checkout branding assets | `MIGRATE SELECTIVELY` | Logos/colors/domains that map cleanly to V2. |
| Products/orders/stock | `ARCHIVE` | Not V1 live domains. |
| Coupons | `ARCHIVE / DEFER` | No active migration unless coupon capability is explicitly activated. |

### URL compatibility

Payment Link/Checkout public URLs require a separate compatibility decision.

Options include:

- preserve selected slugs/IDs;
- maintain legacy redirect table;
- serve old historical links from compatibility routing for a bounded period;
- expire unsupported legacy commerce links with an explicit merchant migration notice.

Never silently break active seller links without an inventory and migration rule.

## Integrations and webhooks

| Data | Classification | V2 treatment |
|---|---|---|
| Utmify/Otimizey/Facebook CAPI configuration | `MIGRATE SELECTIVELY` | Only after secrets/config schema is mapped and connection revalidated. |
| `coming soon` integration cards | `DISCARD` | UI text is not operational configuration. |
| Legacy per-payment callback URLs | `ARCHIVE / COMPATIBILITY` | Historical callback data is not a V2 endpoint-secret model. |
| Merchant webhook endpoint config if present | `MIGRATE URL, ROTATE SECRET` | Preserve endpoint intent where valid; issue a new V2 signing secret. |
| Webhook delivery attempts/logs | `ARCHIVE` | Useful audit history; do not mix with new delivery IDs/retry state. |
| External tracking events | `ARCHIVE / RECOMPUTE` | V2 conversion truth begins from canonical V2 event taxonomy; import historical analytics only if product requires cross-cutover reporting. |

## Analytics, dashboard and ranking

These are derived data.

`RECOMPUTE` or `DISCARD`:

- merchant dashboard caches;
- admin dashboard caches;
- provider/acquirer dashboard caches;
- platform balance caches that are not canonical ledger truth;
- seller ranking cache;
- provider ranking cache;
- referral ranking cache;
- precomputed trends/KPIs.

If historical charts across the cutover boundary are required, build a normalized historical analytics projection from archived canonical payment records rather than migrate cache tables.

## Commerce/growth domains

Default classification for V1:

- orders: `ARCHIVE`;
- physical/digital/service products: `ARCHIVE`;
- stock: `ARCHIVE`;
- coupons: `ARCHIVE`;
- digital delivery: `ARCHIVE`;
- achievements: `DISCARD LIVE / ARCHIVE IF DESIRED`;
- referrals/commissions: `ARCHIVE`, unless a separate business migration is approved;
- bulletins: `DISCARD/ARCHIVE`;
- legacy ranking state: `DISCARD`, recompute only after V2 ranking contract exists.

These domains must not delay the financial V2 cutover unless the business explicitly elevates one to required scope.

## Notifications and communications

- unread/read in-app notifications: `DISCARD` by default or migrate only a small recent actionable set;
- push tokens/device tokens: `DISCARD`, re-register clients;
- email send job state: `DISCARD` once terminal, except immutable delivery/audit evidence as archive;
- email templates: `ARCHIVE`, selectively recreate V2 templates;
- security logs/audit events: `ARCHIVE`, with selected high-value records accessible to support/compliance.

## Queue/job/runtime data

`DISCARD`:

- RabbitMQ broker state as migration input;
- MassTransit transport state;
- Hangfire job storage;
- Valkey/Redis cache/runtime keys;
- dashboard-processing locks;
- stale scheduled-job state;
- ephemeral SignalR connection state;
- Firebase runtime/push state.

Any business operation represented only by queue state must first be reconciled back to its canonical domain object before cutover.

## Logs

Operational application logs are `ARCHIVE`, not migrated into active transactional tables.

Security/audit logs with compliance/support value should be retained under an explicit retention policy.

V2 observability starts with new structured event IDs/correlation IDs rather than continuing legacy log identifiers as runtime state.

## Environment handling

Sandbox and Production records must remain explicitly separated during migration.

Default:

- production canonical/history data: eligible for migration/archive;
- sandbox financial data: `DISCARD` or archive for developer history only;
- sandbox API credentials: replace/reissue;
- sandbox checkout/link fixtures: migrate only if needed for merchant developer continuity.

No sandbox financial amount can contribute to V2 production opening balances.

## Cutover financial snapshot

Before financial migration, create a durable `cutover_snapshot` containing or referencing at least:

- cutover timestamp/window;
- legacy commit/deployment version;
- merchant account balances derived from ledger;
- legacy account-cache balances for comparison;
- open Pix payments;
- open refunds;
- open payouts and blocked amounts;
- provider balances/settlement evidence available at that time;
- reserve obligations if retained;
- reconciliation discrepancies and their disposition;
- normalized record counts/checksums;
- reviewer/approver identity.

No opening balance is posted until the snapshot passes defined reconciliation tolerances.

## Recommended cutover pattern

The safest simple pattern is not a giant one-shot ORM copy.

```text
1. inventory + dry-run
2. migrate static merchant/config data
3. migrate/archive historical read-only data
4. create/validate V2 identities and credentials
5. freeze legacy creation or route new creation to V2
6. snapshot + reconcile financial obligations
7. allow legacy open charges/payouts to drain or bridge explicitly
8. post V2 opening balances through migration ledger source
9. verify merchant totals and provider totals
10. enable V2 financial actions
11. keep legacy read-only/archive available
```

Exact sequencing depends on whether a dual-run/bridge is practical.

## Migration invariants

1. Historical terminal events are never replayed as new live money movement.
2. Mutable legacy balance caches never become V2 balances without ledger/provider reconciliation.
3. Every V2 opening monetary amount has a ledger posting and cutover snapshot source.
4. Open provider operations are resolved/bridged; they are never assumed failed because migration occurred.
5. Card-sensitive data is not copied into the Pix-only V2.
6. Synthetic legacy customer identity is not promoted to verified V2 identity.
7. New webhook/API secrets are rotated unless compatibility has an explicitly proven secure migration path.
8. Sandbox money never enters Production.
9. Derived dashboard/ranking data is recomputed, not migrated as truth.
10. Active public checkout/payment-link URLs receive an explicit compatibility decision before cutover.
11. Archive data remains distinguishable from V2 canonical live-domain data.
12. Migration is repeatable/idempotent in dry runs through stable legacy->V2 mapping tables.

## Required migration mapping tables

For dry-run/cutover, V2 should maintain explicit technical mappings such as:

```text
migration_runs
migration_entity_map
migration_cutover_snapshots
migration_reconciliation_results
```

`migration_entity_map` should map stable legacy IDs to V2 IDs where IDs are not preserved and make repeated imports deterministic.

## Open evidence gates

This classification does not prove actual production row counts or feature usage.

Before a real cutover we still need safe production/configuration evidence for:

- active merchants;
- active provider bindings;
- active API credentials;
- active public Payment Links/Checkouts;
- non-zero reserve/blocked/pending balances;
- open payouts/refunds/payments;
- provider settlement balances;
- actual usage of legacy commerce/growth domains;
- retention/legal requirements for KYC, logs and payment history.

## Reconstruction implication

V2 migration can stay substantially simpler if we refuse to migrate architecture-derived state.

The live V2 needs a small set of authoritative merchant/configuration records, reconciled financial opening state and optional normalized history. Most caches, queue state, broad commerce modules and runtime infrastructure should be recomputed, archived or discarded instead of becoming permanent V2 complexity.