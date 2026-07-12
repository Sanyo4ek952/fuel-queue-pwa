CREATE OR REPLACE FUNCTION public.update_reservation_fuel_preference(
  reservation_id uuid,
  fuel_type text,
  fuel_preference_mode text DEFAULT 'EXACT'::text,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  actor_role text := public.get_current_user_role();
  saved_entry public.fuel_queue_entries%rowtype;
  can_update_as_consumer boolean := false;
  can_update_as_staff boolean := false;
begin
  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if update_reservation_fuel_preference.fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if update_reservation_fuel_preference.fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE')
    or (
      update_reservation_fuel_preference.fuel_preference_mode = 'ANY_GASOLINE'
      and update_reservation_fuel_preference.fuel_type not in ('AI_92', 'AI_95', 'AI_100')
    ) then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  select exists (
    select 1
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id
    where fqe.id = update_reservation_fuel_preference.reservation_id
      and pv.profile_id = current_profile_id
      and pv.status = 'ACTIVE'
      and (
        fqe.operator_id = current_profile_id
        or pv.created_at <= fqe.created_at
      )
  ) into can_update_as_consumer;

  can_update_as_consumer := actor_role = 'consumer' and can_update_as_consumer;
  can_update_as_staff := public.has_role(array['mayor', 'station_manager', 'mayor_assistant', 'cashier']);

  if not (can_update_as_consumer or can_update_as_staff) then
    raise exception 'FORBIDDEN';
  end if;

  if exists (
    select 1
    from public.daily_queue_allocations
    where queue_entry_id = update_reservation_fuel_preference.reservation_id
      and status = 'ACTIVE'
  ) then
    raise exception 'FUEL_PREFERENCE_LOCKED_BY_ALLOCATION';
  end if;

  update public.fuel_queue_entries
  set preferred_fuel_type = update_reservation_fuel_preference.fuel_type,
      fuel_preference_mode = update_reservation_fuel_preference.fuel_preference_mode
  where id = update_reservation_fuel_preference.reservation_id
    and status = 'WAITING'
  returning * into saved_entry;

  if saved_entry.id is null then
    raise exception 'QUEUE_ENTRY_NOT_WAITING';
  end if;

  return public.queue_entry_to_json(saved_entry);
end;
$$;

ALTER FUNCTION public.update_reservation_fuel_preference(uuid, text, text, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.update_reservation_fuel_preference(uuid, text, text, uuid) TO authenticated;
