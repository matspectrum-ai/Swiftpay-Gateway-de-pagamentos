create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(64);

-- I2 starts RED: durable run/discrepancy/operator persistence must exist before
-- capture or lifecycle behavior is implemented.
select has_table('app', 'reconciliation_runs', 'reconciliation runs must be durable first-class resources');
select has_table('app', 'reconciliation_discrepancies', 'logical discrepancies must persist independently from individual runs');
select has_table('app', 'reconciliation_run_observations', 'each run must preserve immutable discrepancy observations');
select has_table('app', 'reconciliation_discrepancy_events', 'operator lifecycle events must be append-only resources');

select has_column('app', 'reconciliation_runs', 'id', 'run durable identity must persist');
select has_column('app', 'reconciliation_runs', 'layer', 'run reconciliation layer must persist');
select has_column('app', 'reconciliation_runs', 'environment', 'run environment must persist');
select has_column('app', 'reconciliation_runs', 'scope', 'run scope snapshot must persist');
select has_column('app', 'reconciliation_runs', 'detector_version', 'run detector version must persist');
select has_column('app', 'reconciliation_runs', 'status', 'run status must persist');
select has_column('app', 'reconciliation_runs', 'started_at', 'run start timestamp must persist');
select has_column('app', 'reconciliation_runs', 'completed_at', 'run completion timestamp must persist');
select has_column('app', 'reconciliation_runs', 'finding_count', 'run finding count must persist');

select has_column('app', 'reconciliation_discrepancies', 'id', 'stable discrepancy durable identity must persist');
select has_column('app', 'reconciliation_discrepancies', 'layer', 'discrepancy reconciliation layer must persist');
select has_column('app', 'reconciliation_discrepancies', 'environment', 'discrepancy environment must persist');
select has_column('app', 'reconciliation_discrepancies', 'discrepancy_type', 'discrepancy type must persist');
select has_column('app', 'reconciliation_discrepancies', 'stable_key', 'detector stable key must persist');
select has_column('app', 'reconciliation_discrepancies', 'resource_type', 'discrepancy resource type must persist');
select has_column('app', 'reconciliation_discrepancies', 'resource_id', 'discrepancy resource identity must persist');
select has_column('app', 'reconciliation_discrepancies', 'account_id', 'discrepancy account identity must persist when applicable');
select has_column('app', 'reconciliation_discrepancies', 'expected_cents', 'expected cents snapshot must persist');
select has_column('app', 'reconciliation_discrepancies', 'actual_cents', 'actual cents snapshot must persist');
select has_column('app', 'reconciliation_discrepancies', 'detail', 'non-secret discrepancy detail must persist');
select has_column('app', 'reconciliation_discrepancies', 'lifecycle_state', 'operator lifecycle state must persist');
select has_column('app', 'reconciliation_discrepancies', 'first_seen_at', 'first-seen timestamp must persist');
select has_column('app', 'reconciliation_discrepancies', 'last_seen_at', 'last-seen timestamp must persist');
select has_column('app', 'reconciliation_discrepancies', 'occurrence_count', 'rediscovery count must persist');
select has_column('app', 'reconciliation_discrepancies', 'first_run_id', 'first observing run must persist');
select has_column('app', 'reconciliation_discrepancies', 'last_run_id', 'latest observing run must persist');
select has_column('app', 'reconciliation_discrepancies', 'acknowledged_at', 'acknowledgement time must persist');
select has_column('app', 'reconciliation_discrepancies', 'acknowledged_by_actor_type', 'acknowledgement actor type must persist');
select has_column('app', 'reconciliation_discrepancies', 'acknowledged_by_actor_id', 'acknowledgement actor identity must persist');
select has_column('app', 'reconciliation_discrepancies', 'acknowledgement_note', 'acknowledgement note must persist');
select has_column('app', 'reconciliation_discrepancies', 'resolved_at', 'resolution time must persist');
select has_column('app', 'reconciliation_discrepancies', 'resolved_by_actor_type', 'resolution actor type must persist');
select has_column('app', 'reconciliation_discrepancies', 'resolved_by_actor_id', 'resolution actor identity must persist');
select has_column('app', 'reconciliation_discrepancies', 'resolution_code', 'explicit resolution code must persist');
select has_column('app', 'reconciliation_discrepancies', 'resolution_note', 'resolution note must persist');

select has_column('app', 'reconciliation_run_observations', 'id', 'run observation durable identity must persist');
select has_column('app', 'reconciliation_run_observations', 'run_id', 'observation run identity must persist');
select has_column('app', 'reconciliation_run_observations', 'discrepancy_id', 'observation stable discrepancy identity must persist');
select has_column('app', 'reconciliation_run_observations', 'discrepancy_type', 'observation detector type snapshot must persist');
select has_column('app', 'reconciliation_run_observations', 'stable_key', 'observation detector stable key snapshot must persist');
select has_column('app', 'reconciliation_run_observations', 'resource_type', 'observation resource type snapshot must persist');
select has_column('app', 'reconciliation_run_observations', 'resource_id', 'observation resource identity snapshot must persist');
select has_column('app', 'reconciliation_run_observations', 'account_id', 'observation account identity snapshot must persist');
select has_column('app', 'reconciliation_run_observations', 'expected_cents', 'observation expected cents snapshot must persist');
select has_column('app', 'reconciliation_run_observations', 'actual_cents', 'observation actual cents snapshot must persist');
select has_column('app', 'reconciliation_run_observations', 'detail', 'observation non-secret detail snapshot must persist');
select has_column('app', 'reconciliation_run_observations', 'observed_at', 'observation timestamp must persist');

select has_column('app', 'reconciliation_discrepancy_events', 'id', 'lifecycle event durable identity must persist');
select has_column('app', 'reconciliation_discrepancy_events', 'discrepancy_id', 'lifecycle event discrepancy identity must persist');
select has_column('app', 'reconciliation_discrepancy_events', 'event_type', 'lifecycle event type must persist');
select has_column('app', 'reconciliation_discrepancy_events', 'actor_type', 'lifecycle actor type must persist');
select has_column('app', 'reconciliation_discrepancy_events', 'actor_id', 'lifecycle actor identity must persist');
select has_column('app', 'reconciliation_discrepancy_events', 'note', 'lifecycle note must persist');
select has_column('app', 'reconciliation_discrepancy_events', 'resolution_code', 'resolution event code must persist when applicable');
select has_column('app', 'reconciliation_discrepancy_events', 'created_at', 'lifecycle event timestamp must persist');

select has_index('app', 'reconciliation_discrepancies', 'reconciliation_discrepancies_logical_identity_uq', 'logical discrepancy identity must be unique across repeated runs');
select has_index('app', 'reconciliation_run_observations', 'reconciliation_run_observations_run_discrepancy_uq', 'one run may observe one logical discrepancy at most once');

select has_function(
  'app', 'capture_internal_reconciliation_run',
  array['text','text','jsonb','timestamp with time zone','timestamp with time zone'],
  'atomic internal reconciliation capture boundary must exist'
);
select has_function(
  'app', 'acknowledge_reconciliation_discrepancy',
  array['uuid','text','text','text','timestamp with time zone'],
  'explicit discrepancy acknowledgement boundary must exist'
);
select has_function(
  'app', 'resolve_reconciliation_discrepancy',
  array['uuid','text','text','text','text','timestamp with time zone'],
  'explicit discrepancy resolution boundary must exist'
);

select * from finish();
rollback;
