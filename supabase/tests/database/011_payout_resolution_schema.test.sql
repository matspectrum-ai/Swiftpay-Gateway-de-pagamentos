create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(18);

select has_table('app', 'payout_evidence', 'normalized payout evidence must persist before domain/ledger application');
select has_column('app', 'payout_evidence', 'payout_id', 'payout evidence must identify its payout');
select has_column('app', 'payout_evidence', 'payout_attempt_id', 'payout evidence must identify its provider execution attempt');
select has_column('app', 'payout_evidence', 'environment', 'payout evidence must preserve environment scope');
select has_column('app', 'payout_evidence', 'source_kind', 'payout evidence must preserve normalized provenance kind');
select has_column('app', 'payout_evidence', 'source_reference', 'payout evidence must preserve stable source identity');
select has_column('app', 'payout_evidence', 'outcome', 'payout evidence must preserve normalized certainty/outcome');
select has_column('app', 'payout_evidence', 'provider_status_raw', 'payout evidence may preserve provider status for audit');
select has_column('app', 'payout_evidence', 'provider_payout_id', 'payout evidence may preserve external payout identity');
select has_column('app', 'payout_evidence', 'provider_cost_cents', 'payout evidence must carry explicit provider cost when required');
select has_column('app', 'payout_evidence', 'payload_hash', 'payout evidence must preserve immutable normalized payload hash');
select has_column('app', 'payout_evidence', 'occurred_at', 'payout evidence must preserve provider/evidence occurrence time');
select has_column('app', 'payout_evidence', 'application_state', 'payout evidence application must be auditable');
select has_column('app', 'payout_evidence', 'application_reason', 'absorbed/conflicting evidence must record why');
select has_column('app', 'payout_evidence', 'applied_at', 'payout evidence application time must be durable');
select has_index('app', 'payout_evidence', 'payout_evidence_source_uq', 'payout evidence source identity must be database unique');
select has_function(
  'app', 'record_payout_evidence',
  array['uuid','uuid','text','text','text','text','text','bigint','text','timestamp with time zone'],
  'normalized payout evidence recording boundary must exist'
);
select has_function(
  'app', 'apply_payout_evidence',
  array['uuid'],
  'payout evidence application boundary must exist'
);

select * from finish();
rollback;
