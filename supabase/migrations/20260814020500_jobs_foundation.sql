-- SwiftPay V2 Phase 2: durable PostgreSQL jobs/outbox foundation.
-- Delivery is at-least-once; business and financial exactly-once semantics remain
-- enforced by canonical resource/source constraints outside this table.

create table app.jobs (
    id uuid primary key default gen_random_uuid(),
    kind text not null,
    resource_type text,
    resource_id uuid,
    dedupe_key text,
    payload_version integer not null,
    payload jsonb not null,
    state text not null default 'pending',
    attempt_count integer not null default 0,
    max_attempts integer not null default 5,
    available_at timestamptz not null default now(),
    lease_owner text,
    lease_token uuid,
    lease_expires_at timestamptz,
    last_started_at timestamptz,
    last_finished_at timestamptz,
    last_error_class text,
    last_error_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,

    constraint jobs_kind_nonempty_ck
        check (length(trim(kind)) > 0),
    constraint jobs_resource_pair_ck
        check ((resource_type is null) = (resource_id is null)),
    constraint jobs_dedupe_nonempty_ck
        check (dedupe_key is null or length(trim(dedupe_key)) > 0),
    constraint jobs_payload_version_positive_ck
        check (payload_version > 0),
    constraint jobs_state_ck
        check (state in ('pending', 'leased', 'completed', 'dead')),
    constraint jobs_attempt_count_ck
        check (attempt_count >= 0),
    constraint jobs_max_attempts_ck
        check (max_attempts > 0),
    constraint jobs_attempt_ceiling_ck
        check (attempt_count <= max_attempts),
    constraint jobs_lease_shape_ck
        check (
            (state = 'leased'
                and lease_owner is not null
                and length(trim(lease_owner)) > 0
                and lease_token is not null
                and lease_expires_at is not null)
            or
            (state <> 'leased'
                and lease_owner is null
                and lease_token is null
                and lease_expires_at is null)
        ),
    constraint jobs_completion_shape_ck
        check (
            (state = 'completed' and completed_at is not null)
            or
            (state <> 'completed' and completed_at is null)
        )
);

create unique index jobs_dedupe_uq
    on app.jobs (dedupe_key)
    where dedupe_key is not null;

create index jobs_due_idx
    on app.jobs (state, available_at, lease_expires_at, created_at, id)
    where state in ('pending', 'leased');

create index jobs_resource_idx
    on app.jobs (resource_type, resource_id, created_at)
    where resource_type is not null and resource_id is not null;

