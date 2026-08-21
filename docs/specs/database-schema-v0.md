# SwiftPay V2 — Database Schema v0

Status: Phase 1 implementation specification; migrations must be preceded by fail-first database tests

## Objective

Define the minimum PostgreSQL/Supabase schema required for the first vertical slice:

```text
signup
-> merchant
-> KYC
-> approve
-> API credential
-> create Pix
-> provider evidence
-> ledger
-> balance
-> merchant webhook
```

This is not the full product schema. Checkout, Payment Links, Conversion, Automations, Ranking and Wallet Top-up are added in later vertical slices over the same canonical cores.

## Schema boundary

Use a server-owned PostgreSQL schema:

```text
app
```

Canonical financial/domain tables live in `app`, not in a browser-writable exposed schema.

Supabase `auth.users` is the identity source for dashboard users. Application membership/authorization lives in `app.merchant_members`.

The `public` schema is reserved for deliberately exposed views/functions if a later product requirement justifies direct Supabase Data API access. No financial mutation depends on direct browser writes.

RLS remains defense in depth where roles can reach a table; trusted SwiftPay backend/database functions remain the financial authorization boundary.

## Global conventions

- Primary IDs are UUIDs. Ordering must never depend on UUID lexical order.
- Timestamps are `timestamptz` in UTC.
- Money is `bigint` integer centavos.
- Basis points are integer values.
- Financial status values are constrained text or domain/check constraints rather than silently accepting arbitrary strings.
- `created_at` is immutable after insert.
- Monetary/pricing snapshots are immutable after resource creation except fields explicitly defined as cumulative projections.
- Sandbox and Production are explicit environment columns on environment-scoped resources.
- Provider credentials/secrets are never browser-readable.
- Ledger entries are append-only.

Canonical environment values:

```text
sandbox
production
```

## Identity and merchant

### `app.merchants`

```text
id uuid PK
name text NOT NULL
lifecycle_status text NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
suspended_at timestamptz NULL
closed_at timestamptz NULL
```

Allowed lifecycle:

```text
draft | active | suspended | closed
```

Merchant lifecycle does not encode KYC state.

### `app.merchant_members`

```text
merchant_id uuid NOT NULL FK merchants
user_id uuid NOT NULL FK auth.users
role text NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
PRIMARY KEY (merchant_id, user_id)
```

Initial roles can remain small:

```text
owner | admin | member
```

Fine-grained permissions may be added later; do not copy the legacy role surface by default.

## KYC

### `app.kyc_cases`

```text
id uuid PK
merchant_id uuid NOT NULL FK merchants
status text NOT NULL
requirement_profile_version text NOT NULL
submitted_at timestamptz NULL
decided_at timestamptz NULL
decision_reason text NULL
reviewed_by uuid NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Allowed status:

```text
draft | submitted | under_review | needs_information | approved | rejected
```

At most one current/non-terminal case per merchant unless a future re-verification contract defines otherwise.

### `app.kyc_documents`

```text
id uuid PK
kyc_case_id uuid NOT NULL FK kyc_cases
merchant_id uuid NOT NULL FK merchants
purpose text NOT NULL
version integer NOT NULL CHECK version > 0
storage_path text NOT NULL
detected_mime_type text NOT NULL
size_bytes bigint NOT NULL CHECK size_bytes > 0
sha256 text NOT NULL
status text NOT NULL
uploaded_by uuid NOT NULL
created_at timestamptz NOT NULL
submitted_at timestamptz NULL
```

Uniqueness:

```text
UNIQUE (kyc_case_id, purpose, version)
UNIQUE (storage_path)
```

Submitted evidence is immutable. Replacement creates a new version.

### `app.kyc_review_requests`

```text
id uuid PK
kyc_case_id uuid NOT NULL
merchant_id uuid NOT NULL
purpose_or_field text NOT NULL
message text NOT NULL
status text NOT NULL
requested_by uuid NOT NULL
responded_at timestamptz NULL
resolved_at timestamptz NULL
created_at timestamptz NOT NULL
```

### `app.kyc_audit_events`

Append-only review/evidence decision events.

```text
id uuid PK
kyc_case_id uuid NOT NULL
merchant_id uuid NOT NULL
actor_id uuid NULL
action text NOT NULL
reason text NULL
evidence jsonb NULL
created_at timestamptz NOT NULL
```

Do not store document bytes, presigned URLs or secret material in audit evidence.

## API credentials

### `app.api_credentials`

```text
id uuid PK
merchant_id uuid NOT NULL
environment text NOT NULL
name text NOT NULL
public_key text NOT NULL
secret_verifier text NOT NULL
secret_version integer NOT NULL DEFAULT 1
status text NOT NULL
ip_allowlist jsonb NULL
last_used_at timestamptz NULL
created_at timestamptz NOT NULL
rotated_at timestamptz NULL
revoked_at timestamptz NULL
```

Constraints:

```text
UNIQUE(public_key)
secret_version > 0
status in (active, revoked)
```

Plaintext secret never persists.

Step-up challenges, if required by the chosen Supabase Auth flow, use their own table/function with atomic single consumption and bounded attempts; they are not embedded in `api_credentials`.

## Provider configuration

### `app.providers`

Provider brand/type metadata, not credentials.

```text
id uuid PK
code text NOT NULL UNIQUE
name text NOT NULL
status text NOT NULL
created_at timestamptz NOT NULL
```

Status controls new routing only; historical event/reconciliation lookup must continue after provider disablement.

### `app.provider_accounts`

One configured operational account/credential set.

```text
id uuid PK
provider_id uuid NOT NULL FK providers
merchant_id uuid NULL
name text NOT NULL
environment text NOT NULL
status text NOT NULL
credentials_ciphertext jsonb NOT NULL
capabilities jsonb NOT NULL
configuration jsonb NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Provider secrets are encrypted/protected server-side and unavailable to browser roles/logging.

