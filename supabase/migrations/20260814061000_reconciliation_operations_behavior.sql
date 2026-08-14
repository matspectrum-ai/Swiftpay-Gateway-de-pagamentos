-- SwiftPay V2 Phase 2 / I2: durable reconciliation operations behavior.
--
-- This slice persists reconciliation observations and operator classification
-- only. It deliberately cannot repair domain state, append financial postings,
-- apply provider evidence, or enqueue corrective work.

create or replace function app.capture_internal_reconciliation_run(
    p_environment text,
    p_detector_version text,
    p_scope jsonb,
    p_started_at timestamptz,
    p_completed_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_run_id uuid;
    v_discrepancy_id uuid;
    v_finding record;
    v_finding_count bigint := 0;
begin
    if p_environment is null
       or p_environment not in ('sandbox', 'production')
       or p_detector_version is null
       or length(trim(p_detector_version)) = 0
       or p_scope is null
       or jsonb_typeof(p_scope) <> 'object'
       or p_started_at is null
       or p_completed_at is null
       or p_completed_at < p_started_at then
        raise exception 'invalid internal reconciliation capture request'
            using errcode = '23514';
    end if;

    insert into app.reconciliation_runs (
        layer,
        environment,
        scope,
        detector_version,
        status,
        started_at,
        completed_at,
        finding_count,
        created_at
    ) values (
        'internal',
        p_environment,
        p_scope,
        p_detector_version,
        'completed',
        p_started_at,
        p_completed_at,
        0,
        p_completed_at
    )
    returning id into v_run_id;

    for v_finding in
        select
            f.environment,
            f.discrepancy_type,
            f.stable_key,
            f.resource_type,
            f.resource_id,
            f.account_id,
            f.expected_cents,
            f.actual_cents,
            f.detail
        from app.internal_reconciliation_findings f
        where f.environment = p_environment
        order by f.stable_key
    loop
        insert into app.reconciliation_discrepancies as d (
            layer,
            environment,
            discrepancy_type,
            stable_key,
            resource_type,
            resource_id,
            account_id,
            expected_cents,
            actual_cents,
            detail,
            lifecycle_state,
            first_seen_at,
            last_seen_at,
            occurrence_count,
            first_run_id,
            last_run_id,
            created_at,
            updated_at
        ) values (
            'internal',
            v_finding.environment,
            v_finding.discrepancy_type,
            v_finding.stable_key,
            v_finding.resource_type,
            v_finding.resource_id,
            v_finding.account_id,
            v_finding.expected_cents,
            v_finding.actual_cents,
            v_finding.detail,
            'open',
            p_completed_at,
            p_completed_at,
            1,
            v_run_id,
            v_run_id,
            p_completed_at,
            p_completed_at
        )
        on conflict (layer, environment, stable_key)
        do update set
            discrepancy_type = excluded.discrepancy_type,
            resource_type = excluded.resource_type,
            resource_id = excluded.resource_id,
            account_id = excluded.account_id,
            expected_cents = excluded.expected_cents,
            actual_cents = excluded.actual_cents,
            detail = excluded.detail,
            last_seen_at = excluded.last_seen_at,
            occurrence_count = d.occurrence_count + 1,
            last_run_id = excluded.last_run_id,
            updated_at = excluded.updated_at
        returning id into v_discrepancy_id;

        insert into app.reconciliation_run_observations (
            run_id,
            discrepancy_id,
            discrepancy_type,
            stable_key,
            resource_type,
            resource_id,
            account_id,
            expected_cents,
            actual_cents,
            detail,
            observed_at,
            created_at
        ) values (
            v_run_id,
            v_discrepancy_id,
            v_finding.discrepancy_type,
            v_finding.stable_key,
            v_finding.resource_type,
            v_finding.resource_id,
            v_finding.account_id,
            v_finding.expected_cents,
            v_finding.actual_cents,
            v_finding.detail,
            p_completed_at,
            p_completed_at
        );

        v_finding_count := v_finding_count + 1;
    end loop;

    update app.reconciliation_runs
       set finding_count = v_finding_count
     where id = v_run_id;

    return v_run_id;
end;
$$;

create or replace function app.acknowledge_reconciliation_discrepancy(
    p_discrepancy_id uuid,
    p_actor_type text,
    p_actor_id text,
    p_note text,
    p_acted_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_discrepancy app.reconciliation_discrepancies%rowtype;
begin
    if p_discrepancy_id is null
       or p_actor_type is null or length(trim(p_actor_type)) = 0
       or p_actor_id is null or length(trim(p_actor_id)) = 0
       or p_note is null or length(trim(p_note)) = 0
       or p_acted_at is null then
        raise exception 'invalid reconciliation acknowledgement request'
            using errcode = '23514';
    end if;

    select *
      into v_discrepancy
      from app.reconciliation_discrepancies
     where id = p_discrepancy_id
     for update;

    if not found then
        raise exception 'reconciliation discrepancy not found'
            using errcode = '23514';
    end if;

    if v_discrepancy.lifecycle_state = 'resolved' then
        raise exception 'resolved reconciliation discrepancy cannot be acknowledged'
            using errcode = '23514';
    end if;

    if v_discrepancy.lifecycle_state = 'acknowledged' then
        if v_discrepancy.acknowledged_at = p_acted_at
           and v_discrepancy.acknowledged_by_actor_type = p_actor_type
           and v_discrepancy.acknowledged_by_actor_id = p_actor_id
           and v_discrepancy.acknowledgement_note = p_note then
            return v_discrepancy.id;
        end if;

        raise exception 'reconciliation discrepancy already acknowledged with different metadata'
            using errcode = '23514';
    end if;

    update app.reconciliation_discrepancies
       set lifecycle_state = 'acknowledged',
           acknowledged_at = p_acted_at,
           acknowledged_by_actor_type = p_actor_type,
           acknowledged_by_actor_id = p_actor_id,
           acknowledgement_note = p_note,
           updated_at = p_acted_at
     where id = p_discrepancy_id;

    insert into app.reconciliation_discrepancy_events (
        discrepancy_id,
        event_type,
        actor_type,
        actor_id,
        note,
        resolution_code,
        created_at
    ) values (
        p_discrepancy_id,
        'acknowledged',
        p_actor_type,
        p_actor_id,
        p_note,
        null,
        p_acted_at
    );

    return p_discrepancy_id;
end;
$$;

create or replace function app.resolve_reconciliation_discrepancy(
    p_discrepancy_id uuid,
    p_actor_type text,
    p_actor_id text,
    p_resolution_code text,
    p_note text,
    p_acted_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_discrepancy app.reconciliation_discrepancies%rowtype;
begin
    if p_discrepancy_id is null
       or p_actor_type is null or length(trim(p_actor_type)) = 0
       or p_actor_id is null or length(trim(p_actor_id)) = 0
       or p_resolution_code is null or length(trim(p_resolution_code)) = 0
       or p_note is null or length(trim(p_note)) = 0
       or p_acted_at is null then
        raise exception 'invalid reconciliation resolution request'
            using errcode = '23514';
    end if;

    select *
      into v_discrepancy
      from app.reconciliation_discrepancies
     where id = p_discrepancy_id
     for update;

    if not found then
        raise exception 'reconciliation discrepancy not found'
            using errcode = '23514';
    end if;

    if v_discrepancy.lifecycle_state = 'resolved' then
        if v_discrepancy.resolved_at = p_acted_at
           and v_discrepancy.resolved_by_actor_type = p_actor_type
           and v_discrepancy.resolved_by_actor_id = p_actor_id
           and v_discrepancy.resolution_code = p_resolution_code
           and v_discrepancy.resolution_note = p_note then
            return v_discrepancy.id;
        end if;

        raise exception 'reconciliation discrepancy already resolved with different metadata'
            using errcode = '23514';
    end if;

    update app.reconciliation_discrepancies
       set lifecycle_state = 'resolved',
           resolved_at = p_acted_at,
           resolved_by_actor_type = p_actor_type,
           resolved_by_actor_id = p_actor_id,
           resolution_code = p_resolution_code,
           resolution_note = p_note,
           updated_at = p_acted_at
     where id = p_discrepancy_id;

    insert into app.reconciliation_discrepancy_events (
        discrepancy_id,
        event_type,
        actor_type,
        actor_id,
        note,
        resolution_code,
        created_at
    ) values (
        p_discrepancy_id,
        'resolved',
        p_actor_type,
        p_actor_id,
        p_note,
        p_resolution_code,
        p_acted_at
    );

    return p_discrepancy_id;
end;
$$;

create or replace function app.reject_reconciliation_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    raise exception 'reconciliation history is append-only'
        using errcode = '23514';
end;
$$;

create trigger reconciliation_run_observations_append_only_trg
before update or delete on app.reconciliation_run_observations
for each row execute function app.reject_reconciliation_history_mutation();

create trigger reconciliation_discrepancy_events_append_only_trg
before update or delete on app.reconciliation_discrepancy_events
for each row execute function app.reject_reconciliation_history_mutation();

revoke all on function app.capture_internal_reconciliation_run(text,text,jsonb,timestamptz,timestamptz)
    from public, anon, authenticated, service_role;
revoke all on function app.acknowledge_reconciliation_discrepancy(uuid,text,text,text,timestamptz)
    from public, anon, authenticated, service_role;
revoke all on function app.resolve_reconciliation_discrepancy(uuid,text,text,text,text,timestamptz)
    from public, anon, authenticated, service_role;
revoke all on function app.reject_reconciliation_history_mutation()
    from public, anon, authenticated, service_role;
