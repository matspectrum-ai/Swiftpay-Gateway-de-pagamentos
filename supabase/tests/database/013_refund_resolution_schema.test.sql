create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(19);

select has_table('app', 'refund_evidence', 'normalized refund evidence must persist before refund/payment/ledger application');
select has_column('app', 'refund_evidence', 'refund_id', 'refund evidence must identify one first-class Refund resource');
select has_column('app', 'refund_evidence', 'provider_account_id', 'refund evidence must preserve the provider funding account identity');
select has_column('app', 'refund_evidence', 'environment', 'refund evidence must preserve environment scope');
select has_column('app', 'refund_evidence', 'source_kind', 'refund evidence must preserve normalized provenance kind');
select has_column('app', 'refund_evidence', 'source_reference', 'refund evidence must preserve stable provider/simulation/reconciliation source identity');
select has_column('app', 'refund_evidence', 'outcome', 'refund evidence must preserve normalized certainty/outcome');
select has_column('app', 'refund_evidence', 'amount_semantics', 'refund evidence must declare event-delta/cumulative/not-supplied amount semantics');
select has_column('app', 'refund_evidence', 'provider_reported_amount_cents', 'refund evidence must retain provider-reported amount when supplied');
select has_column('app', 'refund_evidence', 'provider_status_raw', 'refund evidence may retain provider status for audit');
select has_column('app', 'refund_evidence', 'provider_refund_id', 'refund evidence may retain external refund identity');
select has_column('app', 'refund_evidence', 'payload_hash', 'refund evidence must preserve immutable normalized payload hash');
select has_column('app', 'refund_evidence', 'occurred_at', 'refund evidence must preserve evidence occurrence time');
select has_column('app', 'refund_evidence', 'application_state', 'refund evidence application must be auditable');
select has_column('app', 'refund_evidence', 'application_reason', 'absorbed/conflicting/blocked evidence must record why');
select has_column('app', 'refund_evidence', 'applied_at', 'refund evidence application time must be durable');
select has_index('app', 'refund_evidence', 'refund_evidence_source_uq', 'provider-scoped refund evidence source identity must be database unique');
select has_function(
  'app', 'record_refund_evidence',
  array['uuid','uuid','text','text','text','text','bigint','text','text','text','timestamp with time zone'],
  'normalized refund evidence recording boundary must exist'
);
select has_function(
  'app', 'apply_refund_evidence',
  array['uuid'],
  'refund evidence application boundary must exist'
);

select * from finish();
rollback;
