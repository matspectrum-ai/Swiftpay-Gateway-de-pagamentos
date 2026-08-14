-- SwiftPay V2 Phase 2 / I1: internal reconciliation structural foundation.
--
-- This migration establishes only typed, server-owned read surfaces. The views
-- are intentionally empty until fail-first behavior tests define detection
-- semantics. No correction or financial mutation is introduced here.

create view app.reconciliation_account_cache as
select
    null::uuid as account_id,
    null::uuid as merchant_id,
    null::uuid as provider_account_id,
    null::text as environment,
    null::text as account_type,
    null::bigint as cached_balance_cents,
    null::bigint as rebuilt_balance_cents,
    null::bigint as delta_cents,
    null::boolean as is_consistent
where false;

create view app.reconciliation_expected_postings as
select
    null::text as environment,
    null::text as source_type,
    null::uuid as source_id,
    null::text as posting_type,
    null::text as resource_state
where false;

create view app.reconciliation_refund_projection as
select
    null::uuid as payment_id,
    null::uuid as merchant_id,
    null::text as environment,
    null::bigint as cached_refunded_amount_cents,
    null::bigint as rebuilt_refunded_amount_cents,
    null::bigint as delta_cents,
    null::boolean as is_consistent
where false;

create view app.internal_reconciliation_findings as
select
    null::text as environment,
    null::text as discrepancy_type,
    null::text as stable_key,
    null::text as resource_type,
    null::uuid as resource_id,
    null::uuid as account_id,
    null::bigint as expected_cents,
    null::bigint as actual_cents,
    null::jsonb as detail
where false;

revoke all on
    app.reconciliation_account_cache,
    app.reconciliation_expected_postings,
    app.reconciliation_refund_projection,
    app.internal_reconciliation_findings
from public, anon, authenticated, service_role;
