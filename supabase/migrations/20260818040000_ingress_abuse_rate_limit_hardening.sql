create table app.api_abuse_windows (
  policy text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null,
  constraint api_abuse_windows_pkey primary key (policy, subject_hash),
  constraint api_abuse_windows_policy_check check (
    policy in (
      'token_exchange_pre_auth',
      'machine_request_pre_auth',
      'machine_read',
      'machine_mutation',
      'dashboard_request_pre_auth',
      'readiness_probe'
    )
  ),
  constraint api_abuse_windows_subject_hash_check check (subject_hash ~ '^[0-9a-f]{64}$'),
  constraint api_abuse_windows_request_count_check check (request_count >= 0)
);

create index api_abuse_windows_updated_at_idx
  on app.api_abuse_windows (updated_at asc);

revoke all on table app.api_abuse_windows from public;
revoke all on table app.api_abuse_windows from anon;
revoke all on table app.api_abuse_windows from authenticated;
revoke all on table app.api_abuse_windows from service_role;
revoke all on table app.api_abuse_windows from swiftpay_api;
revoke all on table app.api_abuse_windows from swiftpay_worker;

create or replace function app.consume_api_abuse_quota(
  p_policy text,
  p_subject_hash text
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
  v_window_started_at timestamptz;
  v_request_count integer;
  v_allowed boolean;
  v_remaining integer;
  v_retry_after_seconds integer;
begin
  if p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid abuse quota subject';
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

  insert into app.api_abuse_windows (
    policy,
    subject_hash,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_policy,
    p_subject_hash,
    v_now,
    0,
    v_now
  )
  on conflict (policy, subject_hash) do nothing;

  select abuse_window.window_started_at, abuse_window.request_count
    into strict v_window_started_at, v_request_count
  from app.api_abuse_windows as abuse_window
  where abuse_window.policy = p_policy
    and abuse_window.subject_hash = p_subject_hash
  for update;

  if v_now >= v_window_started_at + interval '60 seconds' then
    v_request_count := 1;
    v_window_started_at := v_now;
    v_allowed := true;
    v_remaining := v_limit - 1;
    v_retry_after_seconds := 0;
  elsif v_request_count < v_limit then
    v_request_count := v_request_count + 1;
    v_allowed := true;
    v_remaining := v_limit - v_request_count;
    v_retry_after_seconds := 0;
  else
    v_allowed := false;
    v_remaining := 0;
    v_retry_after_seconds := greatest(
      1,
      least(
        60,
        ceil(extract(epoch from ((v_window_started_at + interval '60 seconds') - v_now)))::integer
      )
    );
  end if;

  update app.api_abuse_windows as abuse_window
  set window_started_at = v_window_started_at,
      request_count = v_request_count,
      updated_at = v_now
  where abuse_window.policy = p_policy
    and abuse_window.subject_hash = p_subject_hash;

  return query select v_allowed, v_remaining, v_retry_after_seconds;
end;
$$;

revoke all on function app.consume_api_abuse_quota(text, text) from public;
revoke all on function app.consume_api_abuse_quota(text, text) from anon;
revoke all on function app.consume_api_abuse_quota(text, text) from authenticated;
revoke all on function app.consume_api_abuse_quota(text, text) from service_role;
revoke all on function app.consume_api_abuse_quota(text, text) from swiftpay_worker;
grant execute on function app.consume_api_abuse_quota(text, text) to swiftpay_api;
