set search_path = public, extensions;

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
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  other_reservation_row public.fuel_reservations%rowtype;
  daily_limit_row public.daily_limits%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  last_fueling_row public.fueling_records%rowtype;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'PROFILE_NOT_FOUND',
      'normalized_plate_number', normalized_plate
    );
  end if;

  if normalized_plate = '' then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'INVALID_PLATE_NUMBER',
      'normalized_plate_number', normalized_plate
    );
  end if;

  if not public.can_access_station(station_id) then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'STATION_ACCESS_DENIED',
      'normalized_plate_number', normalized_plate,
      'station_id', station_id,
      'date', check_date
    );
  end if;

  select *
  into vehicle_row
  from public.vehicles v
  where v.normalized_plate_number = normalized_plate
  limit 1;

  if vehicle_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_ACTIVE_RESERVATION',
      'normalized_plate_number', normalized_plate,
      'station_id', station_id,
      'date', check_date
    );
  end if;

  select *
  into manual_override_row
  from public.manual_overrides mo
  where mo.vehicle_id = vehicle_row.id
    and mo.station_id = check_vehicle_access.station_id
    and mo.date = check_vehicle_access.check_date
    and mo.used_at is null
    and (mo.expires_at is null or mo.expires_at > now())
  order by mo.created_at desc
  limit 1;

  if vehicle_row.is_blocked and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'VEHICLE_BLOCKED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'block_reason', vehicle_row.block_reason
    );
  end if;

  select *
  into last_fueling_row
  from public.fueling_records fr
  where fr.vehicle_id = vehicle_row.id
    and fr.date = check_vehicle_access.check_date
    and fr.is_manual_override = false
  order by fr.fueled_at desc
  limit 1;

  if last_fueling_row.id is not null and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'ALREADY_FUELED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'last_fueling_record_id', last_fueling_row.id,
      'last_fueling_station_id', last_fueling_row.station_id,
      'last_fueled_at', last_fueling_row.fueled_at
    );
  end if;

  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.vehicle_id = vehicle_row.id
    and fr.station_id = check_vehicle_access.station_id
    and fr.date = check_vehicle_access.check_date
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  order by fr.queue_number asc
  limit 1;

  if reservation_row.id is null then
    select *
    into other_reservation_row
    from public.fuel_reservations fr
    where fr.vehicle_id = vehicle_row.id
      and fr.date = check_vehicle_access.check_date
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by fr.created_at asc
    limit 1;

    if manual_override_row.id is not null then
      return jsonb_build_object(
        'status', 'ALLOWED',
        'reason', 'MANUAL_OVERRIDE_ACTIVE',
        'normalized_plate_number', normalized_plate,
        'vehicle_id', vehicle_row.id,
        'manual_override_id', manual_override_row.id,
        'station_id', station_id,
        'date', check_date
      );
    end if;

    if other_reservation_row.id is not null then
      return jsonb_build_object(
        'status', 'BLOCKED',
        'reason', 'RESERVATION_AT_OTHER_STATION',
        'normalized_plate_number', normalized_plate,
        'vehicle_id', vehicle_row.id,
        'reservation_id', other_reservation_row.id,
        'reservation_station_id', other_reservation_row.station_id,
        'date', check_date
      );
    end if;

    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_ACTIVE_RESERVATION',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'station_id', station_id,
      'date', check_date
    );
  end if;

  select *
  into daily_limit_row
  from public.daily_limits dl
  where dl.date = check_vehicle_access.check_date
    and dl.station_id = check_vehicle_access.station_id
  limit 1;

  if daily_limit_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_DAILY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date
    );
  end if;

  if daily_limit_row.status <> 'OPEN' and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'DAILY_LIMIT_NOT_OPEN',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'daily_limit_id', daily_limit_row.id,
      'daily_limit_status', daily_limit_row.status
    );
  end if;

  if reservation_row.requested_liters > daily_limit_row.max_liters_per_vehicle and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'LITERS_LIMIT_EXCEEDED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'requested_liters', reservation_row.requested_liters,
      'max_liters_per_vehicle', daily_limit_row.max_liters_per_vehicle
    );
  end if;

  return jsonb_build_object(
    'status', 'ALLOWED',
    'reason', case when manual_override_row.id is null then 'ACTIVE_RESERVATION' else 'MANUAL_OVERRIDE_ACTIVE' end,
    'normalized_plate_number', normalized_plate,
    'vehicle_id', vehicle_row.id,
    'reservation_id', reservation_row.id,
    'station_id', station_id,
    'date', check_date,
    'queue_number', reservation_row.queue_number,
    'fuel_type', reservation_row.fuel_type,
    'requested_liters', reservation_row.requested_liters,
    'manual_override_id', manual_override_row.id
  );
end;
$$;

create or replace function public.approve_registration(
  target_profile_id uuid,
  target_role text,
  target_station_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_profile_id uuid;
  actor_role text;
  old_profile public.profiles%rowtype;
  saved_profile public.profiles%rowtype;
  assigned_station_id uuid;
begin
  actor_profile_id := public.get_current_profile_id();
  actor_role := public.get_current_user_role();

  select *
  into old_profile
  from public.ensure_can_manage_profile(target_profile_id);

  if old_profile.approval_status <> 'pending' then
    raise exception 'PROFILE_NOT_PENDING';
  end if;

  if target_role not in ('operator', 'cashier', 'shift_supervisor', 'station_admin', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;

  if actor_role = 'station_admin' and target_role in ('station_admin', 'city_admin') then
    raise exception 'ROLE_ASSIGNMENT_DENIED';
  end if;

  if target_station_ids is null or cardinality(target_station_ids) = 0 then
    raise exception 'STATIONS_REQUIRED';
  end if;

  foreach assigned_station_id in array target_station_ids loop
    if not public.can_access_station(assigned_station_id) then
      raise exception 'STATION_ACCESS_DENIED';
    end if;
  end loop;

  update public.profiles
  set role = target_role,
      is_active = true,
      approval_status = 'approved',
      approved_by = actor_profile_id,
      approved_at = now(),
      rejected_by = null,
      rejected_at = null,
      rejection_reason = null,
      deactivated_by = null,
      deactivated_at = null,
      deactivation_reason = null
  where id = target_profile_id
  returning * into saved_profile;

  delete from public.user_stations
  where user_id = target_profile_id;

  foreach assigned_station_id in array target_station_ids loop
    insert into public.user_stations (user_id, station_id)
    values (target_profile_id, assigned_station_id)
    on conflict (user_id, station_id) do nothing;
  end loop;

  perform public.audit_action(
    'APPROVE_REGISTRATION',
    'profile',
    saved_profile.id,
    to_jsonb(old_profile),
    to_jsonb(saved_profile)
  );

  return jsonb_build_object(
    'id', saved_profile.id,
    'approval_status', saved_profile.approval_status,
    'role', saved_profile.role,
    'is_active', saved_profile.is_active,
    'approved_by', saved_profile.approved_by,
    'approved_at', saved_profile.approved_at
  );
end;
$$;
