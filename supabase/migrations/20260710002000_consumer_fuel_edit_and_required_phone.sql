set check_function_bodies = off;
set search_path = public, extensions;

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
  current_role text;
  reservation_row public.fuel_reservations%rowtype;
  old_reservation jsonb;
  effective_fuel_preference_mode text := coalesce(update_reservation_fuel_preference.fuel_preference_mode, 'EXACT');
  is_changed boolean := false;
begin
  current_profile_id := public.get_current_profile_id();
  current_role := public.get_current_user_role();

  if current_profile_id is null then
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

  if current_role = 'consumer' then
    if reservation_row.operator_id <> current_profile_id then
      raise exception 'FORBIDDEN';
    end if;
  elsif not public.has_role(array['mayor', 'station_manager', 'cashier', 'mayor_assistant'])
    or not public.can_access_station(reservation_row.station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  is_changed :=
    reservation_row.fuel_type is distinct from update_reservation_fuel_preference.fuel_type
    or coalesce(reservation_row.fuel_preference_mode, 'EXACT') is distinct from effective_fuel_preference_mode;

  if is_changed and exists (
    select 1
    from public.fuel_reservations fr
    where fr.status = 'FUELING'
  ) then
    raise exception 'FUEL_PREFERENCE_LOCKED_BY_ACTIVE_FUELING';
  end if;

  if not is_changed then
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

create or replace function public.get_my_queue_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  return (
    with active_positions as (
      select
        fr.id,
        row_number() over (order by fr.queue_number asc, fr.id asc)::integer as current_position
      from public.fuel_reservations fr
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    ),
    fueling_lock as (
      select exists (
        select 1
        from public.fuel_reservations fr
        where fr.status = 'FUELING'
      ) as is_locked
    )
    select jsonb_build_object(
      'id', fr.id,
      'date', fr.date,
      'station_id', fr.station_id,
      'vehicle_id', fr.vehicle_id,
      'driver_id', fr.driver_id,
      'normalized_plate_number', v.normalized_plate_number,
      'driver_full_name', d.full_name,
      'driver_phone', d.phone,
      'fuel_type', fr.fuel_type,
      'fuel_preference_mode', fr.fuel_preference_mode,
      'requested_liters', fr.requested_liters,
      'queue_number', fr.queue_number,
      'ticket_number', fr.queue_number,
      'current_position', ap.current_position,
      'people_ahead', greatest(ap.current_position - 1, 0),
      'is_within_today_limit', coalesce(c.is_within_today_limit, false),
      'is_callable_now', coalesce(c.is_callable_now, false),
      'matched_fuel_type', c.matched_fuel_type,
      'is_fuel_preference_update_locked', fueling_lock.is_locked,
      'status', fr.status,
      'client_mutation_id', fr.client_mutation_id,
      'created_at', fr.created_at,
      'updated_at', fr.updated_at
    )
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.drivers d on d.id = fr.driver_id
    left join active_positions ap on ap.id = fr.id
    left join public.get_callable_reservations(current_date) c on c.reservation_id = fr.id
    cross join fueling_lock
    where fr.operator_id = current_profile_id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by fr.queue_number asc
    limit 1
  );
end;
$$;

create or replace function public.create_consumer_reservation(
  vehicle_id uuid,
  driver_full_name text,
  driver_phone text,
  fuel_type text,
  requested_liters numeric,
  fuel_preference_mode text default 'EXACT',
  comment text default null,
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
  effective_client_mutation_id uuid := coalesce(create_consumer_reservation.client_mutation_id, gen_random_uuid());
  vehicle_row public.vehicles%rowtype;
  driver_row public.drivers%rowtype;
  existing_reservation_row public.fuel_reservations%rowtype;
  saved_reservation_row public.fuel_reservations%rowtype;
  last_fueling_row public.fueling_records%rowtype;
  cooldown_days integer;
  next_allowed_date date;
  next_queue_number integer;
  effective_fuel_preference_mode text := coalesce(create_consumer_reservation.fuel_preference_mode, 'EXACT');
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  if create_consumer_reservation.vehicle_id is null then
    raise exception 'INVALID_VEHICLE';
  end if;

  if coalesce(trim(driver_full_name), '') = '' then
    raise exception 'INVALID_DRIVER_FULL_NAME';
  end if;

  if coalesce(trim(driver_phone), '') = '' then
    raise exception 'INVALID_DRIVER_PHONE';
  end if;

  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if effective_fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  if effective_fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  if requested_liters is null or requested_liters <= 0 then
    raise exception 'INVALID_REQUESTED_LITERS';
  end if;

  select *
  into existing_reservation_row
  from public.fuel_reservations fr
  where fr.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_reservation_row.id is not null then
    if existing_reservation_row.operator_id <> current_profile_id then
      raise exception 'CLIENT_MUTATION_ID_CONFLICT';
    end if;

    select *
    into vehicle_row
    from public.vehicles
    where id = existing_reservation_row.vehicle_id;

    select *
    into driver_row
    from public.drivers
    where id = existing_reservation_row.driver_id;

    return jsonb_build_object(
      'id', existing_reservation_row.id,
      'date', existing_reservation_row.date,
      'station_id', existing_reservation_row.station_id,
      'vehicle_id', existing_reservation_row.vehicle_id,
      'driver_id', existing_reservation_row.driver_id,
      'normalized_plate_number', vehicle_row.normalized_plate_number,
      'driver_full_name', driver_row.full_name,
      'driver_phone', driver_row.phone,
      'fuel_type', existing_reservation_row.fuel_type,
      'fuel_preference_mode', existing_reservation_row.fuel_preference_mode,
      'requested_liters', existing_reservation_row.requested_liters,
      'queue_number', existing_reservation_row.queue_number,
      'ticket_number', existing_reservation_row.queue_number,
      'current_position', null,
      'people_ahead', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'matched_fuel_type', null,
      'is_fuel_preference_update_locked', false,
      'status', existing_reservation_row.status,
      'client_mutation_id', existing_reservation_row.client_mutation_id
    );
  end if;

  select v.*
  into vehicle_row
  from public.vehicles v
  join public.profile_vehicles pv on pv.vehicle_id = v.id
  where v.id = create_consumer_reservation.vehicle_id
    and pv.profile_id = current_profile_id
    and pv.status = 'ACTIVE'
  limit 1
  for update of v;

  if vehicle_row.id is null then
    raise exception 'VEHICLE_NOT_OWNED';
  end if;

  if vehicle_row.is_blocked then
    raise exception 'VEHICLE_BLOCKED';
  end if;

  perform public.apply_reservation_no_show_policy(current_date - 1);

  cooldown_days := public.get_reservation_refuel_cooldown();

  if cooldown_days > 0 then
    select *
    into last_fueling_row
    from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id
      and fr.is_manual_override = false
    order by fr.date desc, fr.fueled_at desc
    limit 1;

    if last_fueling_row.id is not null then
      next_allowed_date := last_fueling_row.date + cooldown_days;

      if current_date < next_allowed_date then
        raise exception 'REFUEL_COOLDOWN_ACTIVE';
      end if;
    end if;
  end if;

  if exists (
    select 1
    from public.fuel_reservations fr
    where fr.operator_id = current_profile_id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ) then
    raise exception 'CONSUMER_ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from public.fuel_reservations fr
    where fr.vehicle_id = vehicle_row.id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ) then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  select *
  into driver_row
  from public.drivers
  where lower(full_name) = lower(trim(driver_full_name))
    and coalesce(phone, '') = coalesce(nullif(trim(driver_phone), ''), '')
  order by created_at asc
  limit 1;

  if driver_row.id is null then
    insert into public.drivers (full_name, phone)
    values (trim(driver_full_name), nullif(trim(driver_phone), ''))
    returning * into driver_row;
  end if;

  perform pg_advisory_xact_lock(hashtext('global_reservation_queue'));

  select coalesce(max(queue_number), 0) + 1
  into next_queue_number
  from public.fuel_reservations;

  insert into public.fuel_reservations (
    date,
    station_id,
    vehicle_id,
    driver_id,
    fuel_type,
    fuel_preference_mode,
    requested_liters,
    queue_number,
    status,
    operator_id,
    comment,
    client_mutation_id,
    sync_status
  )
  values (
    null,
    null,
    vehicle_row.id,
    driver_row.id,
    create_consumer_reservation.fuel_type,
    effective_fuel_preference_mode,
    requested_liters,
    next_queue_number,
    'RESERVED',
    current_profile_id,
    nullif(trim(comment), ''),
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_reservation_row;

  perform public.audit_action('CREATE_CONSUMER_RESERVATION', 'fuel_reservation', saved_reservation_row.id, null, to_jsonb(saved_reservation_row));

  return jsonb_build_object(
    'id', saved_reservation_row.id,
    'date', saved_reservation_row.date,
    'station_id', saved_reservation_row.station_id,
    'vehicle_id', saved_reservation_row.vehicle_id,
    'driver_id', saved_reservation_row.driver_id,
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone,
    'fuel_type', saved_reservation_row.fuel_type,
    'fuel_preference_mode', saved_reservation_row.fuel_preference_mode,
    'requested_liters', saved_reservation_row.requested_liters,
    'queue_number', saved_reservation_row.queue_number,
    'ticket_number', saved_reservation_row.queue_number,
    'current_position', null,
    'people_ahead', null,
    'is_within_today_limit', null,
    'is_callable_now', null,
    'matched_fuel_type', null,
    'is_fuel_preference_update_locked', false,
    'status', saved_reservation_row.status,
    'client_mutation_id', saved_reservation_row.client_mutation_id
  );
end;
$$;

create or replace function public.create_reservation(
  plate_number text,
  driver_full_name text,
  driver_phone text,
  fuel_type text,
  requested_liters numeric,
  fuel_preference_mode text default 'EXACT',
  comment text default null,
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
  effective_client_mutation_id uuid := coalesce(create_reservation.client_mutation_id, gen_random_uuid());
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  driver_row public.drivers%rowtype;
  existing_reservation_row public.fuel_reservations%rowtype;
  saved_reservation_row public.fuel_reservations%rowtype;
  last_fueling_row public.fueling_records%rowtype;
  cooldown_days integer;
  next_allowed_date date;
  next_queue_number integer;
  effective_fuel_preference_mode text := coalesce(create_reservation.fuel_preference_mode, 'EXACT');
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['mayor_assistant', 'operator', 'station_manager', 'shift_supervisor', 'station_admin', 'mayor']) then
    raise exception 'FORBIDDEN';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  if coalesce(trim(driver_full_name), '') = '' then
    raise exception 'INVALID_DRIVER_FULL_NAME';
  end if;

  if coalesce(trim(driver_phone), '') = '' then
    raise exception 'INVALID_DRIVER_PHONE';
  end if;

  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if effective_fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  if effective_fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  if requested_liters is null or requested_liters <= 0 then
    raise exception 'INVALID_REQUESTED_LITERS';
  end if;

  perform public.apply_reservation_no_show_policy(current_date - 1);

  select *
  into existing_reservation_row
  from public.fuel_reservations
  where fuel_reservations.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_reservation_row.id is not null then
    return jsonb_build_object(
      'id', existing_reservation_row.id,
      'date', existing_reservation_row.date,
      'station_id', existing_reservation_row.station_id,
      'vehicle_id', existing_reservation_row.vehicle_id,
      'driver_id', existing_reservation_row.driver_id,
      'fuel_type', existing_reservation_row.fuel_type,
      'fuel_preference_mode', existing_reservation_row.fuel_preference_mode,
      'requested_liters', existing_reservation_row.requested_liters,
      'queue_number', existing_reservation_row.queue_number,
      'status', existing_reservation_row.status,
      'client_mutation_id', existing_reservation_row.client_mutation_id
    );
  end if;

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (plate_number, normalized_plate)
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  if vehicle_row.is_blocked then
    raise exception 'VEHICLE_BLOCKED';
  end if;

  cooldown_days := public.get_reservation_refuel_cooldown();

  if cooldown_days > 0 then
    select *
    into last_fueling_row
    from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id
      and fr.is_manual_override = false
    order by fr.date desc, fr.fueled_at desc
    limit 1;

    if last_fueling_row.id is not null then
      next_allowed_date := last_fueling_row.date + cooldown_days;

      if current_date < next_allowed_date then
        raise exception 'REFUEL_COOLDOWN_ACTIVE';
      end if;
    end if;
  end if;

  select *
  into driver_row
  from public.drivers
  where lower(full_name) = lower(trim(driver_full_name))
    and coalesce(phone, '') = coalesce(nullif(trim(driver_phone), ''), '')
  order by created_at asc
  limit 1;

  if driver_row.id is null then
    insert into public.drivers (full_name, phone)
    values (trim(driver_full_name), nullif(trim(driver_phone), ''))
    returning * into driver_row;
  end if;

  if exists (
    select 1
    from public.fuel_reservations fr
    where fr.vehicle_id = vehicle_row.id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ) then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  perform pg_advisory_xact_lock(hashtext('global_reservation_queue'));

  select coalesce(max(queue_number), 0) + 1
  into next_queue_number
  from public.fuel_reservations;

  insert into public.fuel_reservations (
    date,
    station_id,
    vehicle_id,
    driver_id,
    fuel_type,
    fuel_preference_mode,
    requested_liters,
    queue_number,
    status,
    operator_id,
    comment,
    client_mutation_id,
    sync_status
  )
  values (
    null,
    null,
    vehicle_row.id,
    driver_row.id,
    create_reservation.fuel_type,
    effective_fuel_preference_mode,
    requested_liters,
    next_queue_number,
    'RESERVED',
    current_profile_id,
    nullif(trim(comment), ''),
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_reservation_row;

  perform public.audit_action('CREATE_RESERVATION', 'fuel_reservation', saved_reservation_row.id, null, to_jsonb(saved_reservation_row));

  return jsonb_build_object(
    'id', saved_reservation_row.id,
    'date', saved_reservation_row.date,
    'station_id', saved_reservation_row.station_id,
    'vehicle_id', saved_reservation_row.vehicle_id,
    'driver_id', saved_reservation_row.driver_id,
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone,
    'fuel_type', saved_reservation_row.fuel_type,
    'fuel_preference_mode', saved_reservation_row.fuel_preference_mode,
    'requested_liters', saved_reservation_row.requested_liters,
    'queue_number', saved_reservation_row.queue_number,
    'status', saved_reservation_row.status,
    'client_mutation_id', saved_reservation_row.client_mutation_id
  );
end;
$$;

grant execute on function public.update_reservation_fuel_preference(uuid, text, text, uuid) to authenticated;
grant execute on function public.get_my_queue_status() to authenticated;
grant execute on function public.create_consumer_reservation(uuid, text, text, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.create_reservation(text, text, text, text, numeric, text, text, uuid) to authenticated;
