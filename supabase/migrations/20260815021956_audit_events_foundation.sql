-- SwiftPay V2 K2 structural foundation: generic append-only operational audit.
-- Recording and mutation behavior remain fail-closed until their behavioral
-- pgTAP suite is introduced and proven.

create table app.audit_events (
    id uuid primary key default gen_random_uuid(),
    source_kind text not null,
    source_reference text not null,
    request_fingerprint text not null,
    event_version integer not null default 1,
    actor_kind text not null,
    actor_subject text not null,
    merchant_id uuid references app.merchants(id),
    environment text,
    action text not null,
    resource_type text not null,
    resource_id text not null,
    reason_code text,
    reason_note text,
    request_id text,
    trace_id text,
    metadata jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null,
    created_at timestamptz not null default now(),

    constraint audit_events_source_identity_key
        unique (source_kind, source_reference),
    constraint audit_events_source_kind_check
        check (source_kind in (
            'application_command',
            'worker_command',
            'operator_command',
            'security_event'
        )),
    constraint audit_events_actor_kind_check
        check (actor_kind in ('user', 'api_credential', 'system')),
    constraint audit_events_environment_check
        check (environment is null or environment in ('sandbox', 'production')),
    constraint audit_events_event_version_check
        check (event_version >= 1),
    constraint audit_events_required_text_check
        check (
            length(trim(source_reference)) > 0
            and length(trim(request_fingerprint)) > 0
            and length(trim(actor_subject)) > 0
            and length(trim(action)) > 0
            and length(trim(resource_type)) > 0
            and length(trim(resource_id)) > 0
        ),
    constraint audit_events_optional_text_check
        check (
            (reason_code is null or length(trim(reason_code)) > 0)
            and (reason_note is null or length(trim(reason_note)) > 0)
            and (request_id is null or length(trim(request_id)) > 0)
            and (trace_id is null or length(trim(trace_id)) > 0)
        ),
    constraint audit_events_metadata_object_check
        check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_merchant_created_idx
    on app.audit_events (merchant_id, created_at desc)
    where merchant_id is not null;

create function app.record_audit_event(
    p_source_kind text,
    p_source_reference text,
    p_request_fingerprint text,
    p_event_version integer,
    p_actor_kind text,
    p_actor_subject text,
    p_merchant_id uuid,
    p_environment text,
    p_action text,
    p_resource_type text,
    p_resource_id text,
    p_reason_code text,
    p_reason_note text,
    p_request_id text,
    p_trace_id text,
    p_metadata jsonb,
    p_occurred_at timestamptz
)
returns uuid
language plpgsql
set search_path = pg_catalog, app
as $$
begin
    raise exception 'audit event recording behavior not implemented'
        using errcode = '0A000';
end;
$$;

create function app.reject_audit_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, app
as $$
begin
    raise exception 'audit append-only behavior not implemented'
        using errcode = '0A000';
end;
$$;

create trigger audit_events_append_only_trg
before update or delete on app.audit_events
for each row execute function app.reject_audit_event_mutation();

revoke all on table app.audit_events
    from public, anon, authenticated, service_role;
revoke all on function app.record_audit_event(
    text,text,text,integer,text,text,uuid,text,text,text,text,text,text,text,text,jsonb,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.reject_audit_event_mutation()
    from public, anon, authenticated, service_role;