create or replace function app.enqueue_job(
    p_kind text,
    p_resource_type text,
    p_resource_id uuid,
    p_dedupe_key text,
    p_payload jsonb,
    p_payload_version integer,
    p_max_attempts integer,
    p_available_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_id uuid;
    v_existing app.jobs%rowtype;
begin
    if p_kind is null or length(trim(p_kind)) = 0 then
        raise exception 'job kind is required' using errcode = '23514';
    end if;

    if (p_resource_type is null) <> (p_resource_id is null) then
        raise exception 'job resource_type/resource_id must be both null or both present'
            using errcode = '23514';
    end if;

    if p_dedupe_key is not null and length(trim(p_dedupe_key)) = 0 then
        raise exception 'job dedupe key cannot be blank' using errcode = '23514';
    end if;

    if p_payload is null then
        raise exception 'job payload is required' using errcode = '23514';
    end if;

    if p_payload_version is null or p_payload_version <= 0 then
        raise exception 'job payload version must be positive' using errcode = '23514';
    end if;

    if p_max_attempts is null or p_max_attempts <= 0 then
        raise exception 'job max_attempts must be positive' using errcode = '23514';
    end if;

    if p_available_at is null then
        raise exception 'job available_at is required' using errcode = '23514';
    end if;

    if p_dedupe_key is null then
        insert into app.jobs (
            kind, resource_type, resource_id, dedupe_key,
            payload_version, payload, max_attempts, available_at
        ) values (
            p_kind, p_resource_type, p_resource_id, null,
            p_payload_version, p_payload, p_max_attempts, p_available_at
        )
        returning id into v_id;

        return v_id;
    end if;

    insert into app.jobs (
        kind, resource_type, resource_id, dedupe_key,
        payload_version, payload, max_attempts, available_at
    ) values (
        p_kind, p_resource_type, p_resource_id, p_dedupe_key,
        p_payload_version, p_payload, p_max_attempts, p_available_at
    )
    on conflict (dedupe_key) where dedupe_key is not null
    do nothing
    returning id into v_id;

    if v_id is not null then
        return v_id;
    end if;

    select *
      into strict v_existing
      from app.jobs
     where dedupe_key = p_dedupe_key;

    -- A dedupe key is an identity, not a "last writer wins" key. Reusing it
    -- with different logical work is a caller bug and must fail loudly.
    if v_existing.kind is distinct from p_kind
       or v_existing.resource_type is distinct from p_resource_type
       or v_existing.resource_id is distinct from p_resource_id
       or v_existing.payload_version is distinct from p_payload_version
       or v_existing.payload is distinct from p_payload
       or v_existing.max_attempts is distinct from p_max_attempts then
        raise exception 'job dedupe key reused with different logical work: %', p_dedupe_key
            using errcode = '23505';
    end if;

    return v_existing.id;
end;
$$;

create or replace function app.claim_jobs(
    p_worker_id text,
    p_limit integer,
    p_lease_seconds integer
)
returns setof app.jobs
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
    if p_worker_id is null or length(trim(p_worker_id)) = 0 then
        raise exception 'worker id is required' using errcode = '23514';
    end if;

    if p_limit is null or p_limit <= 0 then
        raise exception 'claim limit must be positive' using errcode = '23514';
    end if;

    if p_lease_seconds is null or p_lease_seconds <= 0 then
        raise exception 'lease seconds must be positive' using errcode = '23514';
    end if;

    return query
    with candidates as (
        select j.id
          from app.jobs j
         where j.attempt_count < j.max_attempts
           and (
                (j.state = 'pending' and j.available_at <= now())
                or
                (j.state = 'leased' and j.lease_expires_at <= now())
           )
         order by
             case when j.state = 'leased' then j.lease_expires_at else j.available_at end,
             j.created_at,
             j.id
         for update skip locked
         limit p_limit
    ), claimed as (
        update app.jobs j
           set state = 'leased',
               attempt_count = j.attempt_count + 1,
               lease_owner = p_worker_id,
               lease_token = gen_random_uuid(),
               lease_expires_at = now() + make_interval(secs => p_lease_seconds),
               last_started_at = now(),
               updated_at = now()
          from candidates c
         where j.id = c.id
         returning j.*
    )
    select * from claimed;
end;
$$;

create or replace function app.complete_job(
    p_job_id uuid,
    p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_updated integer;
begin
    if p_job_id is null or p_lease_token is null then
        return false;
    end if;

    update app.jobs
       set state = 'completed',
           lease_owner = null,
           lease_token = null,
           lease_expires_at = null,
           last_finished_at = now(),
           completed_at = now(),
           updated_at = now()
     where id = p_job_id
       and state = 'leased'
       and lease_token = p_lease_token;

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

create or replace function app.reschedule_job(
    p_job_id uuid,
    p_lease_token uuid,
    p_error_class text,
    p_error_code text,
    p_retry_after_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
    v_updated integer;
begin
    if p_job_id is null or p_lease_token is null then
        return false;
    end if;

    if p_retry_after_seconds is null or p_retry_after_seconds < 0 then
        raise exception 'retry delay must be non-negative' using errcode = '23514';
    end if;

    update app.jobs
       set state = case
                       when attempt_count >= max_attempts then 'dead'
                       else 'pending'
                   end,
           available_at = case
                              when attempt_count >= max_attempts then available_at
                              else now() + make_interval(secs => p_retry_after_seconds)
                          end,
           lease_owner = null,
           lease_token = null,
           lease_expires_at = null,
           last_finished_at = now(),
           last_error_class = p_error_class,
           last_error_code = p_error_code,
           updated_at = now()
     where id = p_job_id
       and state = 'leased'
       and lease_token = p_lease_token;

    get diagnostics v_updated = row_count;
    return v_updated = 1;
end;
$$;

revoke all on app.jobs from anon, authenticated, service_role;

revoke all on function app.enqueue_job(text, text, uuid, text, jsonb, integer, integer, timestamptz)
    from public, anon, authenticated, service_role;
revoke all on function app.claim_jobs(text, integer, integer)
    from public, anon, authenticated, service_role;
revoke all on function app.complete_job(uuid, uuid)
    from public, anon, authenticated, service_role;
revoke all on function app.reschedule_job(uuid, uuid, text, text, integer)
    from public, anon, authenticated, service_role;
