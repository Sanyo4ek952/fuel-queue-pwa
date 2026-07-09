set check_function_bodies = off;
set search_path = public;

create or replace function public.check_vehicle_access(
  plate_number text,
  station_id uuid,
  check_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  current_profile_is_mayor boolean := false;
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  preferential_entry_row public.preferential_queue_entries%rowtype;
  preferential_queue_row public.preferential_queues%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  last_fueling_row public.fueling_records%rowtype;
  daily_limit_row public.daily_limits%rowtype;
  callable_reservation_id uuid;
  callable_is_within_today_limit boolean;
  callable_is_callable_now boolean;
  callable_unavailable_reason text;
  callable_matched_fuel_type text;
  manual_override_is_mayor boolean := false;
  cooldown_days integer;
  next_allowed_date date;
  effective_liters numeric;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'PROFILE_NOT_FOUND', 'normalized_plate_number', normalized_plate);
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = current_profile_id
      and p.role = 'mayor'
  )
  into current_profile_is_mayor;

  if normalized_plate = '' then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'INVALID_PLATE_NUMBER', 'normalized_plate_number', normalized_plate);
  end if;

  if not public.can_access_station(station_id) then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'STATION_ACCESS_DENIED', 'normalized_plate_number', normalized_plate, 'station_id', station_id, 'date', check_date);
  end if;

  select * into vehicle_row
  from public.vehicles v
  where v.normalized_plate_number = normalized_plate
  limit 1;

  if vehicle_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate, 'station_id', station_id, 'date', check_date);
  end if;

  select * into manual_override_row
  from public.manual_overrides mo
  where mo.vehicle_id = vehicle_row.id
    and mo.station_id = check_vehicle_access.station_id
    and mo.date = check_vehicle_access.check_date
    and mo.used_at is null
    and (mo.expires_at is null or mo.expires_at > now())
  order by mo.created_at desc
  limit 1;

  if manual_override_row.id is not null then
    select exists (
      select 1
      from public.profiles p
      where p.id = manual_override_row.approved_by
        and p.role = 'mayor'
    )
    into manual_override_is_mayor;
  end if;

  if vehicle_row.is_blocked and manual_override_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'VEHICLE_BLOCKED', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'block_reason', vehicle_row.block_reason);
  end if;

  select pqe.*
  into preferential_entry_row
  from public.preferential_queue_entries pqe
  join public.preferential_queues pq on pq.id = pqe.queue_id
  where pqe.vehicle_id = vehicle_row.id
    and pqe.status = 'ACTIVE'
    and pq.status = 'ACTIVE'
  order by pqe.created_at asc
  limit 1;

  if preferential_entry_row.id is not null then
    select *
    into preferential_queue_row
    from public.preferential_queues pq
    where pq.id = preferential_entry_row.queue_id
    limit 1;
  end if;

  select * into last_fueling_row
  from public.fueling_records fr
  where fr.vehicle_id = vehicle_row.id
    and fr.is_manual_override = false
  order by fr.date desc, fr.fueled_at desc
  limit 1;

  if preferential_entry_row.id is not null then
    return jsonb_build_object(
      'status', 'ALLOWED',
      'reason', 'PREFERENTIAL_QUEUE_ACTIVE',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'preferential_queue_entry_id', preferential_entry_row.id,
      'preferential_queue_id', preferential_entry_row.queue_id,
      'preferential_queue_name', case
        when current_profile_is_mayor then preferential_queue_row.name
        else null
      end,
      'station_id', station_id,
      'date', check_date,
      'fuel_type', preferential_entry_row.fuel_type,
      'preferred_fuel_type', preferential_entry_row.fuel_type,
      'matched_fuel_type', preferential_entry_row.fuel_type,
      'is_within_today_limit', true,
      'is_callable_now', true,
      'call_unavailable_reason', null,
      'fuel_category', public.get_fuel_queue_category(preferential_entry_row.fuel_type),
      'requested_liters', preferential_entry_row.requested_liters,
      'effective_liters', preferential_entry_row.requested_liters
    );
  end if;

  if last_fueling_row.id is not null
    and last_fueling_row.date = check_vehicle_access.check_date
    and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'ALREADY_FUELED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'last_fueling_record_id', last_fueling_row.id,
      'last_fueling_station_id', last_fueling_row.station_id,
      'last_fueled_at', last_fueling_row.fueled_at,
      'last_fueling_date', last_fueling_row.date
    );
  end if;

  cooldown_days := public.get_reservation_refuel_cooldown();

  if cooldown_days > 0 and last_fueling_row.id is not null and not manual_override_is_mayor then
    next_allowed_date := last_fueling_row.date + cooldown_days;

    if check_vehicle_access.check_date < next_allowed_date then
      return jsonb_build_object(
        'status', 'BLOCKED',
        'reason', 'REFUEL_COOLDOWN_ACTIVE',
        'normalized_plate_number', normalized_plate,
        'vehicle_id', vehicle_row.id,
        'station_id', station_id,
        'date', check_date,
        'last_fueling_record_id', last_fueling_row.id,
        'last_fueling_station_id', last_fueling_row.station_id,
        'last_fueled_at', last_fueling_row.fueled_at,
        'last_fueling_date', last_fueling_row.date,
        'next_allowed_date', next_allowed_date,
        'cooldown_days', cooldown_days,
        'days_since_last_fueling', check_vehicle_access.check_date - last_fueling_row.date
      );
    end if;
  end if;

  select * into reservation_row
  from public.fuel_reservations fr
  where fr.vehicle_id = vehicle_row.id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  order by fr.queue_number asc
  limit 1;

  if reservation_row.id is null then
    if manual_override_row.id is not null then
      return jsonb_build_object(
        'status', 'ALLOWED',
        'reason', 'MANUAL_OVERRIDE_ACTIVE',
        'normalized_plate_number', normalized_plate,
        'vehicle_id', vehicle_row.id,
        'manual_override_id', manual_override_row.id,
        'station_id', station_id,
        'date', check_date,
        'is_within_today_limit', true,
        'is_callable_now', true,
        'call_unavailable_reason', null,
        'matched_fuel_type', null
      );
    end if;

    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'station_id', station_id, 'date', check_date);
  end if;

  effective_liters := coalesce((
    select pvll.liters
    from public.personal_vehicle_liter_limits pvll
    where pvll.vehicle_id = vehicle_row.id
      and pvll.date = check_vehicle_access.check_date
    limit 1
  ), reservation_row.requested_liters, 20);

  if manual_override_row.id is not null then
    return jsonb_build_object(
      'status', 'ALLOWED',
      'reason', 'MANUAL_OVERRIDE_ACTIVE',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'fuel_category', public.get_fuel_queue_category(reservation_row.fuel_type),
      'requested_liters', reservation_row.requested_liters,
      'effective_liters', effective_liters,
      'matched_fuel_type', null,
      'is_within_today_limit', true,
      'is_callable_now', true,
      'call_unavailable_reason', null,
      'manual_override_id', manual_override_row.id
    );
  end if;

  if public.get_fuel_queue_category(reservation_row.fuel_type) is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'OUTSIDE_TODAY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'matched_fuel_type', null,
      'is_within_today_limit', false,
      'is_callable_now', false,
      'call_unavailable_reason', 'NO_COMPATIBLE_FUEL'
    );
  end if;

  select * into daily_limit_row
  from public.daily_limits dl
  where dl.date = check_vehicle_access.check_date
    and dl.station_id is null
    and dl.status = 'OPEN'
  limit 1;

  if daily_limit_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_GLOBAL_DAILY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'fuel_category', public.get_fuel_queue_category(reservation_row.fuel_type),
      'requested_liters', reservation_row.requested_liters,
      'effective_liters', effective_liters,
      'matched_fuel_type', null,
      'is_within_today_limit', false,
      'is_callable_now', false,
      'call_unavailable_reason', 'NO_OPEN_DAILY_LIMIT'
    );
  end if;

  select
    cr.reservation_id,
    cr.is_within_today_limit,
    cr.is_callable_now,
    cr.call_unavailable_reason,
    cr.matched_fuel_type
  into
    callable_reservation_id,
    callable_is_within_today_limit,
    callable_is_callable_now,
    callable_unavailable_reason,
    callable_matched_fuel_type
  from public.get_callable_reservations(check_vehicle_access.check_date) cr
  where cr.reservation_id = reservation_row.id
  limit 1;

  if callable_reservation_id is null or callable_is_within_today_limit is not true then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'OUTSIDE_TODAY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'preferred_fuel_type', reservation_row.fuel_type,
      'fuel_preference_mode', reservation_row.fuel_preference_mode,
      'fuel_category', public.get_fuel_queue_category(reservation_row.fuel_type),
      'requested_liters', reservation_row.requested_liters,
      'effective_liters', effective_liters,
      'matched_fuel_type', callable_matched_fuel_type,
      'is_within_today_limit', coalesce(callable_is_within_today_limit, false),
      'is_callable_now', coalesce(callable_is_callable_now, false),
      'call_unavailable_reason', callable_unavailable_reason
    );
  end if;

  return jsonb_build_object(
    'status', 'ALLOWED',
    'reason', 'ACTIVE_RESERVATION',
    'normalized_plate_number', normalized_plate,
    'vehicle_id', vehicle_row.id,
    'reservation_id', reservation_row.id,
    'station_id', station_id,
    'date', check_date,
    'queue_number', reservation_row.queue_number,
    'fuel_type', reservation_row.fuel_type,
    'preferred_fuel_type', reservation_row.fuel_type,
    'fuel_preference_mode', reservation_row.fuel_preference_mode,
    'matched_fuel_type', callable_matched_fuel_type,
    'is_within_today_limit', callable_is_within_today_limit,
    'is_callable_now', callable_is_callable_now,
    'call_unavailable_reason', callable_unavailable_reason,
    'fuel_category', public.get_fuel_queue_category(coalesce(callable_matched_fuel_type, reservation_row.fuel_type)),
    'requested_liters', reservation_row.requested_liters,
    'effective_liters', effective_liters
  );
end;
$$;

grant execute on function public.check_vehicle_access(text, uuid, date) to authenticated;
