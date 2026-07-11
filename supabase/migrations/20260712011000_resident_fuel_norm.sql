insert into public.app_settings (key, value, updated_by, client_mutation_id)
values ('resident_fuel_norm_liters', jsonb_build_object('liters', 20), null, null)
on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION public.get_resident_fuel_norm_liters() RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select greatest(coalesce((value->>'liters')::numeric, 20), 0.01)
  from public.app_settings
  where key = 'resident_fuel_norm_liters'
  union all
  select 20::numeric
  limit 1
$$;

ALTER FUNCTION public.get_resident_fuel_norm_liters() OWNER TO postgres;

GRANT ALL ON FUNCTION public.get_resident_fuel_norm_liters() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_resident_fuel_norm_liters(
  liters numeric,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(set_resident_fuel_norm_liters.client_mutation_id, gen_random_uuid());
  existing_setting public.app_settings%rowtype;
  saved_setting public.app_settings%rowtype;
  safe_liters numeric(10, 2);
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if liters is null or liters <= 0 or liters > 1000 then
    raise exception 'INVALID_RESIDENT_FUEL_NORM_LITERS';
  end if;

  safe_liters := round(liters, 2);

  select *
  into existing_setting
  from public.app_settings
  where app_settings.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_setting.key is not null then
    return jsonb_build_object(
      'liters', greatest(coalesce((existing_setting.value->>'liters')::numeric, 20), 0.01),
      'updated_at', existing_setting.updated_at,
      'client_mutation_id', existing_setting.client_mutation_id
    );
  end if;

  select *
  into existing_setting
  from public.app_settings
  where key = 'resident_fuel_norm_liters';

  insert into public.app_settings (key, value, updated_by, client_mutation_id)
  values (
    'resident_fuel_norm_liters',
    jsonb_build_object('liters', safe_liters),
    current_profile_id,
    effective_client_mutation_id
  )
  on conflict (key) do update
  set value = excluded.value,
      updated_by = excluded.updated_by,
      client_mutation_id = excluded.client_mutation_id
  returning * into saved_setting;

  perform public.audit_action(
    'SET_RESIDENT_FUEL_NORM_LITERS',
    'app_setting',
    null,
    case when existing_setting.key is null then null else to_jsonb(existing_setting) end,
    to_jsonb(saved_setting)
  );

  return jsonb_build_object(
    'liters', safe_liters,
    'updated_at', saved_setting.updated_at,
    'client_mutation_id', saved_setting.client_mutation_id
  );
end;
$$;

ALTER FUNCTION public.set_resident_fuel_norm_liters(numeric, uuid) OWNER TO postgres;

GRANT ALL ON FUNCTION public.set_resident_fuel_norm_liters(numeric, uuid) TO authenticated;

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