Capabilities are operational declarations but provider conformance tests remain the authority for enabling them.

## Request idempotency

### `app.request_idempotency`

```text
id uuid PK
merchant_id uuid NOT NULL
environment text NOT NULL
operation text NOT NULL
idempotency_key text NOT NULL
request_hash text NOT NULL
state text NOT NULL
resource_type text NULL
resource_id uuid NULL
http_status_snapshot integer NULL
response_snapshot jsonb NULL
created_at timestamptz NOT NULL
completed_at timestamptz NULL
expires_at timestamptz NULL
```

Hard uniqueness:

```text
UNIQUE (merchant_id, environment, operation, idempotency_key)
```

The row is claimed in the same transaction that creates the canonical resource.

## Payments

### `app.payments`

```text
id uuid PK
merchant_id uuid NOT NULL
environment text NOT NULL
external_id text NULL
source text NOT NULL
source_resource_id uuid NULL
collection_status text NOT NULL
amount_cents bigint NOT NULL CHECK amount_cents > 0
currency text NOT NULL DEFAULT 'BRL'
description text NULL
customer_snapshot jsonb NULL
metadata jsonb NULL
pricing_version text NOT NULL
rounding_policy_version text NOT NULL
merchant_fee_cents bigint NOT NULL CHECK merchant_fee_cents >= 0
merchant_net_cents bigint NOT NULL CHECK merchant_net_cents >= 0
provider_cost_cents bigint NULL
refunded_amount_cents bigint NOT NULL DEFAULT 0 CHECK refunded_amount_cents >= 0
expires_at timestamptz NULL
paid_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Checks:

```text
currency = 'BRL'
merchant_fee_cents + merchant_net_cents = amount_cents
refunded_amount_cents <= amount_cents
collection_status in (creating,pending,paid,expired,failed,cancelled)
source in (api,checkout,payment_link,quick_pix)
```

`external_id` is not the HTTP idempotency key. If business later requires merchant-unique external IDs, that is a separate explicit constraint/policy.

## Provider attempts

### `app.provider_attempts`

```text
id uuid PK
payment_id uuid NOT NULL FK payments
provider_id uuid NOT NULL
provider_account_id uuid NOT NULL
operation text NOT NULL
attempt_number integer NOT NULL CHECK attempt_number > 0
state text NOT NULL
client_reference text NOT NULL
request_fingerprint text NOT NULL
provider_payment_id text NULL
provider_txid text NULL
provider_status_raw text NULL
pix_copy_paste text NULL
pix_qr_reference text NULL
expires_at timestamptz NULL
execution_token uuid NULL
lease_expires_at timestamptz NULL
started_at timestamptz NULL
finished_at timestamptz NULL
last_error_class text NULL
last_error_code text NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Uniqueness:

```text
UNIQUE(payment_id, attempt_number)
UNIQUE(provider_account_id, client_reference)
```

Provider-specific external ID uniqueness is added only when that provider contract guarantees its scope.

A partial unique index prevents more than one unresolved create attempt for a Payment:

