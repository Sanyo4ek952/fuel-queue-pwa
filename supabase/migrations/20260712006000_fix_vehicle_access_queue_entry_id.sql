CREATE OR REPLACE FUNCTION public.check_vehicle_access(
  plate_number text,
  station_id uuid,
  check_date date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  normalized_plate text := public.normalize_plate_number(plate_number);
  vehicle_row public.vehicles%rowtype;
  allocation_row record;
begin
  if public.get_current_profile_id() is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'PROFILE_NOT_FOUND',
      'normalized_plate_number', normalized_plate
    );
  end if;

  if not public.can_access_station(station_id) then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'STATION_ACCESS_DENIED',
      'normalized_plate_number', normalized_plate
    );
  end if;

  select *
  into vehicle_row
  from public.vehicles
  where normalized_plate_number = normalized_plate
  limit 1;

  if vehicle_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_ACTIVE_RESERVATION',
      'normalized_plate_number', normalized_plate
    );
  end if;

  if vehicle_row.is_blocked then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'VEHICLE_BLOCKED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'block_reason', vehicle_row.block_reason
    );
  end if;

  if exists (
    select 1
    from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id
      and fr.date = check_date
      and coalesce(fr.is_manual_override, false) = false
  ) then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'ALREADY_FUELED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id
    );
  end if;

  select
    dqa.*,
    fqe.permanent_number,
    fqe.preferred_fuel_type,
    fqe.fuel_preference_mode,
    fqe.requested_liters
  into allocation_row
  from public.daily_queue_allocations dqa
  join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
  where fqe.vehicle_id = vehicle_row.id
    and dqa.allocation_date = check_date
  order by
    case
      when dqa.status = 'ACTIVE' and dqa.station_id = check_vehicle_access.station_id then 0
      when dqa.status = 'ACTIVE' then 1
      else 2
    end,
    dqa.daily_position,
    dqa.id
  limit 1;

  if allocation_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_ACTIVE_RESERVATION',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id
    );
  end if;

  if allocation_row.status = 'ACTIVE' and allocation_row.station_id <> check_vehicle_access.station_id then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'RESERVATION_AT_OTHER_STATION',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'allocation_id', allocation_row.id,
      'reservation_id', allocation_row.queue_entry_id,
      'reservation_station_id', allocation_row.station_id,
      'queue_entry_id', allocation_row.queue_entry_id,
      'queue_number', allocation_row.permanent_number,
      'matched_fuel_type', allocation_row.assigned_fuel_type,
      'is_within_today_limit', false
    );
  end if;

  if allocation_row.status <> 'ACTIVE' then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'OUTSIDE_TODAY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'allocation_id', allocation_row.id,
      'reservation_id', allocation_row.queue_entry_id,
      'reservation_station_id', allocation_row.station_id,
      'queue_entry_id', allocation_row.queue_entry_id,
      'queue_number', allocation_row.permanent_number,
      'matched_fuel_type', allocation_row.assigned_fuel_type,
      'is_within_today_limit', false
    );
  end if;

  return jsonb_build_object(
    'status', 'ALLOWED',
    'reason', 'ACTIVE_RESERVATION',
    'normalized_plate_number', normalized_plate,
    'date', check_date,
    'station_id', station_id,
    'vehicle_id', vehicle_row.id,
    'allocation_id', allocation_row.id,
    'reservation_id', allocation_row.queue_entry_id,
    'queue_entry_id', allocation_row.queue_entry_id,
    'queue_number', allocation_row.permanent_number,
    'fuel_type', allocation_row.preferred_fuel_type,
    'preferred_fuel_type', allocation_row.preferred_fuel_type,
    'fuel_preference_mode', allocation_row.fuel_preference_mode,
    'matched_fuel_type', allocation_row.assigned_fuel_type,
    'requested_liters', allocation_row.requested_liters,
    'effective_liters', allocation_row.allocated_liters,
    'category_position', allocation_row.station_fuel_position,
    'is_within_today_limit', true,
    'is_callable_now', true,
    'arrival_at', allocation_row.arrival_at,
    'call_status', allocation_row.call_status
  );
end;
$$;

ALTER FUNCTION public.check_vehicle_access(text, uuid, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.check_vehicle_access(text, uuid, date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_vehicle_access(text, uuid, date) TO authenticated;
