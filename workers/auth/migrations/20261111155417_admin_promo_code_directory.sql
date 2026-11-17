begin;

create or replace view public.admin_promo_code_directory
with (security_invoker = true)
as
select
  id, code, title, discount_type, discount_value, currency,
  is_private_tier_trigger, is_active, max_uses, used_count,
  starts_at, expires_at, created_at, updated_at,
  case
    when not is_active then 'paused'
    when starts_at is not null and starts_at > current_timestamp then 'scheduled'
    when expires_at is not null and expires_at <= current_timestamp then 'expired'
    when max_uses is not null and used_count >= max_uses then 'exhausted'
    else 'active'
  end as effective_status
from public.promo_codes;

revoke all on public.admin_promo_code_directory from public, anon, authenticated, service_role;
grant select on public.admin_promo_code_directory to service_role;

create or replace function public.touch_promo_code_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

drop trigger if exists promo_codes_touch_updated_at on public.promo_codes;
create trigger promo_codes_touch_updated_at before update on public.promo_codes
for each row execute function public.touch_promo_code_updated_at();

revoke all on function public.touch_promo_code_updated_at() from public, anon, authenticated;

create or replace function public.admin_create_promo_code(p_data jsonb, p_actor text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item public.promo_codes%rowtype;
  projected jsonb;
begin
  if p_actor is null or length(btrim(p_actor)) < 3 then raise exception 'admin_actor_required'; end if;
  insert into public.promo_codes(code, title, discount_type, discount_value, max_uses, expires_at, is_active, is_private_tier_trigger, private_feature_payload, metadata)
  values (p_data->>'code', p_data->>'title', (p_data->>'discount_type')::public.promo_discount_type,
    (p_data->>'discount_value')::numeric, (p_data->>'max_uses')::integer, (p_data->>'expires_at')::timestamptz,
    (p_data->>'is_active')::boolean, (p_data->>'is_private_tier_trigger')::boolean,
    coalesce(p_data->'private_feature_payload', '{}'::jsonb), coalesce(p_data->'metadata', '{}'::jsonb) || jsonb_build_object('created_by', p_actor))
  returning * into item;
  insert into public.admin_activity(action, entity, entity_id, admin_email, payload)
  values ('promo_code_create', 'promo_codes', item.id::text, p_actor,
    jsonb_build_object('code_hint', right(item.code, 4), 'discount_type', item.discount_type, 'private_tier', item.is_private_tier_trigger));
  select to_jsonb(view_row) into projected from public.admin_promo_code_directory view_row where id = item.id;
  return projected;
end;
$$;

create or replace function public.admin_set_promo_code_state(p_id uuid, p_active boolean, p_expected_updated_at timestamptz, p_actor text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item public.promo_codes%rowtype;
  projected jsonb;
begin
  if p_actor is null or length(btrim(p_actor)) < 3 then raise exception 'admin_actor_required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 1000 then raise exception 'reason_required'; end if;
  if p_active is null or p_expected_updated_at is null then raise exception 'promo_review_required'; end if;
  select * into item from public.promo_codes where id = p_id for update;
  if not found or item.updated_at is distinct from p_expected_updated_at then raise exception 'promo_code_changed'; end if;
  if item.is_active is distinct from p_active then
    update public.promo_codes set is_active = p_active, updated_at = clock_timestamp() where id = p_id returning * into item;
    insert into public.admin_activity(action, entity, entity_id, admin_email, payload)
    values (case when p_active then 'promo_code_activated' else 'promo_code_deactivated' end, 'promo_codes', p_id::text, p_actor,
      jsonb_build_object('reason', p_reason));
  end if;
  select to_jsonb(view_row) into projected from public.admin_promo_code_directory view_row where id = p_id;
  return projected;
end;
$$;

revoke all on function public.admin_create_promo_code(jsonb, text) from public, anon, authenticated;
revoke all on function public.admin_set_promo_code_state(uuid, boolean, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.admin_create_promo_code(jsonb, text) to service_role;
grant execute on function public.admin_set_promo_code_state(uuid, boolean, timestamptz, text, text) to service_role;

commit;
