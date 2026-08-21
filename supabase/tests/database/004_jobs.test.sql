create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(35);

select has_table('app', 'jobs', 'one canonical PostgreSQL jobs/outbox table must exist');
select has_column('app', 'jobs', 'kind', 'job kind must be explicit');
select has_column('app', 'jobs', 'resource_type', 'canonical resource type must be traceable');
select has_column('app', 'jobs', 'resource_id', 'canonical resource id must be traceable');
select has_column('app', 'jobs', 'dedupe_key', 'logical dedupe identity must exist');
select has_column('app', 'jobs', 'payload_version', 'stored payload schema version must be explicit');
select has_column('app', 'jobs', 'payload', 'versioned execution payload must exist');
select has_column('app', 'jobs', 'state', 'job state must exist');
select has_column('app', 'jobs', 'attempt_count', 'worker claims must be counted');
select has_column('app', 'jobs', 'max_attempts', 'retry ceiling must be explicit');
select has_column('app', 'jobs', 'available_at', 'next eligible execution time must exist');
select has_column('app', 'jobs', 'lease_owner', 'lease owner evidence must exist');
select has_column('app', 'jobs', 'lease_token', 'lease fencing token must exist');
select has_column('app', 'jobs', 'lease_expires_at', 'lease expiry must exist');
select has_column('app', 'jobs', 'last_error_class', 'structured failure class must persist');
select has_column('app', 'jobs', 'last_error_code', 'structured failure code must persist');
select has_column('app', 'jobs', 'completed_at', 'completion time must persist');

select has_index('app', 'jobs', 'jobs_dedupe_uq', 'logical one-time work must be database-unique');
select has_index('app', 'jobs', 'jobs_due_idx', 'due pending work must have a claim-oriented index');

select has_function(
  'app', 'enqueue_job',
  array['text','text','uuid','text','jsonb','integer','integer','timestamp with time zone'],
  'trusted idempotent enqueue boundary must exist'
);
select has_function(
  'app', 'claim_jobs',
  array['text','integer','integer'],
  'worker claim/lease boundary must exist'
);
select has_function(
  'app', 'complete_job',
  array['uuid','uuid'],
  'completion must be fenced by lease token'
);
select has_function(
  'app', 'reschedule_job',
  array['uuid','uuid','text','text','integer'],
  'failure/retry must be fenced by lease token'
);

select lives_ok(
  $$select app.enqueue_job(
      'provider_event_application',
      'provider_event',
      '00000000-0000-0000-0000-000000004001'::uuid,
      'provider-event:00000000-0000-0000-0000-000000004001:apply',
      '{"provider_event_id":"00000000-0000-0000-0000-000000004001"}'::jsonb,
      1,
      5,
      now()
    )$$,
  'a valid durable job can be enqueued'
);

select lives_ok(
  $$select app.enqueue_job(
      'provider_event_application',
      'provider_event',
      '00000000-0000-0000-0000-000000004001'::uuid,
      'provider-event:00000000-0000-0000-0000-000000004001:apply',
      '{"provider_event_id":"00000000-0000-0000-0000-000000004001"}'::jsonb,
      1,
      5,
      now()
    )$$,
  're-enqueueing the same logical dedupe identity is idempotent'
);

select is(
  (select count(*)::bigint from app.jobs where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply'),
  1::bigint,
  'JOB-006: duplicate enqueue leaves one durable logical job'
);

select throws_ok(
  $$insert into app.jobs (
      kind, resource_type, resource_id, dedupe_key, payload_version, payload,
      state, attempt_count, max_attempts, available_at
    ) values (
      'invalid', 'test', gen_random_uuid(), 'invalid:payload-version', 0, '{}'::jsonb,
      'pending', 0, 3, now()
    )$$,
  '23514', null,
  'unsupported/non-positive stored payload version is rejected deterministically'
);

select lives_ok(
  $$select * from app.claim_jobs('worker-a', 10, 60)$$,
  'worker can atomically claim due jobs'
);

select is(
  (select state from app.jobs where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply'),
  'leased'::text,
  'claimed work enters leased state'
);

select is(
  (select attempt_count from app.jobs where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply'),
  1,
  'JOB-007: one claim increments attempt count exactly once'
);

select ok(
  (select lease_token is not null and lease_owner='worker-a' and lease_expires_at > now()
     from app.jobs
    where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply'),
  'valid claim persists owner, fencing token and future lease expiry'
);

select is(
  app.complete_job(
    (select id from app.jobs where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply'),
    gen_random_uuid()
  ),
  false,
  'JOB-004: stale/foreign lease token cannot complete current work'
);

select is(
  app.complete_job(
    (select id from app.jobs where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply'),
    (select lease_token from app.jobs where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply')
  ),
  true,
  'matching lease token can complete current work exactly once'
);

select is(
  (select state from app.jobs where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply'),
  'completed'::text,
  'completed work has canonical completed state'
);

select is(
  app.complete_job(
    (select id from app.jobs where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply'),
    (select coalesce(lease_token, gen_random_uuid()) from app.jobs where dedupe_key='provider-event:00000000-0000-0000-0000-000000004001:apply')
  ),
  false,
  'a completed job cannot be completed a second time'
);

select * from finish();
rollback;
