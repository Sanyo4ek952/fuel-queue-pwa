CREATE OR REPLACE FUNCTION public.create_consumer_vehicle(
  plate_number text,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid;
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  profile_vehicle_row public.profile_vehicles%rowtype;
  active_vehicle_count integer;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  perform pg_advisory_xact_lock(hashtext('consumer_vehicle_' || current_profile_id::text));

  select count(*)
  into active_vehicle_count
  from public.profile_vehicles pv
  where pv.profile_id = current_profile_id
    and pv.status = 'ACTIVE';

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (plate_number, normalized_plate)
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  if vehicle_row.is_blocked then
    raise exception 'VEHICLE_BLOCKED';
  end if;

  select *
  into profile_vehicle_row
  from public.profile_vehicles pv
  where pv.profile_id = current_profile_id
    and pv.vehicle_id = vehicle_row.id
  limit 1;

  if exists (
    select 1
    from public.fuel_queue_entries fqe
    where fqe.vehicle_id = vehicle_row.id
      and fqe.status = 'WAITING'
      and fqe.operator_id <> current_profile_id
      and (
        profile_vehicle_row.id is null
        or profile_vehicle_row.created_at > fqe.created_at
      )
  ) then
    raise exception 'VEHICLE_IN_ACTIVE_QUEUE';
  end if;

  if profile_vehicle_row.id is not null then
    if profile_vehicle_row.status <> 'ACTIVE' then
      if active_vehicle_count >= 3 then
        raise exception 'CONSUMER_VEHICLE_LIMIT_EXCEEDED';
      end if;

      update public.profile_vehicles
      set status = 'ACTIVE'
      where id = profile_vehicle_row.id
      returning * into profile_vehicle_row;
    end if;

    return public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row);
  end if;

  if active_vehicle_count >= 3 then
    raise exception 'CONSUMER_VEHICLE_LIMIT_EXCEEDED';
  end if;

  insert into public.profile_vehicles (profile_id, vehicle_id, status)
  values (current_profile_id, vehicle_row.id, 'ACTIVE')
  returning * into profile_vehicle_row;

  perform public.audit_action(
    'CREATE_CONSUMER_VEHICLE',
    'profile_vehicle',
    profile_vehicle_row.id,
    null,
    public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row)
  );

  return public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row);
end;
$$;

ALTER FUNCTION public.create_consumer_vehicle(text, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.create_consumer_vehicle(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_reservation(
  reservation_id uuid,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
begin
  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id
    where fqe.id = reservation_id
      and pv.profile_id = current_profile_id
      and (
        fqe.operator_id = current_profile_id
        or pv.created_at <= fqe.created_at
      )
  ) then
    raise exception 'FORBIDDEN';
  end if;

  return public.cancel_reservation(reservation_id, 'CONSUMER_CANCELLED', null, client_mutation_id);
end;
$$;

ALTER FUNCTION public.cancel_my_reservation(uuid, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.cancel_my_reservation(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_queue_status() RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
begin
  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  return (
    select public.queue_entry_to_json(fqe) || jsonb_build_object(
      'normalized_plate_number', v.normalized_plate_number,
      'driver_full_name', d.full_name,
      'driver_phone', d.phone,
      'allocation', case when dqa.id is null then null else jsonb_build_object(
        'id', dqa.id,
        'date', dqa.allocation_date,
        'station_id', dqa.station_id,
        'station_name', s.name,
        'station_address', s.address,
        'assigned_fuel_type', dqa.assigned_fuel_type,
        'daily_position', dqa.daily_position,
        'station_position', dqa.station_position,
        'station_fuel_position', dqa.station_fuel_position,
        'arrival_at', dqa.arrival_at,
        'status', dqa.status,
        'call_status', dqa.call_status
      ) end,
      'date', dqa.allocation_date,
      'station_id', dqa.station_id,
      'station_name', s.name,
      'station_address', s.address,
      'current_position', dqa.daily_position,
      'people_ahead', case when dqa.daily_position is null then null else greatest(dqa.daily_position - 1, 0) end,
      'matched_fuel_type', dqa.assigned_fuel_type,
      'is_within_today_limit', dqa.status = 'ACTIVE',
      'is_callable_now', dqa.status = 'ACTIVE',
      'is_fuel_preference_update_locked', dqa.id is not null and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT')
    )
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id and pv.profile_id = current_profile_id
    join public.vehicles v on v.id = fqe.vehicle_id
    left join public.drivers d on d.id = fqe.driver_id
    left join public.daily_queue_allocations dqa
      on dqa.queue_entry_id = fqe.id
     and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
    left join public.stations s on s.id = dqa.station_id
    where fqe.status = 'WAITING'
      and (
        fqe.operator_id = current_profile_id
        or pv.created_at <= fqe.created_at
      )
    order by fqe.permanent_number
    limit 1
  );
end;
$$;

ALTER FUNCTION public.get_my_queue_status() OWNER TO postgres;
GRANT ALL ON FUNCTION public.get_my_queue_status() TO authenticated;
