set check_function_bodies = off;
set search_path = public, extensions;

alter table public.fuel_reservations
  add column if not exists missed_fueling_days integer not null default 0,
  add column if not exists last_missed_fueling_date date;

create or replace function public.get_reservation_no_show_grace_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(coalesce((value->>'days')::integer, 0), 0)
  from public.app_settings
  where key = 'reservation_no_show_grace_days'
  union all
  select 0
  limit 1
$$;

create or replace function public.set_reservation_no_show_grace_days(
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
  effective_client_mutation_id uuid := coalesce(set_reservation_no_show_grace_days.client_mutation_id, gen_random_uuid());
  existing_setting public.app_settings%rowtype;
  saved_setting public.app_settings%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if days is null or days < 0 or days > 3650 then
    raise exception 'INVALID_NO_SHOW_GRACE_DAYS';
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
    'reservation_no_show_grace_days',
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
    'SET_RESERVATION_NO_SHOW_GRACE',
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

create or replace function public.is_reservation_covered_by_daily_limit(
  reservation_id uuid,
  target_date date
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  reservation_row public.fuel_reservations%rowtype;
  daily_limit_row public.daily_limits%rowtype;
  category_limit_row public.daily_fuel_type_limits%rowtype;
  queue_category text;
  category_position integer;
  category_liters numeric;
begin
  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.id = is_reservation_covered_by_daily_limit.reservation_id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  limit 1;

  if reservation_row.id is null then
    return false;
  end if;

  queue_category := public.get_fuel_queue_category(reservation_row.fuel_type);

  if queue_category = 'OTHER' then
    return false;
  end if;

  select *
  into daily_limit_row
  from public.daily_limits dl
  where dl.date = is_reservation_covered_by_daily_limit.target_date
    and dl.station_id is null
    and dl.status = 'OPEN'
  limit 1;

  if daily_limit_row.id is null then
    return false;
  end if;

  select *
  into category_limit_row
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = daily_limit_row.id
    and dftl.fuel_category = queue_category
  limit 1;

  if category_limit_row.id is null then
    return false;
  end if;

  with active_reservations as (
    select
      fr.id,
      fr.queue_number,
      coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters
    from public.fuel_reservations fr
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = is_reservation_covered_by_daily_limit.target_date
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
      and fr.created_at::date <= is_reservation_covered_by_daily_limit.target_date
      and public.get_fuel_queue_category(fr.fuel_type) = queue_category
  ),
  ranked as (
    select
      ar.*,
      row_number() over (order by ar.queue_number asc, ar.id asc)::integer as category_position,
      sum(ar.effective_liters) over (order by ar.queue_number asc, ar.id asc)::numeric as category_liters
    from active_reservations ar
  )
  select r.category_position, r.category_liters
  into category_position, category_liters
  from ranked r
  where r.id = reservation_row.id;

  return
    (category_limit_row.limit_mode = 'vehicle_count' and category_position <= category_limit_row.vehicle_limit)
    or (category_limit_row.limit_mode = 'fuel_liters' and category_liters <= coalesce(category_limit_row.liters_limit, 0));
end;
$$;

create or replace function public.apply_reservation_no_show_policy(
  target_date date default current_date - 1
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  grace_days integer;
  first_process_date date;
  process_date date;
  updated_count integer := 0;
  marked_count integer := 0;
  process_updated_count integer;
  process_marked_count integer;
  marked_row public.fuel_reservations%rowtype;
begin
  if target_date is null or target_date >= current_date then
    target_date := current_date - 1;
  end if;

  grace_days := public.get_reservation_no_show_grace_days();

  if grace_days <= 0 then
    return jsonb_build_object(
      'status', 'SKIPPED',
      'reason', 'NO_SHOW_GRACE_DISABLED',
      'target_date', target_date,
      'updated_count', 0,
      'marked_count', 0
    );
  end if;

  select min(greatest(fr.created_at::date, coalesce(fr.last_missed_fueling_date + 1, fr.created_at::date)))
  into first_process_date
  from public.fuel_reservations fr
  where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    and fr.created_at::date <= target_date
    and (
      fr.last_missed_fueling_date is null
      or fr.last_missed_fueling_date < target_date
    );

  if first_process_date is null then
    return jsonb_build_object(
      'status', 'SYNCED',
      'target_date', target_date,
      'updated_count', 0,
      'marked_count', 0
    );
  end if;

  create temporary table if not exists reservation_no_show_marked_ids (
    id uuid primary key
  ) on commit drop;

  for process_date in
    select generate_series(first_process_date, target_date, interval '1 day')::date
  loop
    truncate table reservation_no_show_marked_ids;

    with covered_misses as (
      select fr.id
      from public.fuel_reservations fr
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
        and fr.created_at::date <= process_date
        and (
          fr.last_missed_fueling_date is null
          or fr.last_missed_fueling_date < process_date
        )
        and not exists (
          select 1
          from public.fueling_records fueling
          where fueling.reservation_id = fr.id
            and fueling.date = process_date
        )
        and public.is_reservation_covered_by_daily_limit(fr.id, process_date)
    ),
    updated as (
      update public.fuel_reservations fr
      set missed_fueling_days = fr.missed_fueling_days + 1,
          last_missed_fueling_date = process_date
      from covered_misses cm
      where fr.id = cm.id
      returning fr.*
    ),
    marked as (
      update public.fuel_reservations fr
      set status = 'NO_SHOW',
          sync_status = 'SYNCED'
      from updated u
      where fr.id = u.id
        and u.missed_fueling_days >= grace_days
      returning fr.*
    ),
    marked_ids as (
      insert into reservation_no_show_marked_ids (id)
      select marked.id
      from marked
      on conflict (id) do nothing
      returning id
    )
    select
      (select count(*) from updated)::integer,
      (select count(*) from marked_ids)::integer
    into process_updated_count, process_marked_count;

    updated_count := updated_count + process_updated_count;
    marked_count := marked_count + process_marked_count;

    for marked_row in
      select fr.*
      from public.fuel_reservations fr
      inner join reservation_no_show_marked_ids marked_ids on marked_ids.id = fr.id
    loop
      perform public.audit_action(
        'AUTO_MARK_RESERVATION_NO_SHOW',
        'fuel_reservation',
        marked_row.id,
        null,
        to_jsonb(marked_row)
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'status', 'SYNCED',
    'target_date', target_date,
    'updated_count', updated_count,
    'marked_count', marked_count
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

grant execute on function public.get_reservation_no_show_grace_days() to authenticated;
grant execute on function public.set_reservation_no_show_grace_days(integer, uuid) to authenticated;
grant execute on function public.is_reservation_covered_by_daily_limit(uuid, date) to authenticated;
grant execute on function public.apply_reservation_no_show_policy(date) to authenticated;
