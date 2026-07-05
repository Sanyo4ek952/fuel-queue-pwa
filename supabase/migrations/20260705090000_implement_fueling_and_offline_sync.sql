set search_path = public, extensions;

create unique index if not exists fueling_records_vehicle_date_regular_unique
on public.fueling_records (date, vehicle_id)
where is_manual_override = false;

drop function if exists public.create_fueling_record(uuid, text, numeric, text, uuid);

create or replace function public.create_fueling_record(
  target_station_id uuid,
  plate_number text,
  liters numeric,
  fuel_type text default null,
  target_date date default current_date,
  fueled_at timestamptz default now(),
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
  effective_client_mutation_id uuid := coalesce(create_fueling_record.client_mutation_id, gen_random_uuid());
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  daily_limit_row public.daily_limits%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  existing_fueling_row public.fueling_records%rowtype;
  saved_fueling_row public.fueling_records%rowtype;
  effective_fuel_type text;
  is_override boolean := false;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['cashier', 'shift_supervisor', 'station_admin']) then
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

  if liters is null or liters <= 0 then
    raise exception 'INVALID_LITERS';
  end if;

  select *
  into existing_fueling_row
  from public.fueling_records
  where fueling_records.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_fueling_row.id is not null then
    return jsonb_build_object(
      'id', existing_fueling_row.id,
      'date', existing_fueling_row.date,
      'station_id', existing_fueling_row.station_id,
      'vehicle_id', existing_fueling_row.vehicle_id,
      'driver_id', existing_fueling_row.driver_id,
      'reservation_id', existing_fueling_row.reservation_id,
      'queue_entry_id', existing_fueling_row.queue_entry_id,
      'fuel_type', existing_fueling_row.fuel_type,
      'liters', existing_fueling_row.liters,
      'is_manual_override', existing_fueling_row.is_manual_override,
      'override_id', existing_fueling_row.override_id,
      'client_mutation_id', existing_fueling_row.client_mutation_id,
      'sync_status', existing_fueling_row.sync_status,
      'fueled_at', existing_fueling_row.fueled_at
    );
  end if;

  select *
  into vehicle_row
  from public.vehicles
  where normalized_plate_number = normalized_plate
  limit 1;

  if vehicle_row.id is null then
    raise exception 'NO_ACTIVE_RESERVATION';
  end if;

  select *
  into manual_override_row
  from public.manual_overrides
  where vehicle_id = vehicle_row.id
    and station_id = target_station_id
    and date = target_date
    and used_at is null
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;

  if vehicle_row.is_blocked and manual_override_row.id is null then
    raise exception 'VEHICLE_BLOCKED';
  end if;

  select *
  into reservation_row
  from public.fuel_reservations
  where vehicle_id = vehicle_row.id
    and station_id = target_station_id
    and date = target_date
    and status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  order by queue_number asc
  limit 1
  for update;

  if reservation_row.id is null and manual_override_row.id is null then
    raise exception 'NO_ACTIVE_RESERVATION';
  end if;

  is_override := manual_override_row.id is not null;
  effective_fuel_type := coalesce(reservation_row.fuel_type, nullif(fuel_type, ''));

  if effective_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if exists (
    select 1
    from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id
      and fr.date = target_date
      and fr.is_manual_override = false
  ) and not is_override then
    raise exception 'ALREADY_FUELED';
  end if;

  select *
  into daily_limit_row
  from public.daily_limits
  where date = target_date
    and station_id = target_station_id
  limit 1;

  if daily_limit_row.id is null and not is_override then
    raise exception 'NO_DAILY_LIMIT';
  end if;

  if daily_limit_row.id is not null and daily_limit_row.status <> 'OPEN' and not is_override then
    raise exception 'DAILY_LIMIT_NOT_OPEN';
  end if;

  if daily_limit_row.id is not null
    and liters > daily_limit_row.max_liters_per_vehicle
    and not is_override then
    raise exception 'LITERS_LIMIT_EXCEEDED';
  end if;

  insert into public.fueling_records (
    date,
    station_id,
    vehicle_id,
    driver_id,
    reservation_id,
    fuel_type,
    liters,
    cashier_id,
    is_manual_override,
    override_id,
    comment,
    client_mutation_id,
    sync_status,
    fueled_at
  )
  values (
    target_date,
    target_station_id,
    vehicle_row.id,
    reservation_row.driver_id,
    reservation_row.id,
    effective_fuel_type,
    liters,
    current_profile_id,
    is_override,
    manual_override_row.id,
    nullif(trim(comment), ''),
    effective_client_mutation_id,
    'SYNCED',
    coalesce(create_fueling_record.fueled_at, now())
  )
  returning * into saved_fueling_row;

  if reservation_row.id is not null then
    update public.fuel_reservations
    set status = 'FUELED',
        approved_by = coalesce(approved_by, current_profile_id)
    where id = reservation_row.id;
  end if;

  if manual_override_row.id is not null then
    update public.manual_overrides
    set used_at = coalesce(create_fueling_record.fueled_at, now())
    where id = manual_override_row.id;
  end if;

  perform public.audit_action(
    'CREATE_FUELING_RECORD',
    'fueling_record',
    saved_fueling_row.id,
    null,
    to_jsonb(saved_fueling_row)
  );

  return jsonb_build_object(
    'id', saved_fueling_row.id,
    'date', saved_fueling_row.date,
    'station_id', saved_fueling_row.station_id,
    'vehicle_id', saved_fueling_row.vehicle_id,
    'driver_id', saved_fueling_row.driver_id,
    'reservation_id', saved_fueling_row.reservation_id,
    'queue_entry_id', saved_fueling_row.queue_entry_id,
    'fuel_type', saved_fueling_row.fuel_type,
    'liters', saved_fueling_row.liters,
    'is_manual_override', saved_fueling_row.is_manual_override,
    'override_id', saved_fueling_row.override_id,
    'client_mutation_id', saved_fueling_row.client_mutation_id,
    'sync_status', saved_fueling_row.sync_status,
    'fueled_at', saved_fueling_row.fueled_at
  );
end;
$$;

create or replace function public.sync_offline_mutation(
  client_mutation_id uuid,
  operation_type text,
  payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if operation_type = 'CREATE_FUELING_RECORD' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_fueling_record(
        (payload->>'station_id')::uuid,
        payload->>'plate_number',
        (payload->>'liters')::numeric,
        payload->>'fuel_type',
        (payload->>'target_date')::date,
        (payload->>'fueled_at')::timestamptz,
        payload->>'comment',
        client_mutation_id
      )
    );
  end if;

  raise exception 'UNSUPPORTED_OFFLINE_OPERATION';
exception
  when others then
    return jsonb_build_object(
      'status', 'CONFLICT',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'reason', sqlerrm,
      'payload', payload
    );
end;
$$;

grant execute on function public.create_fueling_record(uuid, text, numeric, text, date, timestamptz, text, uuid) to authenticated;
grant execute on function public.sync_offline_mutation(uuid, text, jsonb) to authenticated;
