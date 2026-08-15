-- SwiftPay V2 K2 behavioral implementation: deterministic append-only audit recording.
--
-- Exact trusted retries converge on the original durable event. Reuse of the
-- same logical source identity with any changed immutable input fails closed.
-- This function deliberately performs no domain, ledger, async or webhook work.

create or replace function app.record_audit_event(
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
declare
    v_event_id uuid;
    v_existing app.audit_events%rowtype;
begin
    if p_source_kind is null
       or p_source_kind not in (
            'application_command',
            'worker_command',
            'operator_command',
            'security_event'
       ) then
        raise exception 'invalid audit source kind'
            using errcode = '23514';
    end if;

    if p_actor_kind is null
       or p_actor_kind not in ('user', 'api_credential', 'system') then
        raise exception 'invalid audit actor kind'
            using errcode = '23514';
    end if;

    if p_environment is not null
       and p_environment not in ('sandbox', 'production') then
        raise exception 'invalid audit environment'
            using errcode = '23514';
    end if;

    if p_event_version is null or p_event_version < 1 then
        raise exception 'invalid audit event version'
            using errcode = '23514';
    end if;

    if p_source_reference is null or length(btrim(p_source_reference)) = 0
       or p_request_fingerprint is null or length(btrim(p_request_fingerprint)) = 0
       or p_actor_subject is null or length(btrim(p_actor_subject)) = 0
       or p_action is null or length(btrim(p_action)) = 0
       or p_resource_type is null or length(btrim(p_resource_type)) = 0
       or p_resource_id is null or length(btrim(p_resource_id)) = 0 then
        raise exception 'invalid required audit text field'
            using errcode = '23514';
    end if;

    if (p_reason_code is not null and length(btrim(p_reason_code)) = 0)
       or (p_reason_note is not null and length(btrim(p_reason_note)) = 0)
       or (p_request_id is not null and length(btrim(p_request_id)) = 0)
       or (p_trace_id is not null and length(btrim(p_trace_id)) = 0) then
        raise exception 'invalid optional audit text field'
            using errcode = '23514';
    end if;

    if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
        raise exception 'audit metadata must be a JSON object'
            using errcode = '23514';
    end if;

    if p_occurred_at is null then
        raise exception 'audit occurrence time is required'
            using errcode = '23514';
    end if;

    insert into app.audit_events (
        source_kind,
        source_reference,
        request_fingerprint,
        event_version,
        actor_kind,
        actor_subject,
        merchant_id,
        environment,
        action,
        resource_type,
        resource_id,
        reason_code,
        reason_note,
        request_id,
        trace_id,
        metadata,
        occurred_at
    ) values (
        p_source_kind,
        p_source_reference,
        p_request_fingerprint,
        p_event_version,
        p_actor_kind,
        p_actor_subject,
        p_merchant_id,
        p_environment,
        p_action,
        p_resource_type,
        p_resource_id,
        p_reason_code,
        p_reason_note,
        p_request_id,
        p_trace_id,
        p_metadata,
        p_occurred_at
    )
    on conflict (source_kind, source_reference) do nothing
    returning id into v_event_id;

    if v_event_id is not null then
        return v_event_id;
    end if;

    select e.*
      into strict v_existing
      from app.audit_events e
     where e.source_kind = p_source_kind
       and e.source_reference = p_source_reference;

    if v_existing.request_fingerprint is distinct from p_request_fingerprint
       or v_existing.event_version is distinct from p_event_version
       or v_existing.actor_kind is distinct from p_actor_kind
       or v_existing.actor_subject is distinct from p_actor_subject
       or v_existing.merchant_id is distinct from p_merchant_id
       or v_existing.environment is distinct from p_environment
       or v_existing.action is distinct from p_action
       or v_existing.resource_type is distinct from p_resource_type
       or v_existing.resource_id is distinct from p_resource_id
       or v_existing.reason_code is distinct from p_reason_code
       or v_existing.reason_note is distinct from p_reason_note
       or v_existing.request_id is distinct from p_request_id
       or v_existing.trace_id is distinct from p_trace_id
       or v_existing.metadata is distinct from p_metadata
       or v_existing.occurred_at is distinct from p_occurred_at then
        raise exception 'audit source identity already exists with different immutable data'
            using errcode = '23505';
    end if;

    return v_existing.id;
end;
$$;

create or replace function app.reject_audit_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, app
as $$
begin
    raise exception 'audit history is append-only'
        using errcode = '23514';
end;
$$;

revoke all on function app.record_audit_event(
    text,text,text,integer,text,text,uuid,text,text,text,text,text,text,text,text,jsonb,timestamptz
) from public, anon, authenticated, service_role;
revoke all on function app.reject_audit_event_mutation()
    from public, anon, authenticated, service_role;
