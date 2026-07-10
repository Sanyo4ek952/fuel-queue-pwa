set check_function_bodies = off;
set search_path = public, extensions;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('mayor', 'station_manager', 'cashier', 'mayor_assistant', 'consumer'));

create table if not exists public.profile_vehicles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'BLOCKED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, vehicle_id)
);

create index if not exists idx_profile_vehicles_profile_status
on public.profile_vehicles (profile_id, status);

create index if not exists idx_profile_vehicles_vehicle
on public.profile_vehicles (vehicle_id);

drop trigger if exists set_profile_vehicles_updated_at on public.profile_vehicles;
create trigger set_profile_vehicles_updated_at
before update on public.profile_vehicles
for each row execute function public.set_updated_at();

alter table public.profile_vehicles enable row level security;

create or replace function public.has_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_user_role_row as (
    select public.get_current_user_role() as role
  )
  select coalesce(
    role = 'mayor'
      or role = any(required_roles)
      or (
        role = 'station_manager'
        and required_roles && array[
          'station_manager',
          'station_admin',
          'shift_supervisor',
          'operator',
          'cashier'
        ]
      )
      or (
        role = 'cashier'
        and required_roles && array['cashier']
      )
      or (
        role = 'mayor_assistant'
        and required_roles && array['mayor_assistant', 'operator']
      )
      or (
        role = 'consumer'
        and required_roles && array['consumer']
      ),
    false
  )
  from current_user_role_row
$$;

create or replace function public.can_access_station(target_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_current_user_role() in ('mayor', 'mayor_assistant'), false)
    or exists (
      select 1
      from public.user_stations us
      where us.user_id = public.get_current_profile_id()
        and us.station_id = target_station_id
    )
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  first_name_value text := nullif(trim(meta->>'first_name'), '');
  last_name_value text := nullif(trim(meta->>'last_name'), '');
  middle_name_value text := nullif(trim(meta->>'middle_name'), '');
  full_name_value text;
  requested_role_value text := case
    when nullif(trim(meta->>'requested_role'), '') = 'consumer' then 'consumer'
    when nullif(trim(meta->>'requested_role'), '') in ('cashier', 'mayor_assistant')
      then nullif(trim(meta->>'requested_role'), '')
    else 'cashier'
  end;
  requested_station_value uuid;
