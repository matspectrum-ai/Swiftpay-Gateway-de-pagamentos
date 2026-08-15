create extension if not exists pgtap with schema extensions;

begin;
set local search_path = public, extensions;

select plan(40);

select has_table('app', 'audit_events', 'audit event table exists');
select has_column('app', 'audit_events', 'id', 'audit event has id');
select has_column('app', 'audit_events', 'source_kind', 'audit event has source kind');
select has_column('app', 'audit_events', 'source_reference', 'audit event has source reference');
select has_column('app', 'audit_events', 'request_fingerprint', 'audit event has request fingerprint');
select has_column('app', 'audit_events', 'event_version', 'audit event has event version');
select has_column('app', 'audit_events', 'actor_kind', 'audit event has actor kind');
select has_column('app', 'audit_events', 'actor_subject', 'audit event has actor subject');
select has_column('app', 'audit_events', 'merchant_id', 'audit event has optional merchant scope');
select has_column('app', 'audit_events', 'environment', 'audit event has optional environment');
select has_column('app', 'audit_events', 'action', 'audit event has action');
select has_column('app', 'audit_events', 'resource_type', 'audit event has resource type');
select has_column('app', 'audit_events', 'resource_id', 'audit event has resource id');
select has_column('app', 'audit_events', 'reason_code', 'audit event has optional reason code');
select has_column('app', 'audit_events', 'reason_note', 'audit event has optional reason note');
select has_column('app', 'audit_events', 'request_id', 'audit event has optional request id');
select has_column('app', 'audit_events', 'trace_id', 'audit event has optional trace id');
select has_column('app', 'audit_events', 'metadata', 'audit event has safe metadata object');
select has_column('app', 'audit_events', 'occurred_at', 'audit event has occurrence time');
select has_column('app', 'audit_events', 'created_at', 'audit event has ingestion time');

select col_type_is('app', 'audit_events', 'id', 'uuid', 'audit id is uuid');
select col_type_is('app', 'audit_events', 'merchant_id', 'uuid', 'merchant scope is uuid');
select col_type_is('app', 'audit_events', 'metadata', 'jsonb', 'audit metadata is jsonb');
select col_type_is('app', 'audit_events', 'occurred_at', 'timestamp with time zone', 'occurred_at is timestamptz');
select col_type_is('app', 'audit_events', 'created_at', 'timestamp with time zone', 'created_at is timestamptz');

select col_not_null('app', 'audit_events', 'source_kind', 'source kind is required');
select col_not_null('app', 'audit_events', 'source_reference', 'source reference is required');
select col_not_null('app', 'audit_events', 'request_fingerprint', 'request fingerprint is required');
select col_not_null('app', 'audit_events', 'actor_kind', 'actor kind is required');
select col_not_null('app', 'audit_events', 'actor_subject', 'actor subject is required');
select col_not_null('app', 'audit_events', 'action', 'action is required');
select col_not_null('app', 'audit_events', 'resource_type', 'resource type is required');
select col_not_null('app', 'audit_events', 'resource_id', 'resource id is required');
select col_not_null('app', 'audit_events', 'metadata', 'metadata is required');
select col_not_null('app', 'audit_events', 'occurred_at', 'occurred_at is required');

select ok(
    exists (
        select 1
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'app'
          and t.relname = 'audit_events'
          and c.contype = 'u'
          and c.conname = 'audit_events_source_identity_key'
    ),
    'audit logical source identity is unique'
);

select ok(
    exists (
        select 1
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'app'
          and t.relname = 'audit_events'
          and c.conname = 'audit_events_merchant_id_fkey'
    ),
    'audit merchant scope references canonical merchant'
);

select has_function(
    'app',
    'record_audit_event',
    array['text','text','text','integer','text','text','uuid','text','text','text','text','text','text','text','text','jsonb','timestamp with time zone'],
    'record_audit_event frozen signature exists'
);

select ok(
    exists (
        select 1
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app'
          and c.relname = 'audit_events'
          and t.tgname = 'audit_events_append_only_trg'
          and not t.tgisinternal
    ),
    'audit events have append-only mutation trigger'
);

select ok(
    to_regprocedure('app.record_audit_event(text,text,text,integer,text,text,uuid,text,text,text,text,text,text,text,text,jsonb,timestamptz)') is not null
    and not has_function_privilege('anon', 'app.record_audit_event(text,text,text,integer,text,text,uuid,text,text,text,text,text,text,text,text,jsonb,timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'app.record_audit_event(text,text,text,integer,text,text,uuid,text,text,text,text,text,text,text,text,jsonb,timestamptz)', 'EXECUTE')
    and not has_function_privilege('service_role', 'app.record_audit_event(text,text,text,integer,text,text,uuid,text,text,text,text,text,text,text,text,jsonb,timestamptz)', 'EXECUTE'),
    'record_audit_event is inaccessible to Data API/service roles'
);

select * from finish();
rollback;
