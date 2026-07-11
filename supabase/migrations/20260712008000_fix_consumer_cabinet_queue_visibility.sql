CREATE OR REPLACE FUNCTION public.create_consumer_reservation(
  vehicle_id uuid,
  driver_full_name text,
  driver_phone text,
  fuel_type text,
  requested_liters numeric,
  fuel_preference_mode text DEFAULT 'EXACT'::text,
  comment text DEFAULT NULL::text,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  driver_row public.drivers%rowtype;
  vehicle_row public.vehicles%rowtype;
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if current_profile_id is null or public.get_current_user_role() <> 'consumer' then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.profile_vehicles pv
    where pv.profile_id = current_profile_id
      and pv.vehicle_id = create_consumer_reservation.vehicle_id
      and pv.status = 'ACTIVE'
  ) then
    raise exception 'VEHICLE_NOT_OWNED';
  end if;

  select *
  into vehicle_row
  from public.vehicles
  where id = create_consumer_reservation.vehicle_id;

  if vehicle_row.id is null or vehicle_row.is_blocked then
    raise exception 'VEHICLE_BLOCKED';
  end if;

  if exists (
    select 1
    from public.fuel_queue_entries fqe
    where fqe.vehicle_id = vehicle_row.id
      and fqe.status = 'WAITING'
  ) then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id
    where pv.profile_id = current_profile_id
      and pv.status = 'ACTIVE'
      and fqe.status = 'WAITING'
  ) then
    raise exception 'CONSUMER_ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  if trim(coalesce(driver_full_name, '')) = '' or trim(coalesce(driver_phone, '')) = '' then
    raise exception 'INVALID_DRIVER';
  end if;

  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE')
    or (fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100')) then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  if requested_liters is null or requested_liters <= 0 then
    raise exception 'INVALID_REQUESTED_LITERS';
  end if;

  select *
  into saved_entry
  from public.fuel_queue_entries
  where fuel_queue_entries.client_mutation_id = create_consumer_reservation.client_mutation_id
  limit 1;

  if saved_entry.id is not null then
    return public.queue_entry_to_json(saved_entry);
  end if;

  insert into public.drivers (full_name, phone)
  values (trim(driver_full_name), trim(driver_phone))
  returning * into driver_row;

  insert into public.fuel_queue_entries (
    vehicle_id,
    driver_id,
    preferred_fuel_type,
    fuel_preference_mode,
    requested_liters,
    operator_id,
    comment,
    client_mutation_id
  ) values (
    vehicle_row.id,
    driver_row.id,
    fuel_type,
    fuel_preference_mode,
    requested_liters,
    current_profile_id,
    nullif(trim(coalesce(comment, '')), ''),
    coalesce(client_mutation_id, gen_random_uuid())
  )
  returning * into saved_entry;

  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone
  );
end;
$$;

ALTER FUNCTION public.create_consumer_reservation(
  uuid,
  text,
  text,
  text,
  numeric,
  text,
  text,
  uuid
) OWNER TO postgres;

GRANT ALL ON FUNCTION public.create_consumer_reservation(
  uuid,
  text,
  text,
  text,
  numeric,
  text,
  text,
  uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_today_fueling_status() RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  result jsonb;
begin
  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  select jsonb_build_object(
    'id', fr.id,
    'date', fr.date,
    'station_id', fr.station_id,
    'station_name', s.name,
    'station_address', s.address,
    'vehicle_id', fr.vehicle_id,
    'reservation_id', fr.queue_entry_id,
    'normalized_plate_number', v.normalized_plate_number,
    'fuel_type', fr.fuel_type,
    'liters', fr.liters,
    'fueled_at', fr.fueled_at,
    'ticket_number', fqe.permanent_number
  )
  into result
  from public.fueling_records fr
  join public.profile_vehicles pv
    on pv.vehicle_id = fr.vehicle_id
   and pv.profile_id = current_profile_id
   and pv.status = 'ACTIVE'
  join public.vehicles v on v.id = fr.vehicle_id
  left join public.stations s on s.id = fr.station_id
  left join public.fuel_queue_entries fqe on fqe.id = fr.queue_entry_id
  where fr.date = (now() at time zone 'Europe/Moscow')::date
    and coalesce(fr.is_manual_override, false) = false
  order by fr.fueled_at desc
  limit 1;

  return result;
end;
$$;

ALTER FUNCTION public.get_my_today_fueling_status() OWNER TO postgres;

GRANT ALL ON FUNCTION public.get_my_today_fueling_status() TO authenticated;
