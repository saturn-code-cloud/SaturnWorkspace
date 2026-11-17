begin;

drop function public.reset_account_device(text, text, text, text);

create function public.reset_account_device(
  p_firebase_uid text,
  p_actor text,
  p_reason text,
  p_request_id text,
  p_expected_binding_id uuid,
  p_expected_binding_updated_at timestamptz,
  p_preview_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  binding_row public.account_device_bindings%rowtype;
  prior_event public.account_device_events%rowtype;
  normalized_uid text := btrim(coalesce(p_firebase_uid, ''));
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_reason text := btrim(coalesce(p_reason, ''));
  normalized_request_id text := btrim(coalesce(p_request_id, ''));
begin
  if normalized_uid = '' then raise exception 'account_not_found'; end if;
  if normalized_actor = '' then raise exception 'admin_required'; end if;
  if length(normalized_reason) < 3 or length(normalized_reason) > 1000 then raise exception 'reason_required'; end if;
  if length(normalized_request_id) < 8 or length(normalized_request_id) > 200 then raise exception 'invalid_request_id'; end if;
  if p_expected_binding_id is null or p_expected_binding_updated_at is null then raise exception 'preview_changed'; end if;
  if p_preview_hash is null or p_preview_hash !~ '^[0-9a-f]{64}$' then raise exception 'preview_changed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_uid, 0));
  select * into prior_event from public.account_device_events
  where firebase_uid = normalized_uid and event_type = 'device_binding_reset'
    and details->>'request_id' = normalized_request_id
  limit 1;
  if prior_event.id is not null then
    if prior_event.binding_id is distinct from p_expected_binding_id
      or lower(coalesce(prior_event.actor_id, '')) <> normalized_actor
      or prior_event.details->>'reason' is distinct from normalized_reason
      or prior_event.details->>'preview_hash' is distinct from p_preview_hash then
      raise exception 'device_reset_request_conflict';
    end if;
    return jsonb_build_object('reset', true, 'idempotent', true);
  end if;

  select * into binding_row from public.account_device_bindings
  where firebase_uid = normalized_uid and status = 'active'
  limit 1 for update;
  if binding_row.id is null then raise exception 'device_not_found'; end if;
  if binding_row.id <> p_expected_binding_id
    or binding_row.updated_at is distinct from p_expected_binding_updated_at then
    raise exception 'preview_changed';
  end if;

  update public.account_device_bindings
  set status = 'revoked', released_at = now(), updated_at = now()
  where id = binding_row.id;
  update public.app_sessions set revoked_at = coalesce(revoked_at, now())
  where user_id = normalized_uid and revoked_at is null;
  update public.account_device_change_requests
  set status = 'cancelled', resolved_at = now(), resolved_by = normalized_actor,
      resolution_note = 'binding_reset', updated_at = now()
  where firebase_uid = normalized_uid and status = 'pending';

  insert into public.account_device_events (
    firebase_uid, event_type, actor_type, actor_id, binding_id, details
  ) values (
    normalized_uid, 'device_binding_reset', 'admin', normalized_actor, binding_row.id,
    jsonb_build_object('reason', normalized_reason, 'request_id', normalized_request_id, 'preview_hash', p_preview_hash)
  );
  insert into public.admin_activity (action, entity, entity_id, payload, admin_email)
  values ('account_device_binding_reset', 'account_device_binding', binding_row.id::text,
    jsonb_build_object('firebase_uid', normalized_uid, 'reason', normalized_reason,
      'request_id', normalized_request_id), normalized_actor);
  return jsonb_build_object('reset', true, 'idempotent', false);
end;
$$;

revoke all on function public.reset_account_device(text, text, text, text, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.reset_account_device(text, text, text, text, uuid, timestamptz, text)
  to service_role;

commit;
