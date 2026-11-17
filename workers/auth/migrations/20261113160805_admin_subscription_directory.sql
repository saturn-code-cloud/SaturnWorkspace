begin;

create function public.admin_subscription_directory(
  p_search text, p_lifecycle text, p_plan_term text, p_source text,
  p_current text, p_integrity text, p_page integer, p_limit integer,
  p_record_id uuid default null, p_owner_uid text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with clock as (
    select date_trunc('milliseconds', statement_timestamp()) as now_at
  ), evaluated as materialized (
    select s.id, coalesce(btrim(s.firebase_user_id), '') as uid, s.updated_at, s.created_at, s.is_current,
      to_jsonb(s) as record,
      case
        when date_trunc('milliseconds', coalesce(s.period_start_at, s.starts_at)) > c.now_at then null
        when raw.explicit_state <> '' and flags.lifecycle not in
          ('trialing','active','past_due','cancel_at_period_end','cancelled','expired','suspended') then 'integrity_conflict'
        when flags.lifecycle in ('suspended','cancelled') then flags.lifecycle
        when not flags.lifetime and date_trunc('milliseconds', coalesce(s.period_end_at,s.expires_at)) <= c.now_at then 'expired'
        when s.cancel_at_period_end or lower(btrim(coalesce(s.metadata->>'cancel_at_period_end',''))) = 'true'
          or flags.lifecycle = 'cancel_at_period_end' then 'cancel_at_period_end'
        when flags.lifecycle in ('trialing','past_due','expired','active') then flags.lifecycle
        else 'integrity_conflict'
      end as lifecycle,
      case
        when flags.lifetime then 'lifetime'
        when raw.plan_term in ('yearly','annual') then 'annual'
        when raw.plan_term in ('weekly','monthly','custom') then raw.plan_term
        else 'custom'
      end as plan_term,
      lower(coalesce(nullif(btrim(s.source_type),''),s.provider)) as source,
      p_search = '' or exists (
        select 1 from unnest(array[s.user_email,s.firebase_user_id,s.hwid,s.status::text,s.tier::text,s.plan::text]) v
        where strpos(lower(v),lower(p_search)) > 0
      ) as search_match
    from public.account_subscriptions s
    cross join clock c
    cross join lateral (
      select lower(btrim(coalesce(s.lifecycle_state,''))) as explicit_state,
        lower(coalesce(nullif(btrim(s.lifecycle_state),''),s.status::text)) as raw_state,
        lower(btrim(coalesce(nullif(s.plan_term,''),nullif(s.metadata->>'plan_term',''),nullif(s.metadata->>'plan_intent',''),s.plan::text))) as plan_term
    ) raw
    cross join lateral (
      select case raw.raw_state when 'trial' then 'trialing' when 'canceled' then 'cancelled' else raw.raw_state end as lifecycle,
        raw.plan_term = 'lifetime' or lower(btrim(coalesce(s.metadata->>'is_unlimited',''))) = 'true'
          or coalesce(s.period_end_at,s.expires_at) >= '9999-01-01 00:00:00+00'::timestamptz as lifetime
    ) flags
  ), owner_states as (
    select uid,
      count(*) filter (where lifecycle = 'integrity_conflict') as invalid_count,
      count(*) filter (where lifecycle in ('trialing','active','past_due','cancel_at_period_end')) as current_count
    from evaluated where uid <> '' group by uid
  ), matching as materialized (
    select s.* from evaluated s left join owner_states o using(uid)
    where s.search_match
      and (p_record_id is null or s.id = p_record_id)
      and (p_owner_uid is null or s.uid = p_owner_uid)
      and (p_lifecycle = '' or s.lifecycle = p_lifecycle)
      and (p_plan_term = '' or s.plan_term = p_plan_term)
      and (p_source = '' or s.source = p_source)
      and (p_current = '' or (p_current = 'current') = coalesce(s.is_current,false))
      and (p_integrity = '' or s.uid = '' or o.invalid_count > 0 or o.current_count > 1)
  ), page as materialized (
    select * from matching
    order by coalesce(updated_at,created_at) desc, id
    limit greatest(1,least(p_limit,100))
    offset (greatest(1,p_page)::bigint - 1) * greatest(1,least(p_limit,100))
  ), witness_candidates as (
    select e.*,
      row_number() over(partition by e.uid, (e.lifecycle = 'integrity_conflict') order by e.id) as n
    from evaluated e
    where e.uid <> '' and e.uid in (select p.uid from page p)
      and e.lifecycle in ('trialing','active','past_due','cancel_at_period_end','integrity_conflict')
  )
  select jsonb_build_object(
    'as_of', (select now_at from clock),
    'total', (select count(*) from matching),
    'items', coalesce((select jsonb_agg(p.record order by coalesce(p.updated_at,p.created_at) desc,p.id) from page p),'[]'::jsonb),
    'witnesses', coalesce((select jsonb_agg(w.record) from witness_candidates w
      where w.n <= case when w.lifecycle = 'integrity_conflict' then 1 else 2 end),'[]'::jsonb)
  );
$$;

revoke all on function public.admin_subscription_directory(text,text,text,text,text,text,integer,integer,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_subscription_directory(text,text,text,text,text,text,integer,integer,uuid,text)
  to service_role;
commit;
