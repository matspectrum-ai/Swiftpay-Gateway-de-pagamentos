create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(25);

select has_table(
  'app', 'provider_reconciliation_evidence',
  'provider-authoritative reconciliation evidence must persist independently'
);

select has_column('app','provider_reconciliation_evidence','id','external evidence durable identity must persist');
select has_column('app','provider_reconciliation_evidence','provider_id','external evidence provider identity must persist');
select has_column('app','provider_reconciliation_evidence','provider_account_id','external evidence provider account identity must persist');
select has_column('app','provider_reconciliation_evidence','environment','external evidence environment must persist');
select has_column('app','provider_reconciliation_evidence','source_kind','external evidence source kind must persist');
select has_column('app','provider_reconciliation_evidence','source_reference','external evidence source identity must persist');
select has_column('app','provider_reconciliation_evidence','request_fingerprint','normalized evidence replay fingerprint must persist');
select has_column('app','provider_reconciliation_evidence','evidence_type','normalized evidence type must persist');
select has_column('app','provider_reconciliation_evidence','operation_type','operation type must persist when applicable');
select has_column('app','provider_reconciliation_evidence','client_reference','provider-visible client correlation fact must persist when supplied');
select has_column('app','provider_reconciliation_evidence','provider_resource_id','provider resource correlation fact must persist when supplied');
select has_column('app','provider_reconciliation_evidence','normalized_outcome','normalized operation outcome must persist when supplied');
select has_column('app','provider_reconciliation_evidence','amount_cents','provider-reported amount must use integer cents');
select has_column('app','provider_reconciliation_evidence','provider_fee_cents','provider-reported fee/cost must use integer cents');
select has_column('app','provider_reconciliation_evidence','balance_cents','provider balance snapshot must use integer cents');
select has_column('app','provider_reconciliation_evidence','currency','external evidence currency must persist');
select has_column('app','provider_reconciliation_evidence','evidence_window_start','report/query evidence window start must persist when applicable');
select has_column('app','provider_reconciliation_evidence','evidence_window_end','report/query evidence window end must persist when applicable');
select has_column('app','provider_reconciliation_evidence','payload_hash','raw provider evidence integrity hash must persist');
select has_column('app','provider_reconciliation_evidence','raw_evidence_ref','protected raw evidence reference must persist without embedding bytes');
select has_column('app','provider_reconciliation_evidence','observed_at','provider fact observation/effective timestamp must persist');
select has_column('app','provider_reconciliation_evidence','created_at','external evidence ingestion timestamp must persist');

select has_index(
  'app', 'provider_reconciliation_evidence',
  'provider_reconciliation_evidence_source_uq',
  'provider evidence logical source identity must be database enforced'
);

select has_function(
  'app', 'record_provider_reconciliation_evidence',
  array[
    'uuid','uuid','text','text','text','text','text','text','text','text','text',
    'bigint','bigint','bigint','timestamp with time zone','timestamp with time zone',
    'text','text','timestamp with time zone'
  ],
  'trusted provider reconciliation evidence recording boundary must exist'
);

select * from finish();
rollback;