```text
UNIQUE(payment_id)
WHERE state IN ('prepared','executing','execution_unknown')
```

Allowed state:

```text
prepared | executing | succeeded | definitively_failed | execution_unknown
```

## Provider events

### `app.provider_events`

Durable authenticated external evidence.

```text
id uuid PK
provider_id uuid NOT NULL
provider_account_id uuid NOT NULL
environment text NOT NULL
provider_event_id text NULL
fingerprint text NOT NULL
resource_type text NOT NULL
provider_resource_id text NULL
event_type text NOT NULL
payload_hash text NOT NULL
raw_evidence_ref text NULL
received_at timestamptz NOT NULL
applied_at timestamptz NULL
state text NOT NULL
```

Identity policy:

- use provider event ID when contract guarantees it;
- otherwise use a versioned deterministic fingerprint;
- uniqueness scope includes provider/provider-account/environment as required by contract.

A duplicate ProviderEvent cannot create a second financial posting.

## Ledger

### `app.accounts`

```text
id uuid PK
merchant_id uuid NULL
provider_account_id uuid NULL
environment text NOT NULL
account_type text NOT NULL
currency text NOT NULL DEFAULT 'BRL'
balance_cents bigint NOT NULL DEFAULT 0
created_at timestamptz NOT NULL
```

Account identity must be deterministic even when merchant/provider fields are NULL. Do not rely on ordinary nullable unique semantics.

Recommended implementation uses an explicit normalized owner identity or `NULLS NOT DISTINCT`/equivalent supported strategy in the migration.

Initial account types are defined by `ledger-and-balance.md`, including merchant pending/available/reserved/blocked and explicit provider/platform accounts.

`balance_cents` is a cache updated atomically with entries and rebuildable from them.

### `app.ledger_transactions`

```text
id uuid PK
environment text NOT NULL
source_type text NOT NULL
source_id uuid NOT NULL
posting_type text NOT NULL
description text NULL
created_at timestamptz NOT NULL
```

Hard uniqueness:

```text
UNIQUE(environment, source_type, source_id, posting_type)
```

This is the financial exactly-once boundary.

### `app.ledger_entries`

```text
id uuid PK
ledger_transaction_id uuid NOT NULL FK ledger_transactions
account_id uuid NOT NULL FK accounts
direction text NOT NULL
amount_cents bigint NOT NULL CHECK amount_cents > 0
created_at timestamptz NOT NULL
```

Direction:

```text
debit | credit
```

Posting function must prove total debit cents equals total credit cents before commit.

Direct browser/application inserts into ledger tables are forbidden; trusted database function/repository boundary owns posting.

## Payouts

### `app.payout_accounts`

Merchant-owned Pix destination metadata, encrypted where required.

### `app.payouts`

