-- Local development queue with 500 active reservations for today.
-- Run only against the local Supabase database:
--   npx supabase db query --local --file supabase/local-queue-500.sql

do $$
declare
  station_id_value uuid := '10000000-0000-0000-0000-000000000001';
  daily_limit_id_value uuid := '61000000-0000-0000-0000-000000000500';
  operator_profile_id uuid;
  n integer;
  reservation_id_value uuid;
  vehicle_id_value uuid;
  driver_id_value uuid;
  plate_letters text[] := array['А', 'В', 'Е', 'К', 'М', 'Н', 'О', 'Р', 'С', 'Т', 'У', 'Х'];
  plate_value text;
  queue_start integer;
  inserted_count integer;
begin
  select p.id
  into operator_profile_id
  from public.profiles p
  join auth.users u on u.id = p.auth_user_id
  where u.email = 'mayor-assistant@example.local'
  limit 1;

  if operator_profile_id is null then
    select p.id
    into operator_profile_id
    from public.profiles p
    where p.role in ('mayor', 'station_manager', 'mayor_assistant')
      and p.is_active = true
      and p.approval_status = 'approved'
    order by case p.role when 'mayor_assistant' then 0 when 'mayor' then 1 else 2 end
    limit 1;
  end if;

  if operator_profile_id is null then
    raise exception 'Create local dev users before local-queue-500.sql.';
  end if;

  insert into public.stations (id, name, address, is_active)
  values (station_id_value, 'AZS #1', 'Main station #1', true)
  on conflict (id) do update
  set
    name = excluded.name,
    address = excluded.address,
    is_active = excluded.is_active;

  delete from public.fuel_reservations
  where comment = 'Local 500 queue seed';

  insert into public.daily_limits (
    id,
    date,
    station_id,
    total_vehicle_limit,
    max_liters_per_vehicle,
    status,
    created_by
  )
  values (
    daily_limit_id_value,
    current_date,
    station_id_value,
    600,
    60,
    'OPEN',
    operator_profile_id
  )
  on conflict (date, station_id) do update
  set
    total_vehicle_limit = greatest(public.daily_limits.total_vehicle_limit, excluded.total_vehicle_limit),
    max_liters_per_vehicle = greatest(public.daily_limits.max_liters_per_vehicle, excluded.max_liters_per_vehicle),
    status = 'OPEN',
    created_by = excluded.created_by,
    updated_at = now();

  insert into public.daily_fuel_type_limits (
    daily_limit_id,
    fuel_type,
    vehicle_limit,
    liters_limit,
    fuel_category,
    limit_mode
  )
  values
    (daily_limit_id_value, 'AI_92', 200, 12000, 'GASOLINE', 'vehicle_count'),
    (daily_limit_id_value, 'AI_95', 600, 36000, 'GASOLINE', 'vehicle_count'),
    (daily_limit_id_value, 'AI_100', 100, 6000, 'GASOLINE', 'vehicle_count'),
    (daily_limit_id_value, 'DIESEL', 100, 6000, 'DIESEL', 'vehicle_count'),
    (daily_limit_id_value, 'GAS', 100, 6000, 'GAS', 'vehicle_count')
  on conflict (daily_limit_id, fuel_type) do update
  set
    vehicle_limit = excluded.vehicle_limit,
    liters_limit = excluded.liters_limit,
    fuel_category = excluded.fuel_category,
    limit_mode = excluded.limit_mode,
    updated_at = now();

  select coalesce(max(queue_number), 0) + 1
  into queue_start
  from public.fuel_reservations;

  for n in 1..500 loop
    reservation_id_value := (
      substr(md5('local-queue-reservation-' || n::text), 1, 8) || '-' ||
      substr(md5('local-queue-reservation-' || n::text), 9, 4) || '-' ||
      substr(md5('local-queue-reservation-' || n::text), 13, 4) || '-' ||
      substr(md5('local-queue-reservation-' || n::text), 17, 4) || '-' ||
      substr(md5('local-queue-reservation-' || n::text), 21, 12)
    )::uuid;
    vehicle_id_value := (
      substr(md5('local-queue-vehicle-' || n::text), 1, 8) || '-' ||
      substr(md5('local-queue-vehicle-' || n::text), 9, 4) || '-' ||
      substr(md5('local-queue-vehicle-' || n::text), 13, 4) || '-' ||
      substr(md5('local-queue-vehicle-' || n::text), 17, 4) || '-' ||
      substr(md5('local-queue-vehicle-' || n::text), 21, 12)
    )::uuid;
    driver_id_value := (
      substr(md5('local-queue-driver-' || n::text), 1, 8) || '-' ||
      substr(md5('local-queue-driver-' || n::text), 9, 4) || '-' ||
      substr(md5('local-queue-driver-' || n::text), 13, 4) || '-' ||
      substr(md5('local-queue-driver-' || n::text), 17, 4) || '-' ||
      substr(md5('local-queue-driver-' || n::text), 21, 12)
    )::uuid;

    plate_value :=
      plate_letters[1 + ((n - 1) % array_length(plate_letters, 1))] ||
      lpad(((n - 1) % 1000)::text, 3, '0') ||
      plate_letters[1 + ((n + 3) % array_length(plate_letters, 1))] ||
      plate_letters[1 + ((n + 7) % array_length(plate_letters, 1))] ||
      '777';

    insert into public.vehicles (
      id,
      plate_number,
      normalized_plate_number,
      is_blocked,
      block_reason
    )
    values (
      vehicle_id_value,
      plate_value,
      plate_value,
      false,
      null
    )
    on conflict (normalized_plate_number) do update
    set
      plate_number = excluded.plate_number,
      is_blocked = false,
      block_reason = null,
      updated_at = now();

    insert into public.drivers (id, full_name, phone)
    values (
      driver_id_value,
      'Queue Driver ' || lpad(n::text, 3, '0'),
      '+7900' || lpad(n::text, 7, '0')
    )
    on conflict (id) do update
    set
      full_name = excluded.full_name,
      phone = excluded.phone,
      updated_at = now();

    insert into public.fuel_reservations (
      id,
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
      sync_status,
      fuel_preference_mode,
      created_at,
      updated_at
    )
    values (
      reservation_id_value,
      current_date,
      station_id_value,
      vehicle_id_value,
      driver_id_value,
      case
        when n % 10 = 0 then 'DIESEL'
        when n % 15 = 0 then 'GAS'
        when n % 7 = 0 then 'AI_92'
        when n % 11 = 0 then 'AI_100'
        else 'AI_95'
      end,
      20 + (n % 31),
      queue_start + n - 1,
      'RESERVED',
      operator_profile_id,
      'Local 500 queue seed',
      (
        substr(md5('local-queue-mutation-' || n::text), 1, 8) || '-' ||
        substr(md5('local-queue-mutation-' || n::text), 9, 4) || '-' ||
        substr(md5('local-queue-mutation-' || n::text), 13, 4) || '-' ||
        substr(md5('local-queue-mutation-' || n::text), 17, 4) || '-' ||
        substr(md5('local-queue-mutation-' || n::text), 21, 12)
      )::uuid,
      'SYNCED',
      case when n % 13 = 0 then 'ANY_GASOLINE' else 'EXACT' end,
      now() + make_interval(secs => n),
      now() + make_interval(secs => n)
    );
  end loop;

  select count(*)
  into inserted_count
  from public.fuel_reservations
  where comment = 'Local 500 queue seed'
    and date = current_date
    and status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING');

  raise notice 'local-queue-500-ready: active_seed_reservations=%', inserted_count;
end $$;
