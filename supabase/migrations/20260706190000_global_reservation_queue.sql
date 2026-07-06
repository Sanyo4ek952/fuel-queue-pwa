set check_function_bodies = off;
set search_path = public, extensions;

drop policy if exists fuel_reservations_select_accessible on public.fuel_reservations;

alter table public.fuel_reservations
  alter column date drop not null,
  alter column station_id drop not null;

with ordered_reservations as (
  select
    id,
    row_number() over (
      order by created_at asc, date asc nulls last, station_id asc nulls last, queue_number asc, id asc
    ) as next_queue_number
  from public.fuel_reservations
)
update public.fuel_reservations fr
set queue_number = ordered_reservations.next_queue_number
from ordered_reservations
where fr.id = ordered_reservations.id;

with duplicate_active_reservations as (
  select
    id,
    row_number() over (
      partition by vehicle_id
      order by created_at asc, queue_number asc, id asc
    ) as active_rank
  from public.fuel_reservations
  where status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
)
update public.fuel_reservations fr
set status = 'CONFLICT',
    sync_status = 'CONFLICT'
from duplicate_active_reservations dar
where fr.id = dar.id
  and dar.active_rank > 1;

alter table public.fuel_reservations
  drop constraint if exists fuel_reservations_date_station_id_queue_number_key;

drop index if exists public.unique_active_reservation_per_vehicle_day;
drop index if exists public.idx_reservations_date_station;
drop index if exists public.idx_reservations_vehicle_date;

create unique index if not exists unique_active_reservation_per_vehicle
on public.fuel_reservations (vehicle_id)
where status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING');

create unique index if not exists unique_reservation_queue_number
on public.fuel_reservations (queue_number);

create index if not exists idx_reservations_status_queue
on public.fuel_reservations (status, queue_number);

create index if not exists idx_reservations_vehicle_status
on public.fuel_reservations (vehicle_id, status);

create policy fuel_reservations_select_accessible
on public.fuel_reservations
for select
to authenticated
using (public.get_current_profile_id() is not null);

drop function if exists public.create_reservation(date, uuid, text, text, text, text, numeric, text, uuid);

create or replace function public.create_reservation(
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
  existing_reservation_row public.fuel_reservations%rowtype;
  saved_reservation_row public.fuel_reservations%rowtype;
  next_queue_number integer;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['operator', 'shift_supervisor', 'station_admin']) then
    raise exception 'FORBIDDEN';
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