```text
id uuid PK
merchant_id uuid NOT NULL
environment text NOT NULL
external_id text NULL
status text NOT NULL
execution_state text NOT NULL
requested_amount_cents bigint NOT NULL CHECK requested_amount_cents > 0
merchant_fee_cents bigint NOT NULL
merchant_debit_cents bigint NOT NULL
provider_transfer_amount_cents bigint NOT NULL
provider_cost_cents bigint NULL
payout_account_id uuid NULL
pix_destination_snapshot jsonb NOT NULL
provider_attempt_id uuid NULL
failure_code text NULL
requested_at timestamptz NOT NULL
completed_at timestamptz NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

Reservation of merchant Available -> Blocked, payout creation and idempotency claim occur atomically in one transaction/function.

Unknown external result keeps funds blocked.

## Refunds

### `app.refunds`

```text
id uuid PK
merchant_id uuid NOT NULL
environment text NOT NULL
payment_id uuid NOT NULL FK payments
status text NOT NULL
execution_state text NOT NULL
requested_amount_cents bigint NOT NULL CHECK requested_amount_cents > 0
confirmed_amount_cents bigint NULL
provider_refund_id text NULL
provider_attempt_id uuid NULL
idempotency_record_id uuid NULL
created_at timestamptz NOT NULL
completed_at timestamptz NULL
updated_at timestamptz NOT NULL
```

Refund amount concurrency is enforced against cumulative confirmed/in-flight refundable amount inside a trusted transaction; two concurrent refunds cannot exceed the original refundable principal.

Two same-value refunds remain distinct by Refund/source identity.

## Outbox/jobs

### `app.jobs`

One durable PostgreSQL job/outbox table is sufficient for first release.

```text
id uuid PK
kind text NOT NULL
resource_type text NULL
resource_id uuid NULL
dedupe_key text NULL
payload jsonb NOT NULL
state text NOT NULL
attempt_count integer NOT NULL DEFAULT 0
available_at timestamptz NOT NULL
lease_owner text NULL
lease_token uuid NULL
lease_expires_at timestamptz NULL
last_error_class text NULL
last_error_code text NULL
created_at timestamptz NOT NULL
completed_at timestamptz NULL
```

Where a job is logically unique, use a unique dedupe identity. Claim uses PostgreSQL locking/CAS semantics (`FOR UPDATE SKIP LOCKED` or equivalent approved implementation).

Job delivery is at-least-once; business/financial effects remain exactly-once through resource/source constraints.

## Merchant webhooks

### `app.webhook_endpoints`

```text
id uuid PK
merchant_id uuid NOT NULL
environment text NOT NULL
url text NOT NULL
status text NOT NULL
secret_ciphertext text NOT NULL
secret_version integer NOT NULL
subscribed_events jsonb NOT NULL
created_at timestamptz NOT NULL
updated_at timestamptz NOT NULL
```

### `app.webhook_events`

```text
id uuid PK
merchant_id uuid NOT NULL
environment text NOT NULL
type text NOT NULL
resource_type text NOT NULL
resource_id uuid NOT NULL
source_type text NOT NULL
source_id uuid NOT NULL
payload_version text NOT NULL
payload_snapshot jsonb NOT NULL
occurred_at timestamptz NOT NULL
created_at timestamptz NOT NULL
```

Unique logical source identity prevents duplicate merchant events.

### `app.webhook_deliveries`

```text
id uuid PK
webhook_event_id uuid NOT NULL
webhook_endpoint_id uuid NOT NULL
state text NOT NULL
attempt_count integer NOT NULL DEFAULT 0
next_attempt_at timestamptz NOT NULL
lease_token uuid NULL
lease_expires_at timestamptz NULL
last_http_status integer NULL
last_error_class text NULL
first_attempt_at timestamptz NULL
last_attempt_at timestamptz NULL
succeeded_at timestamptz NULL
created_at timestamptz NOT NULL
```

One logical event may have several endpoint deliveries. Retry/manual redelivery does not mint a second logical event.

## Audit log

### `app.audit_events`

Append-only security/operator events not already represented by a specialist audit table.

```text
id uuid PK
merchant_id uuid NULL
actor_type text NOT NULL
actor_id text NULL
action text NOT NULL
resource_type text NULL
resource_id uuid NULL
request_id text NULL
metadata jsonb NULL
created_at timestamptz NOT NULL
```

Never store plaintext secrets/tokens/KYC bytes/provider credential material.

## Initial server-only access rule

For Phase 2, default deny browser mutations for all `app` financial/provider/security tables.

Dashboard reads/writes go through the SwiftPay API unless a later spec deliberately exposes a narrow Supabase RLS projection.

This is intentionally less magical than exposing the entire database through `supabase-js`; it keeps the financial trust boundary obvious and portable to ordinary PostgreSQL.

## Database functions/atomic commands required

Migrations must provide or support trusted transactional primitives for at least:

```text
claim_request_idempotency_and_create_payment(...)
claim_provider_attempt(...)
apply_provider_event(...)
post_ledger_transaction(...)
reserve_payout(...)
complete_or_fail_payout(...)
create_refund_reservation(...)
apply_refund_result(...)
claim_jobs(...)
```

Exact SQL function names may change; atomic semantics may not.

## Deliberately excluded from schema v0

Do not add yet:

```text
products
orders
stock
shipping
coupons
referrals
achievements
ranking caches
generic workflow-engine graph tables
platform treasury payout
card/boleto storage
```

Later phases add Checkout/Payment Link/analytics/automation tables only after their contracts are approved.

## Migration order

Recommended first migration groups:

1. schemas/domains/helpers;
2. merchant + KYC;
3. API credentials/security;
4. provider metadata/accounts;
5. idempotency + Payments + ProviderAttempts + ProviderEvents;
6. accounts + ledger;
7. payouts + refunds;
8. jobs/outbox;
9. merchant webhooks;
10. audit/access policies/functions.

Each group is preceded by tests that demonstrate the missing invariant and followed by the minimal migration that makes those tests pass.

## Acceptance

Schema v0 is ready for migrations only when `docs/specs/fail-first-database-tests.md` exists and every required invariant has a named failing test scenario.