begin
  full_name_value := nullif(
    trim(concat_ws(' ', last_name_value, first_name_value, middle_name_value)),
    ''
  );

  if requested_role_value = 'cashier'
    and nullif(meta->>'requested_station_id', '') is not null then
    requested_station_value := (meta->>'requested_station_id')::uuid;
  end if;

  insert into public.profiles (
    auth_user_id,
    full_name,
    first_name,
    last_name,
    middle_name,
    position,
    signature_name,
    requested_station_id,
    role,
    is_active,
    approval_status
  )
  values (
    new.id,
    coalesce(full_name_value, new.email, 'Pending user'),
    first_name_value,
    last_name_value,
    middle_name_value,
    nullif(trim(meta->>'position'), ''),
    coalesce(nullif(trim(meta->>'signature_name'), ''), full_name_value, new.email),
    requested_station_value,
    requested_role_value,
    requested_role_value = 'consumer',
    case when requested_role_value = 'consumer' then 'approved' else 'pending' end
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

drop policy if exists profile_vehicles_select_own_or_staff on public.profile_vehicles;
create policy profile_vehicles_select_own_or_staff
on public.profile_vehicles
for select
to authenticated
using (
  profile_id = public.get_current_profile_id()
  or coalesce(public.get_current_user_role(), '') in ('mayor', 'station_manager', 'mayor_assistant')
);

drop policy if exists vehicles_select_authenticated on public.vehicles;
create policy vehicles_select_authenticated
on public.vehicles
for select
to authenticated
using (
  coalesce(public.get_current_user_role(), '') <> 'consumer'
  or exists (
    select 1
    from public.profile_vehicles pv
    where pv.vehicle_id = vehicles.id
      and pv.profile_id = public.get_current_profile_id()
      and pv.status = 'ACTIVE'
  )
);

drop policy if exists drivers_select_authenticated on public.drivers;
create policy drivers_select_authenticated
on public.drivers
for select
to authenticated
using (
  coalesce(public.get_current_user_role(), '') <> 'consumer'
  or exists (
    select 1
    from public.fuel_reservations fr
    where fr.driver_id = drivers.id
      and fr.operator_id = public.get_current_profile_id()
  )
);

drop policy if exists fuel_reservations_select_accessible on public.fuel_reservations;
create policy fuel_reservations_select_accessible
on public.fuel_reservations
for select
to authenticated
using (
  case
    when coalesce(public.get_current_user_role(), '') = 'consumer'
      then operator_id = public.get_current_profile_id()
    else public.get_current_profile_id() is not null
  end
);

create or replace function public.consumer_vehicle_to_json(
  profile_vehicle_row public.profile_vehicles,
  vehicle_row public.vehicles
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', (vehicle_row).id,
    'profile_vehicle_id', (profile_vehicle_row).id,
    'plate_number', (vehicle_row).plate_number,
    'normalized_plate_number', (vehicle_row).normalized_plate_number,
    'is_blocked', (vehicle_row).is_blocked,
    'block_reason', (vehicle_row).block_reason,
    'status', (profile_vehicle_row).status,
    'created_at', (profile_vehicle_row).created_at,
    'updated_at', (profile_vehicle_row).updated_at
  )
$$;

create or replace function public.list_my_vehicles()
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

  return coalesce((
    select jsonb_agg(public.consumer_vehicle_to_json(pv, v) order by pv.created_at asc)
    from public.profile_vehicles pv
    join public.vehicles v on v.id = pv.vehicle_id
    where pv.profile_id = current_profile_id
      and pv.status = 'ACTIVE'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_consumer_vehicle(
  plate_number text,
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
    'status', saved_reservation_row.status,
    'client_mutation_id', saved_reservation_row.client_mutation_id
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
      'status', fr.status,
      'client_mutation_id', fr.client_mutation_id,
      'created_at', fr.created_at,
      'updated_at', fr.updated_at
    )
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.drivers d on d.id = fr.driver_id
    left join active_positions ap on ap.id = fr.id
    where fr.operator_id = current_profile_id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by fr.queue_number asc
    limit 1
  );
end;
$$;

create or replace function public.cancel_my_reservation(
  reservation_id uuid,
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
  reservation_row public.fuel_reservations%rowtype;
  saved_reservation_row public.fuel_reservations%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.id = cancel_my_reservation.reservation_id
    and fr.operator_id = current_profile_id
  limit 1
  for update;

  if reservation_row.id is null then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;

  if reservation_row.status <> 'RESERVED' then
    raise exception 'RESERVATION_CANCEL_FORBIDDEN';
  end if;

  update public.fuel_reservations
  set status = 'CANCELLED',
      sync_status = 'SYNCED',
      cancelled_by = current_profile_id,
      cancelled_at = now(),
      cancel_reason = 'OWNER_CANCELLED',
      cancel_comment = null
  where id = reservation_row.id
  returning * into saved_reservation_row;

  perform public.audit_action('CANCEL_MY_RESERVATION', 'fuel_reservation', saved_reservation_row.id, to_jsonb(reservation_row), to_jsonb(saved_reservation_row));

  return jsonb_build_object(
    'id', saved_reservation_row.id,
    'date', saved_reservation_row.date,
    'station_id', saved_reservation_row.station_id,
    'vehicle_id', saved_reservation_row.vehicle_id,
    'queue_number', saved_reservation_row.queue_number,
    'status', saved_reservation_row.status,
    'sync_status', saved_reservation_row.sync_status,
    'cancelled_by', saved_reservation_row.cancelled_by,
    'cancelled_at', saved_reservation_row.cancelled_at,
    'cancel_reason', saved_reservation_row.cancel_reason,
    'cancel_comment', saved_reservation_row.cancel_comment,
    'updated_at', saved_reservation_row.updated_at
  );
end;
$$;

grant execute on function public.list_my_vehicles() to authenticated;
grant execute on function public.create_consumer_vehicle(text, uuid) to authenticated;
grant execute on function public.create_consumer_reservation(uuid, text, text, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.get_my_queue_status() to authenticated;
grant execute on function public.cancel_my_reservation(uuid, uuid) to authenticated;
