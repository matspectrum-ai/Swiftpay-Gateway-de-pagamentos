create or replace function app.consume_api_abuse_quota(
  p_policy text,
  p_active_subject_hash text,
  p_previous_subject_hash text default null
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer;
  v_canonical_window_started_at timestamptz;
  v_canonical_request_count integer;
  v_request_count_after integer;
  v_allowed boolean;
  v_remaining integer;
  v_retry_after_seconds integer;
begin
  if p_active_subject_hash is null or p_active_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid abuse quota subject';
  end if;
  if p_previous_subject_hash is not null and p_previous_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid abuse quota subject';
  end if;
  if p_previous_subject_hash = p_active_subject_hash then
    raise exception 'duplicate abuse quota subjects';
  end if;

  v_limit := case p_policy
    when 'token_exchange_pre_auth' then 30
    when 'machine_request_pre_auth' then 12000
    when 'machine_read' then 6000
    when 'machine_mutation' then 3000
    when 'dashboard_request_pre_auth' then 300
    when 'readiness_probe' then 120
    else null
  end;

  if v_limit is null then
    raise exception 'invalid abuse quota policy';
  end if;

  delete from app.api_abuse_windows as target
  using (
    select candidate.ctid
    from app.api_abuse_windows as candidate
    where candidate.updated_at < v_now - interval '24 hours'
    order by candidate.updated_at asc
    limit 32
  ) as stale
  where target.ctid = stale.ctid;

  -- Insert both rotation identities in one canonical lexical order. Reversed
  -- active/previous calls must acquire unique-index conflicts in the same order
  -- before the row-level FOR UPDATE below, otherwise they can deadlock while
  -- each transaction is still materializing the missing counterpart row.
  insert into app.api_abuse_windows (
    policy,
    subject_hash,
    window_started_at,
    request_count,
    updated_at
  )
  select
    p_policy,
    subject.subject_hash,
    v_now - interval '60 seconds',
    0,
    v_now
  from (
    select p_active_subject_hash as subject_hash
    union all
    select p_previous_subject_hash
    where p_previous_subject_hash is not null
  ) as subject
  order by subject.subject_hash asc
  on conflict (policy, subject_hash) do nothing;

  perform abuse_window.subject_hash
  from app.api_abuse_windows as abuse_window
  where abuse_window.policy = p_policy
    and (
      abuse_window.subject_hash = p_active_subject_hash
      or (
        p_previous_subject_hash is not null
        and abuse_window.subject_hash = p_previous_subject_hash
      )
    )
  order by abuse_window.subject_hash asc
  for update;

  select
    max(abuse_window.window_started_at),
    max(abuse_window.request_count)
  into
    v_canonical_window_started_at,
    v_canonical_request_count
  from app.api_abuse_windows as abuse_window
  where abuse_window.policy = p_policy
    and (
      abuse_window.subject_hash = p_active_subject_hash
      or (
        p_previous_subject_hash is not null
        and abuse_window.subject_hash = p_previous_subject_hash
      )
    )
    and v_now < abuse_window.window_started_at + interval '60 seconds';

  if v_canonical_window_started_at is null then
    v_canonical_window_started_at := v_now;
    v_canonical_request_count := 0;
  end if;

  if v_canonical_request_count < v_limit then
    v_request_count_after := v_canonical_request_count + 1;
    v_allowed := true;
    v_remaining := v_limit - v_request_count_after;
    v_retry_after_seconds := 0;
  else
    v_request_count_after := v_canonical_request_count;
    v_allowed := false;
    v_remaining := 0;
    v_retry_after_seconds := greatest(
      1,
      least(
        60,
        ceil(extract(epoch from ((v_canonical_window_started_at + interval '60 seconds') - v_now)))::integer
      )
    );
  end if;

  update app.api_abuse_windows as abuse_window
  set window_started_at = v_canonical_window_started_at,
      request_count = v_request_count_after,
      updated_at = v_now
  where abuse_window.policy = p_policy
    and (
      abuse_window.subject_hash = p_active_subject_hash
      or (
        p_previous_subject_hash is not null
        and abuse_window.subject_hash = p_previous_subject_hash
      )
    );

  return query select v_allowed, v_remaining, v_retry_after_seconds;
end;
$$;

revoke all on function app.consume_api_abuse_quota(text, text, text) from public;
revoke all on function app.consume_api_abuse_quota(text, text, text) from anon;
revoke all on function app.consume_api_abuse_quota(text, text, text) from authenticated;
revoke all on function app.consume_api_abuse_quota(text, text, text) from service_role;
revoke all on function app.consume_api_abuse_quota(text, text, text) from swiftpay_worker;
grant execute on function app.consume_api_abuse_quota(text, text, text) to swiftpay_api;
