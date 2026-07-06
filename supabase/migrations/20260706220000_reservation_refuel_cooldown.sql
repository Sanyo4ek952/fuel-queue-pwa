set check_function_bodies = off;
set search_path = public, extensions;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  client_mutation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists app_settings_client_mutation_id_unique
on public.app_settings (client_mutation_id)
where client_mutation_id is not null;

drop trigger if exists set_app_settings_updated_at on public.app_settings;
create trigger set_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

drop policy if exists app_settings_select_authenticated on public.app_settings;
create policy app_settings_select_authenticated
on public.app_settings
for select
to authenticated
using (public.get_current_profile_id() is not null);

create or replace function public.get_reservation_refuel_cooldown()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(coalesce((value->>'days')::integer, 0), 0)
  from public.app_settings
  where key = 'reservation_refuel_cooldown_days'
  union all
  select 0
  limit 1
$$;

create or replace function public.set_reservation_refuel_cooldown(
  days integer,
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
  effective_client_mutation_id uuid := coalesce(set_reservation_refuel_cooldown.client_mutation_id, gen_random_uuid());
  existing_setting public.app_settings%rowtype;
  saved_setting public.app_settings%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if days is null or days < 0 or days > 3650 then
    raise exception 'INVALID_REFUEL_COOLDOWN_DAYS';
  end if;

  select *
  into existing_setting
  from public.app_settings
  where app_settings.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_setting.key is not null then
    return jsonb_build_object(
      'days', greatest(coalesce((existing_setting.value->>'days')::integer, 0), 0),
      'updated_at', existing_setting.updated_at,
      'client_mutation_id', existing_setting.client_mutation_id
    );
  end if;

  insert into public.app_settings (key, value, updated_by, client_mutation_id)
  values (
    'reservation_refuel_cooldown_days',
    jsonb_build_object('days', days),
    current_profile_id,
    effective_client_mutation_id
  )
  on conflict (key) do update
  set value = excluded.value,
      updated_by = excluded.updated_by,
      client_mutation_id = excluded.client_mutation_id
  returning * into saved_setting;

  perform public.audit_action(
    'SET_RESERVATION_REFUEL_COOLDOWN',
    'app_setting',
    null,
    case when existing_setting.key is null then null else to_jsonb(existing_setting) end,
    to_jsonb(saved_setting)
  );

  return jsonb_build_object(
    'days', days,
    'updated_at', saved_setting.updated_at,
    'client_mutation_id', saved_setting.client_mutation_id
  );
end;
$$;

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
  last_fueling_row public.fueling_records%rowtype;
  cooldown_days integer;
  next_allowed_date date;
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
  daily_limit_row public.daily_limits%rowtype;
  category_limit_row public.daily_fuel_type_limits%rowtype;
  manual_override_is_mayor boolean := false;
  cooldown_days integer;
  next_allowed_date date;
  queue_category text;
  category_position integer;
  category_liters numeric;
  effective_liters numeric;
  is_covered boolean := false;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'PROFILE_NOT_FOUND', 'normalized_plate_number', normalized_plate);
  end if;

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

  select * into last_fueling_row
  from public.fueling_records fr
  where fr.vehicle_id = vehicle_row.id
    and fr.is_manual_override = false
  order by fr.date desc, fr.fueled_at desc
  limit 1;

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
        'date', check_date
      );
    end if;

    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'station_id', station_id, 'date', check_date);
  end if;

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
      'fuel_category', public.get_fuel_queue_category(reservation_row.fuel_type),
      'requested_liters', reservation_row.requested_liters,
      'manual_override_id', manual_override_row.id
    );
  end if;

  queue_category := public.get_fuel_queue_category(reservation_row.fuel_type);

  if queue_category = 'OTHER' then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'OUTSIDE_TODAY_LIMIT', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'reservation_id', reservation_row.id, 'station_id', station_id, 'date', check_date, 'queue_number', reservation_row.queue_number, 'fuel_type', reservation_row.fuel_type);
  end if;

  select * into daily_limit_row
  from public.daily_limits dl
  where dl.date = check_vehicle_access.check_date
    and dl.station_id is null
    and dl.status = 'OPEN'
  limit 1;

  if daily_limit_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_GLOBAL_DAILY_LIMIT', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'reservation_id', reservation_row.id, 'station_id', station_id, 'date', check_date, 'queue_number', reservation_row.queue_number, 'fuel_type', reservation_row.fuel_type, 'fuel_category', queue_category);
  end if;

  select * into category_limit_row
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = daily_limit_row.id
    and dftl.fuel_category = queue_category
  limit 1;

  if category_limit_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'OUTSIDE_TODAY_LIMIT', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'reservation_id', reservation_row.id, 'station_id', station_id, 'date', check_date, 'queue_number', reservation_row.queue_number, 'fuel_type', reservation_row.fuel_type, 'fuel_category', queue_category);
  end if;

  with active_reservations as (
    select
      fr.id,
      fr.vehicle_id,
      fr.queue_number,
      coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters
    from public.fuel_reservations fr
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = check_vehicle_access.check_date
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
      and public.get_fuel_queue_category(fr.fuel_type) = queue_category
  ),
  ranked as (
    select
      ar.*,
      row_number() over (order by ar.queue_number asc, ar.id asc)::integer as category_position,
      sum(ar.effective_liters) over (order by ar.queue_number asc, ar.id asc)::numeric as category_liters
    from active_reservations ar
  )
  select r.category_position, r.category_liters, r.effective_liters
  into category_position, category_liters, effective_liters
  from ranked r
  where r.id = reservation_row.id;

  is_covered :=
    (category_limit_row.limit_mode = 'vehicle_count' and category_position <= category_limit_row.vehicle_limit)
    or (category_limit_row.limit_mode = 'fuel_liters' and category_liters <= coalesce(category_limit_row.liters_limit, 0));

  if not is_covered then
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
      'fuel_category', queue_category,
      'effective_liters', effective_liters,
      'category_position', category_position,
      'category_liters', category_liters
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
    'fuel_category', queue_category,
    'requested_liters', reservation_row.requested_liters,
    'effective_liters', effective_liters,
    'category_position', category_position,
    'category_liters', category_liters
  );
end;
$$;

grant execute on function public.get_reservation_refuel_cooldown() to authenticated;
grant execute on function public.set_reservation_refuel_cooldown(integer, uuid) to authenticated;
grant execute on function public.create_reservation(text, text, text, text, numeric, text, uuid) to authenticated;
grant execute on function public.check_vehicle_access(text, uuid, date) to authenticated;
