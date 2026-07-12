CREATE OR REPLACE FUNCTION public.create_reservation(
  plate_number text,
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
  normalized_plate text := public.normalize_plate_number(plate_number);
  vehicle_row public.vehicles%rowtype;
  driver_row public.drivers%rowtype;
  saved_entry public.fuel_queue_entries%rowtype;
  cooldown_days integer := public.get_reservation_refuel_cooldown();
  last_regular_fueling_date date;
  today_local date := (now() at time zone 'Europe/Moscow')::date;
begin
  if current_profile_id is null
    or not public.has_role(array['mayor', 'station_manager', 'mayor_assistant']) then
    raise exception 'FORBIDDEN';
  end if;
  if normalized_plate = '' then raise exception 'INVALID_PLATE_NUMBER'; end if;
  if trim(coalesce(driver_full_name, '')) = '' then raise exception 'INVALID_DRIVER_FULL_NAME'; end if;
  if trim(coalesce(driver_phone, '')) = '' then raise exception 'INVALID_DRIVER_PHONE'; end if;
  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then raise exception 'INVALID_FUEL_TYPE'; end if;
  if fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE') then raise exception 'INVALID_FUEL_PREFERENCE_MODE'; end if;
  if fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;
  if requested_liters is null or requested_liters <= 0 then raise exception 'INVALID_REQUESTED_LITERS'; end if;

  select * into saved_entry
  from public.fuel_queue_entries
  where fuel_queue_entries.client_mutation_id = create_reservation.client_mutation_id
  limit 1;
  if saved_entry.id is not null then return public.queue_entry_to_json(saved_entry); end if;

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (normalized_plate, normalized_plate)
  on conflict (normalized_plate_number) do update set plate_number = excluded.plate_number
  returning * into vehicle_row;
  if vehicle_row.is_blocked then raise exception 'VEHICLE_BLOCKED'; end if;
  if exists (select 1 from public.fuel_queue_entries where vehicle_id = vehicle_row.id and status = 'WAITING') then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  if cooldown_days > 0 then
    select max(fr.date)
    into last_regular_fueling_date
    from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id
      and coalesce(fr.is_manual_override, false) = false
      and fr.preferential_queue_entry_id is null;

    if last_regular_fueling_date is not null
      and today_local < last_regular_fueling_date + cooldown_days then
      raise exception 'REFUEL_COOLDOWN_ACTIVE';
    end if;
  end if;

  insert into public.drivers (full_name, phone)
  values (trim(driver_full_name), trim(driver_phone))
  returning * into driver_row;

  insert into public.fuel_queue_entries (
    vehicle_id, driver_id, preferred_fuel_type, fuel_preference_mode,
    requested_liters, operator_id, comment, client_mutation_id
  ) values (
    vehicle_row.id, driver_row.id, fuel_type, fuel_preference_mode,
    requested_liters, current_profile_id, nullif(trim(coalesce(comment, '')), ''),
    coalesce(client_mutation_id, gen_random_uuid())
  ) returning * into saved_entry;

  perform public.audit_action('CREATE_QUEUE_ENTRY', 'fuel_queue_entry', saved_entry.id, null, to_jsonb(saved_entry));
  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone
  );
end;
$$;

ALTER FUNCTION public.create_reservation(
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  uuid
) OWNER TO postgres;

GRANT ALL ON FUNCTION public.create_reservation(
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  uuid
) TO authenticated;

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
  resident_liters numeric(10, 2) := public.get_resident_fuel_norm_liters();
  cooldown_days integer := public.get_reservation_refuel_cooldown();
  last_regular_fueling_date date;
  today_local date := (now() at time zone 'Europe/Moscow')::date;
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

  if resident_liters is null or resident_liters <= 0 then
    raise exception 'INVALID_RESIDENT_FUEL_NORM_LITERS';
  end if;

  if cooldown_days > 0 then
    select max(fr.date)
    into last_regular_fueling_date
    from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id
      and coalesce(fr.is_manual_override, false) = false
      and fr.preferential_queue_entry_id is null;

    if last_regular_fueling_date is not null
      and today_local < last_regular_fueling_date + cooldown_days then
      raise exception 'REFUEL_COOLDOWN_ACTIVE';
    end if;
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
    resident_liters,
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
