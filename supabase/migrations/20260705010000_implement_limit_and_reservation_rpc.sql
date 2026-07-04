set check_function_bodies = off;
set search_path = public, extensions;

alter table public.daily_limits
  add column if not exists client_mutation_id uuid;

create unique index if not exists daily_limits_client_mutation_id_unique
on public.daily_limits (client_mutation_id)
where client_mutation_id is not null;

create or replace function public.create_daily_limit(
  target_date date,
  target_station_id uuid,
  total_vehicle_limit integer,
  max_liters_per_vehicle numeric,
  fuel_type_limits jsonb default '[]'::jsonb,
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
  effective_client_mutation_id uuid := coalesce(create_daily_limit.client_mutation_id, gen_random_uuid());
  existing_limit_row public.daily_limits%rowtype;
  saved_limit_row public.daily_limits%rowtype;
  item jsonb;
  item_fuel_type text;
  item_vehicle_limit integer;
  item_liters_limit numeric;
  summed_vehicle_limit integer := 0;
  action_name text := 'CREATE_DAILY_LIMIT';
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['shift_supervisor', 'station_admin']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if total_vehicle_limit is null or total_vehicle_limit <= 0 then
    raise exception 'INVALID_TOTAL_VEHICLE_LIMIT';
  end if;

  if max_liters_per_vehicle is null or max_liters_per_vehicle <= 0 then
    raise exception 'INVALID_MAX_LITERS_PER_VEHICLE';
  end if;

  if jsonb_typeof(coalesce(fuel_type_limits, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_FUEL_TYPE_LIMITS';
  end if;

  select *
  into existing_limit_row
  from public.daily_limits
  where daily_limits.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_limit_row.id is not null then
    return jsonb_build_object(
      'id', existing_limit_row.id,
      'date', existing_limit_row.date,
      'station_id', existing_limit_row.station_id,
      'total_vehicle_limit', existing_limit_row.total_vehicle_limit,
      'max_liters_per_vehicle', existing_limit_row.max_liters_per_vehicle,
      'status', existing_limit_row.status,
      'client_mutation_id', existing_limit_row.client_mutation_id,
      'fuel_type_limits', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', dftl.id,
            'fuel_type', dftl.fuel_type,
            'vehicle_limit', dftl.vehicle_limit,
            'liters_limit', dftl.liters_limit
          )
          order by dftl.fuel_type
        )
        from public.daily_fuel_type_limits dftl
        where dftl.daily_limit_id = existing_limit_row.id
      ), '[]'::jsonb)
    );
  end if;

  for item in
    select value
    from jsonb_array_elements(coalesce(fuel_type_limits, '[]'::jsonb))
  loop
    item_fuel_type := item->>'fuel_type';
    item_vehicle_limit := (item->>'vehicle_limit')::integer;
    item_liters_limit := nullif(item->>'liters_limit', '')::numeric;

    if item_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
      raise exception 'INVALID_FUEL_TYPE';
    end if;

    if item_vehicle_limit is null or item_vehicle_limit < 0 then
      raise exception 'INVALID_FUEL_TYPE_VEHICLE_LIMIT';
    end if;

    if item_liters_limit is not null and item_liters_limit < 0 then
      raise exception 'INVALID_FUEL_TYPE_LITERS_LIMIT';
    end if;

    summed_vehicle_limit := summed_vehicle_limit + item_vehicle_limit;
  end loop;

  if summed_vehicle_limit > total_vehicle_limit then
    raise exception 'FUEL_TYPE_LIMITS_EXCEED_TOTAL_LIMIT';
  end if;

  select *
  into existing_limit_row
  from public.daily_limits
  where date = target_date
    and station_id = target_station_id
  for update;

  if existing_limit_row.id is null then
    insert into public.daily_limits (
      date,
      station_id,
      total_vehicle_limit,
      max_liters_per_vehicle,
      status,
      created_by,
      client_mutation_id
    )
    values (
      target_date,
      target_station_id,
      total_vehicle_limit,
      max_liters_per_vehicle,
      'OPEN',
      current_profile_id,
      effective_client_mutation_id
    )
    returning * into saved_limit_row;
  else
    action_name := 'UPDATE_DAILY_LIMIT';

    update public.daily_limits
    set total_vehicle_limit = create_daily_limit.total_vehicle_limit,
        max_liters_per_vehicle = create_daily_limit.max_liters_per_vehicle,
        client_mutation_id = effective_client_mutation_id
    where id = existing_limit_row.id
    returning * into saved_limit_row;

    delete from public.daily_fuel_type_limits
    where daily_limit_id = saved_limit_row.id;
  end if;

  for item in
    select value
    from jsonb_array_elements(coalesce(fuel_type_limits, '[]'::jsonb))
  loop
    insert into public.daily_fuel_type_limits (
      daily_limit_id,
      fuel_type,
      vehicle_limit,
      liters_limit
    )
    values (
      saved_limit_row.id,
      item->>'fuel_type',
      (item->>'vehicle_limit')::integer,
      nullif(item->>'liters_limit', '')::numeric
    );
  end loop;

  perform public.audit_action(
    action_name,
    'daily_limit',
    saved_limit_row.id,
    case when action_name = 'UPDATE_DAILY_LIMIT' then to_jsonb(existing_limit_row) else null end,
    to_jsonb(saved_limit_row)
  );

  return jsonb_build_object(
    'id', saved_limit_row.id,
    'date', saved_limit_row.date,
    'station_id', saved_limit_row.station_id,
    'total_vehicle_limit', saved_limit_row.total_vehicle_limit,
    'max_liters_per_vehicle', saved_limit_row.max_liters_per_vehicle,
    'status', saved_limit_row.status,
    'client_mutation_id', saved_limit_row.client_mutation_id,
    'fuel_type_limits', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', dftl.id,
          'fuel_type', dftl.fuel_type,
          'vehicle_limit', dftl.vehicle_limit,
          'liters_limit', dftl.liters_limit
        )
        order by dftl.fuel_type
      )
      from public.daily_fuel_type_limits dftl
      where dftl.daily_limit_id = saved_limit_row.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_reservation(
  target_date date,
  target_station_id uuid,
  plate_number text,
  driver_full_name text,
  driver_phone text,
  fuel_type text,
  requested_liters numeric,
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
  daily_limit_row public.daily_limits%rowtype;
  fuel_type_limit_row public.daily_fuel_type_limits%rowtype;
  existing_reservation_row public.fuel_reservations%rowtype;
  saved_reservation_row public.fuel_reservations%rowtype;
  active_station_reservations integer;
  active_fuel_type_reservations integer;
  requested_fuel_type_liters numeric;
  next_queue_number integer;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['operator', 'shift_supervisor', 'station_admin']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  if coalesce(trim(driver_full_name), '') = '' then
    raise exception 'INVALID_DRIVER_FULL_NAME';
  end if;

  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if requested_liters is null or requested_liters <= 0 then
    raise exception 'INVALID_REQUESTED_LITERS';
  end if;

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
      'requested_liters', existing_reservation_row.requested_liters,
      'queue_number', existing_reservation_row.queue_number,
      'status', existing_reservation_row.status,
      'client_mutation_id', existing_reservation_row.client_mutation_id
    );
  end if;

  insert into public.vehicles (
    plate_number,
    normalized_plate_number
  )
  values (
    plate_number,
    normalized_plate
  )
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  if vehicle_row.is_blocked then
    raise exception 'VEHICLE_BLOCKED';
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

  select *
  into daily_limit_row
  from public.daily_limits
  where date = target_date
    and station_id = target_station_id
  for update;

  if daily_limit_row.id is null then
    raise exception 'NO_DAILY_LIMIT';
  end if;

  if daily_limit_row.status <> 'OPEN' then
    raise exception 'DAILY_LIMIT_NOT_OPEN';
  end if;

  if requested_liters > daily_limit_row.max_liters_per_vehicle then
    raise exception 'LITERS_LIMIT_EXCEEDED';
  end if;

  if exists (
    select 1
    from public.fuel_reservations fr
    where fr.vehicle_id = vehicle_row.id
      and fr.date = target_date
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ) then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  select count(*)
  into active_station_reservations
  from public.fuel_reservations fr
  where fr.date = target_date
    and fr.station_id = target_station_id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING');

  if active_station_reservations >= daily_limit_row.total_vehicle_limit then
    raise exception 'DAILY_LIMIT_VEHICLE_LIMIT_EXCEEDED';
  end if;

  select *
  into fuel_type_limit_row
  from public.daily_fuel_type_limits
  where daily_limit_id = daily_limit_row.id
    and daily_fuel_type_limits.fuel_type = create_reservation.fuel_type
  limit 1;

  if fuel_type_limit_row.id is not null then
    select count(*), coalesce(sum(fr.requested_liters), 0)
    into active_fuel_type_reservations, requested_fuel_type_liters
    from public.fuel_reservations fr
    where fr.date = target_date
      and fr.station_id = target_station_id
      and fr.fuel_type = create_reservation.fuel_type
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING');

    if active_fuel_type_reservations >= fuel_type_limit_row.vehicle_limit then
      raise exception 'FUEL_TYPE_VEHICLE_LIMIT_EXCEEDED';
    end if;

    if fuel_type_limit_row.liters_limit is not null
      and requested_fuel_type_liters + requested_liters > fuel_type_limit_row.liters_limit then
      raise exception 'FUEL_TYPE_LITERS_LIMIT_EXCEEDED';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(target_station_id::text), hashtext(target_date::text));

  select coalesce(max(queue_number), 0) + 1
  into next_queue_number
  from public.fuel_reservations
  where date = target_date
    and station_id = target_station_id;

  insert into public.fuel_reservations (
    date,
    station_id,
    vehicle_id,
    driver_id,
    fuel_type,
    requested_liters,
    queue_number,
    status,
    operator_id,
    comment,
    client_mutation_id,
    sync_status
  )
  values (
    target_date,
    target_station_id,
    vehicle_row.id,
    driver_row.id,
    create_reservation.fuel_type,
    requested_liters,
    next_queue_number,
    'RESERVED',
    current_profile_id,
    nullif(trim(comment), ''),
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_reservation_row;

  perform public.audit_action(
    'CREATE_RESERVATION',
    'fuel_reservation',
    saved_reservation_row.id,
    null,
    to_jsonb(saved_reservation_row)
  );

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
    'requested_liters', saved_reservation_row.requested_liters,
    'queue_number', saved_reservation_row.queue_number,
    'status', saved_reservation_row.status,
    'client_mutation_id', saved_reservation_row.client_mutation_id
  );
end;
$$;
