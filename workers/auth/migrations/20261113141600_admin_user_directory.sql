begin;

create index if not exists device_login_sessions_user_id_idx
  on public.device_login_sessions (user_id);

create function public.admin_user_directory(
  p_search text, p_exact_email boolean, p_account_status text,
  p_verification text, p_subscription text, p_sort text, p_page integer, p_limit integer
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with clock as (
    select date_trunc('milliseconds', statement_timestamp()) as now_at
  ), profiles as (
    select p.firebase_uid, p.normalized_email as email, p.display_name, p.locale,
           p.account_status, p.email_verified, p.email_verified_at,
           p.verification_source, p.created_at, p.updated_at
    from public.account_profiles p
    where (p_account_status = '' or p.account_status = p_account_status)
      and (p_verification = '' or
           (p_verification = 'verified') = (p.email_verified or p.email_verified_at is not null))
      and (
        (p_exact_email and p.normalized_email = lower(p_search))
        or (not p_exact_email and (p_search = ''
          or strpos(lower(p.firebase_uid), lower(p_search)) > 0
          or strpos(lower(p.normalized_email), lower(p_search)) > 0
          or strpos(lower(coalesce(p.display_name, '')), lower(p_search)) > 0))
      )
  ), with_subscription as (
    select p.*, case
      when s.invalid_count > 0 or s.current_count > 1 then 'integrity_conflict'
      when s.current_count = 1 then 'active'
      when s.total > 0 then 'history_only'
      else 'none'
    end as subscription_presence
    from profiles p
    cross join clock c
    cross join lateral (
      select count(*) as total,
             count(*) filter (where lifecycle = 'integrity_conflict') as invalid_count,
             count(*) filter (where lifecycle in ('trialing', 'active', 'past_due', 'cancel_at_period_end')) as current_count
      from (
        -- Keep the directory's classification in parity with subscriptionLifecycle.
        select case
          when date_trunc('milliseconds', coalesce(s.period_start_at, s.starts_at)) > c.now_at then null
          when flags.explicit_state <> '' and flags.lifecycle not in
            ('trialing', 'active', 'past_due', 'cancel_at_period_end', 'cancelled', 'expired', 'suspended') then 'integrity_conflict'
          when flags.lifecycle in ('suspended', 'cancelled') then flags.lifecycle
          when not flags.lifetime and date_trunc('milliseconds', coalesce(s.period_end_at, s.expires_at)) <= c.now_at then 'expired'
          when s.cancel_at_period_end or lower(btrim(coalesce(s.metadata->>'cancel_at_period_end', ''))) = 'true'
            or flags.lifecycle = 'cancel_at_period_end' then 'cancel_at_period_end'
          when flags.lifecycle in ('trialing', 'past_due', 'expired', 'active') then flags.lifecycle
          else 'integrity_conflict'
        end as lifecycle
        from public.account_subscriptions s
        cross join lateral (
          select lower(btrim(coalesce(s.lifecycle_state, ''))) as explicit_state,
                 lower(coalesce(nullif(btrim(s.lifecycle_state), ''), s.status::text)) as raw_state
        ) raw
        cross join lateral (
          select raw.explicit_state,
                 case raw.raw_state when 'trial' then 'trialing' when 'canceled' then 'cancelled' else raw.raw_state end as lifecycle,
                 lower(btrim(coalesce(nullif(s.plan_term, ''), nullif(s.metadata->>'plan_term', ''), s.metadata->>'plan_intent', ''))) = 'lifetime'
                   or lower(btrim(coalesce(s.metadata->>'is_unlimited', ''))) = 'true'
                   or coalesce(s.period_end_at, s.expires_at) >= '9999-01-01 00:00:00+00'::timestamptz as lifetime
        ) flags
        where s.firebase_user_id = p.firebase_uid
      ) evaluated
    ) s
  ), matching as materialized (
    select p.*
    from with_subscription p
    where p_subscription = '' or p.subscription_presence = p_subscription
  ), ranked as (
    select p.*, case when p_sort = 'activity_desc' then greatest(
      (select max(coalesce(s.last_seen_at, s.created_at)) from public.app_sessions s where s.user_id = p.firebase_uid),
      (select max(coalesce(l.consumed_at, l.authorized_at, l.created_at, l.expires_at))
         from public.device_login_sessions l where l.user_id = p.firebase_uid)
    ) end as activity_sort
    from matching p
  ), page as (
    select p.* from ranked p
    order by
      case when p_sort = 'activity_desc' then p.activity_sort end desc nulls last,
      case when p_sort = 'name_asc' then lower(coalesce(nullif(p.display_name, ''), p.email)) end asc,
      case when p_sort = 'created_desc' then p.created_at end desc,
      p.firebase_uid asc
    limit greatest(1, least(p_limit, 100)) offset (greatest(1, p_page)::bigint - 1) * greatest(1, least(p_limit, 100))
  ), projected as (
    select p.*, activity.session_count, activity.device_count, activity.last_activity_at
    from page p
    cross join clock c
    cross join lateral (
      select count(*) filter (where entry.active_session) as session_count,
             count(distinct nullif(entry.hwid, '')) as device_count,
             max(entry.last_at) as last_activity_at
      from (
        select s.hwid, s.revoked_at is null and s.expires_at > c.now_at as active_session,
               coalesce(s.last_seen_at, s.created_at) as last_at
        from public.app_sessions s where s.user_id = p.firebase_uid
        union all
        select l.hwid, false, coalesce(l.consumed_at, l.authorized_at, l.created_at, l.expires_at)
        from public.device_login_sessions l where l.user_id = p.firebase_uid
      ) entry
    ) activity
  )
  select jsonb_build_object(
    'total', (select count(*) from matching),
    'items', coalesce((
      select jsonb_agg(to_jsonb(p) - 'activity_sort' order by
        case when p_sort = 'activity_desc' then p.activity_sort end desc nulls last,
        case when p_sort = 'name_asc' then lower(coalesce(nullif(p.display_name, ''), p.email)) end asc,
        case when p_sort = 'created_desc' then p.created_at end desc,
        p.firebase_uid asc)
      from projected p
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_user_directory(text, boolean, text, text, text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_user_directory(text, boolean, text, text, text, text, integer, integer)
  to service_role;

commit;
