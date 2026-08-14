-- SwiftPay V2 Phase 2 / I1: internal reconciliation behavior.
--
-- These surfaces are deliberately read-only. They reconstruct expected state
-- from canonical domain + immutable ledger evidence and surface discrepancies;
-- they never repair, append or rewrite financial/domain state.

create or replace view app.reconciliation_account_cache as
with rebuilt as (
    select
        a.id as account_id,
        coalesce(
            sum(
                case
                    when le.direction = a.normal_side then le.amount_cents
                    else -le.amount_cents
                end
            ),
            0
        )::bigint as rebuilt_balance_cents
    from app.accounts a
    left join app.ledger_entries le
      on le.account_id = a.id
    group by a.id, a.normal_side
)
select
    a.id as account_id,
    a.merchant_id,
    a.provider_account_id,
    a.environment,
    a.account_type,
    a.balance_cents as cached_balance_cents,
    r.rebuilt_balance_cents,
    (a.balance_cents - r.rebuilt_balance_cents)::bigint as delta_cents,
    (a.balance_cents = r.rebuilt_balance_cents) as is_consistent
from app.accounts a
join rebuilt r
  on r.account_id = a.id;

create or replace view app.reconciliation_expected_postings as
select
    p.environment,
    'payout'::text as source_type,
    p.id as source_id,
    'reservation'::text as posting_type,
    p.state as resource_state
from app.payouts p

union all

select
    p.environment,
    'payout'::text,
    p.id,
    'completed'::text,
    p.state
from app.payouts p
where p.state = 'completed'

union all

select
    p.environment,
    'payout'::text,
    p.id,
    'release_failure'::text,
    p.state
from app.payouts p
where p.state = 'failed'

union all

select
    r.environment,
    'refund'::text,
    r.id,
    'reservation'::text,
    r.state
from app.refunds r

union all

select
    r.environment,
    'refund'::text,
    r.id,
    'completed'::text,
    r.state
from app.refunds r
where r.state = 'completed'

union all

select
    r.environment,
    'refund'::text,
    r.id,
    'release_failure'::text,
    r.state
from app.refunds r
where r.state = 'failed';

create or replace view app.reconciliation_refund_projection as
with completed_refunds as (
    select
        r.payment_id,
        coalesce(sum(r.amount_cents), 0)::bigint as rebuilt_refunded_amount_cents
    from app.refunds r
    where r.state = 'completed'
    group by r.payment_id
)
select
    p.id as payment_id,
    p.merchant_id,
    p.environment,
    p.refunded_amount_cents as cached_refunded_amount_cents,
    coalesce(cr.rebuilt_refunded_amount_cents, 0)::bigint as rebuilt_refunded_amount_cents,
    (p.refunded_amount_cents - coalesce(cr.rebuilt_refunded_amount_cents, 0))::bigint as delta_cents,
    (p.refunded_amount_cents = coalesce(cr.rebuilt_refunded_amount_cents, 0)) as is_consistent
from app.payments p
left join completed_refunds cr
  on cr.payment_id = p.id;

create or replace view app.internal_reconciliation_findings as
with canonical_resources as (
    select
        p.environment,
        'payout'::text as resource_type,
        p.id as resource_id,
        p.state as resource_state
    from app.payouts p

    union all

    select
        r.environment,
        'refund'::text,
        r.id,
        r.state
    from app.refunds r
),
cache_findings as (
    select
        c.environment,
        'cache_mismatch'::text as discrepancy_type,
        ('account_cache:' || c.environment || ':' || c.account_id::text)::text as stable_key,
        'account'::text as resource_type,
        c.account_id as resource_id,
        c.account_id,
        c.rebuilt_balance_cents as expected_cents,
        c.cached_balance_cents as actual_cents,
        jsonb_build_object(
            'accountType', c.account_type,
            'deltaCents', c.delta_cents
        ) as detail
    from app.reconciliation_account_cache c
    where not c.is_consistent
),
missing_posting_findings as (
    select
        e.environment,
        'missing_required_posting'::text as discrepancy_type,
        (
            'missing_posting:' || e.environment || ':' || e.source_type || ':' ||
            e.source_id::text || ':' || e.posting_type
        )::text as stable_key,
        e.source_type as resource_type,
        e.source_id as resource_id,
        null::uuid as account_id,
        null::bigint as expected_cents,
        null::bigint as actual_cents,
        jsonb_build_object(
            'resourceState', e.resource_state,
            'postingType', e.posting_type
        ) as detail
    from app.reconciliation_expected_postings e
    left join app.ledger_transactions lt
      on lt.environment = e.environment
     and lt.source_type = e.source_type
     and lt.source_id = e.source_id
     and lt.posting_type = e.posting_type
    where lt.id is null
),
orphan_posting_findings as (
    select
        lt.environment,
        'orphan_posting'::text as discrepancy_type,
        (
            'orphan_posting:' || lt.environment || ':' || lt.source_type || ':' ||
            lt.source_id::text || ':' || lt.posting_type
        )::text as stable_key,
        lt.source_type as resource_type,
        lt.source_id as resource_id,
        null::uuid as account_id,
        null::bigint as expected_cents,
        null::bigint as actual_cents,
        jsonb_build_object('postingType', lt.posting_type) as detail
    from app.ledger_transactions lt
    left join canonical_resources cr
      on cr.environment = lt.environment
     and cr.resource_type = lt.source_type
     and cr.resource_id = lt.source_id
    where lt.source_type in ('payout', 'refund')
      and cr.resource_id is null
),
unexpected_posting_findings as (
    select
        lt.environment,
        'unexpected_posting'::text as discrepancy_type,
        (
            'unexpected_posting:' || lt.environment || ':' || lt.source_type || ':' ||
            lt.source_id::text || ':' || lt.posting_type
        )::text as stable_key,
        lt.source_type as resource_type,
        lt.source_id as resource_id,
        null::uuid as account_id,
        null::bigint as expected_cents,
        null::bigint as actual_cents,
        jsonb_build_object(
            'resourceState', cr.resource_state,
            'postingType', lt.posting_type
        ) as detail
    from app.ledger_transactions lt
    join canonical_resources cr
      on cr.environment = lt.environment
     and cr.resource_type = lt.source_type
     and cr.resource_id = lt.source_id
    left join app.reconciliation_expected_postings e
      on e.environment = lt.environment
     and e.source_type = lt.source_type
     and e.source_id = lt.source_id
     and e.posting_type = lt.posting_type
    where lt.source_type in ('payout', 'refund')
      and e.source_id is null
),
refund_projection_findings as (
    select
        r.environment,
        'refund_projection_mismatch'::text as discrepancy_type,
        ('refund_projection:' || r.environment || ':' || r.payment_id::text)::text as stable_key,
        'payment'::text as resource_type,
        r.payment_id as resource_id,
        null::uuid as account_id,
        r.rebuilt_refunded_amount_cents as expected_cents,
        r.cached_refunded_amount_cents as actual_cents,
        jsonb_build_object('deltaCents', r.delta_cents) as detail
    from app.reconciliation_refund_projection r
    where not r.is_consistent
)
select * from cache_findings
union all
select * from missing_posting_findings
union all
select * from orphan_posting_findings
union all
select * from unexpected_posting_findings
union all
select * from refund_projection_findings;

revoke all on
    app.reconciliation_account_cache,
    app.reconciliation_expected_postings,
    app.reconciliation_refund_projection,
    app.internal_reconciliation_findings
from public, anon, authenticated, service_role;
