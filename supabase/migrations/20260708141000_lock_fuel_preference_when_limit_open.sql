set check_function_bodies = off;
set search_path = public;

create or replace function public.update_reservation_fuel_preference(
  reservation_id uuid,
  fuel_type text,
  fuel_preference_mode text default 'EXACT',
  client_mutation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  reservation_row public.fuel_reservations%rowtype;
  old_reservation jsonb;
  effective_fuel_preference_mode text := coalesce(update_reservation_fuel_preference.fuel_preference_mode, 'EXACT');
  has_open_daily_limit boolean := false;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null
    or not public.has_role(array['mayor', 'station_manager', 'cashier', 'mayor_assistant']) then
    raise exception 'FORBIDDEN';
  end if;

  if update_reservation_fuel_preference.reservation_id is null then
    raise exception 'INVALID_RESERVATION';
  end if;

  if update_reservation_fuel_preference.fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if effective_fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  if effective_fuel_preference_mode = 'ANY_GASOLINE'
    and update_reservation_fuel_preference.fuel_type not in ('AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.id = update_reservation_fuel_preference.reservation_id
  limit 1
  for update;

  if reservation_row.id is null then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;

  if reservation_row.status not in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING') then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  if not public.can_access_station(reservation_row.station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  select exists (
    select 1
    from public.daily_limits dl
    where dl.date = current_date
      and dl.station_id is null
      and dl.status = 'OPEN'
  )
  into has_open_daily_limit;

  if has_open_daily_limit
    and (
      reservation_row.fuel_type is distinct from update_reservation_fuel_preference.fuel_type
      or coalesce(reservation_row.fuel_preference_mode, 'EXACT') is distinct from effective_fuel_preference_mode
    ) then
    raise exception 'FUEL_PREFERENCE_LOCKED_BY_OPEN_LIMIT';
  end if;

  if reservation_row.fuel_type = update_reservation_fuel_preference.fuel_type
    and coalesce(reservation_row.fuel_preference_mode, 'EXACT') = effective_fuel_preference_mode then
    return jsonb_build_object(
      'id', reservation_row.id,
      'date', reservation_row.date,
      'station_id', reservation_row.station_id,
      'vehicle_id', reservation_row.vehicle_id,
      'fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', coalesce(reservation_row.fuel_preference_mode, 'EXACT'),
      'queue_number', reservation_row.queue_number,
      'status', reservation_row.status,
      'client_mutation_id', update_reservation_fuel_preference.client_mutation_id,
      'sync_status', reservation_row.sync_status,
      'updated_at', reservation_row.updated_at
    );
  end if;

  old_reservation := to_jsonb(reservation_row);

  update public.fuel_reservations fr
  set fuel_type = update_reservation_fuel_preference.fuel_type,
      fuel_preference_mode = effective_fuel_preference_mode
  where fr.id = reservation_row.id
  returning * into reservation_row;

  perform public.audit_action(
    'UPDATE_RESERVATION_FUEL_PREFERENCE',
    'fuel_reservation',
    reservation_row.id,
    old_reservation,
    to_jsonb(reservation_row)
  );

  return jsonb_build_object(
    'id', reservation_row.id,
    'date', reservation_row.date,
    'station_id', reservation_row.station_id,
    'vehicle_id', reservation_row.vehicle_id,
    'fuel_type', reservation_row.fuel_type,
    'fuel_preference_mode', reservation_row.fuel_preference_mode,
    'queue_number', reservation_row.queue_number,
    'status', reservation_row.status,
    'client_mutation_id', update_reservation_fuel_preference.client_mutation_id,
    'sync_status', reservation_row.sync_status,
    'updated_at', reservation_row.updated_at
  );
end;
$$;

grant execute on function public.update_reservation_fuel_preference(uuid, text, text, uuid) to authenticated;