create or replace function public.get_daily_limit_overview(
  target_date date,
  target_station_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  daily_limit_row public.daily_limits%rowtype;
  active_statuses text[] := array['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'];
  projected_vehicle_count integer := 0;
  projected_queue_number integer;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  select *
  into daily_limit_row
  from public.daily_limits dl
  where dl.date = target_date
    and dl.station_id = target_station_id
  limit 1;

  if daily_limit_row.id is null then
    return jsonb_build_object(
      'exists', false,
      'date', target_date,
      'station_id', target_station_id,
      'status', null,
      'total_vehicle_limit', null,
      'max_liters_per_vehicle', null,
      'occupied_vehicle_count', 0,
      'remaining_vehicle_count', null,
      'projected_queue_number', null,
      'fuel_type_overviews', '[]'::jsonb,
      'updated_at', null
    );
  end if;

  with active_reservations as (
    select
      fr.id,
      fr.fuel_type,
      fr.requested_liters,
      fr.queue_number,
      row_number() over (order by fr.queue_number asc, fr.id asc)::integer as queue_position,
      count(*) over (partition by fr.fuel_type order by fr.queue_number asc, fr.id asc)::integer as fuel_type_position,
      sum(fr.requested_liters) over (partition by fr.fuel_type order by fr.queue_number asc, fr.id asc)::numeric as fuel_type_liters
    from public.fuel_reservations fr
    where fr.status = any(active_statuses)
  ),
  eligible_reservations as (
    select ar.*
    from active_reservations ar
    left join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = daily_limit_row.id
     and dftl.fuel_type = ar.fuel_type
    where ar.queue_position <= daily_limit_row.total_vehicle_limit
      and ar.fuel_type_position <= coalesce(dftl.vehicle_limit, 0)
      and (
        dftl.liters_limit is null
        or ar.fuel_type_liters <= dftl.liters_limit
      )
  )
  select count(*)::integer, max(queue_number)
  into projected_vehicle_count, projected_queue_number
  from eligible_reservations;

  return jsonb_build_object(
    'exists', true,
    'id', daily_limit_row.id,
    'date', daily_limit_row.date,
    'station_id', daily_limit_row.station_id,
    'status', daily_limit_row.status,
    'total_vehicle_limit', daily_limit_row.total_vehicle_limit,
    'max_liters_per_vehicle', daily_limit_row.max_liters_per_vehicle,
    'occupied_vehicle_count', projected_vehicle_count,
    'remaining_vehicle_count', greatest(daily_limit_row.total_vehicle_limit - projected_vehicle_count, 0),
    'projected_queue_number', projected_queue_number,
    'fuel_type_overviews', coalesce((
      with fuel_types(fuel_type, sort_order) as (
        values
          ('AI_92', 1),
          ('AI_95', 2),
          ('AI_100', 3),
          ('DIESEL', 4),
          ('GAS', 5),
          ('OTHER', 6)
      ),
      active_reservations as (
        select
          fr.id,
          fr.fuel_type,
          fr.requested_liters,
          fr.queue_number,
          row_number() over (order by fr.queue_number asc, fr.id asc)::integer as queue_position,
          count(*) over (partition by fr.fuel_type order by fr.queue_number asc, fr.id asc)::integer as fuel_type_position,
          sum(fr.requested_liters) over (partition by fr.fuel_type order by fr.queue_number asc, fr.id asc)::numeric as fuel_type_liters
        from public.fuel_reservations fr
        where fr.status = any(active_statuses)
      ),
      eligible_reservations as (
        select ar.*
        from active_reservations ar
        left join public.daily_fuel_type_limits dftl
          on dftl.daily_limit_id = daily_limit_row.id
         and dftl.fuel_type = ar.fuel_type
        where ar.queue_position <= daily_limit_row.total_vehicle_limit
          and ar.fuel_type_position <= coalesce(dftl.vehicle_limit, 0)
          and (
            dftl.liters_limit is null
            or ar.fuel_type_liters <= dftl.liters_limit
          )
      ),
      projected_by_fuel_type as (
        select
          er.fuel_type,
          count(*)::integer as occupied_vehicle_count,
          coalesce(sum(er.requested_liters), 0)::numeric as reserved_liters
        from eligible_reservations er
        group by er.fuel_type
      )
      select jsonb_agg(
        jsonb_build_object(
          'fuel_type', ft.fuel_type,
          'vehicle_limit', coalesce(dftl.vehicle_limit, 0),
          'occupied_vehicle_count', coalesce(pft.occupied_vehicle_count, 0),
          'remaining_vehicle_count', greatest(coalesce(dftl.vehicle_limit, 0) - coalesce(pft.occupied_vehicle_count, 0), 0),
          'liters_limit', dftl.liters_limit,
          'reserved_liters', coalesce(pft.reserved_liters, 0),
          'remaining_liters', case
            when dftl.liters_limit is null then null
            else greatest(dftl.liters_limit - coalesce(pft.reserved_liters, 0), 0)
          end
        )
        order by ft.sort_order
      )
      from fuel_types ft
      left join public.daily_fuel_type_limits dftl
        on dftl.daily_limit_id = daily_limit_row.id
       and dftl.fuel_type = ft.fuel_type
      left join projected_by_fuel_type pft
        on pft.fuel_type = ft.fuel_type
    ), '[]'::jsonb),
    'updated_at', daily_limit_row.updated_at
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
  if operation_type = 'CREATE_RESERVATION' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_reservation(
        payload->>'plate_number',
        payload->>'driver_full_name',
        payload->>'driver_phone',
        payload->>'fuel_type',
        (payload->>'requested_liters')::numeric,
        payload->>'comment',
        client_mutation_id
      )
    );
  end if;

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

  if operation_type = 'CREATE_MANUAL_OVERRIDE' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_manual_override(
        (payload->>'target_date')::date,
        (payload->>'station_id')::uuid,
        payload->>'plate_number',
        payload->>'reason',
        nullif(payload->>'expires_at', '')::timestamptz,
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

grant execute on function public.create_reservation(text, text, text, text, numeric, text, uuid) to authenticated;
grant execute on function public.check_vehicle_access(text, uuid, date) to authenticated;
grant execute on function public.create_fueling_record(uuid, text, numeric, text, date, timestamptz, text, uuid) to authenticated;
grant execute on function public.get_daily_limit_overview(date, uuid) to authenticated;
grant execute on function public.sync_offline_mutation(uuid, text, jsonb) to authenticated;
