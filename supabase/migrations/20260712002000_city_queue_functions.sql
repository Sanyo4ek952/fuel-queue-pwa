set check_function_bodies = off;
set search_path = public, extensions;

create or replace function public.queue_entry_to_json(entry_row public.fuel_queue_entries)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', entry_row.id,
    'queue_entry_id', entry_row.id,
    'permanent_number', entry_row.permanent_number,
    'queue_number', entry_row.permanent_number,
    'ticket_number', entry_row.permanent_number,
    'vehicle_id', entry_row.vehicle_id,
    'driver_id', entry_row.driver_id,
    'fuel_type', entry_row.preferred_fuel_type,
    'preferred_fuel_type', entry_row.preferred_fuel_type,
    'fuel_preference_mode', entry_row.fuel_preference_mode,
    'requested_liters', entry_row.requested_liters,
    'status', entry_row.status,
    'operator_id', entry_row.operator_id,
    'comment', entry_row.comment,
    'client_mutation_id', entry_row.client_mutation_id,
    'sync_status', entry_row.sync_status,
    'created_at', entry_row.created_at,
    'updated_at', entry_row.updated_at
  );
$$;

create or replace function public.get_compatible_fuel_types(
  fuel_type text,
  fuel_preference_mode text default 'EXACT'
)
returns text[]
language sql
immutable
as $$
  select case
    when fuel_preference_mode <> 'ANY_GASOLINE' then array[fuel_type]::text[]
    when fuel_type = 'AI_92' then array['AI_92', 'AI_95', 'AI_100']::text[]
    when fuel_type = 'AI_95' then array['AI_95', 'AI_92', 'AI_100']::text[]
    when fuel_type = 'AI_100' then array['AI_100', 'AI_92', 'AI_95']::text[]
    else array[fuel_type]::text[]
  end;
$$;

create or replace function public.allocate_daily_queue(target_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  candidate record;
  picked record;
  current_daily_position integer;
  current_station_position integer;
  current_station_fuel_position integer;
  computed_arrival_at timestamptz;
  active_count integer := 0;
  paused_count integer := 0;
begin
  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('allocate_daily_queue:' || target_date::text, 0));

  create temporary table if not exists queue_allocation_capacity (
    station_id uuid,
    fuel_type text,
    vehicle_limit integer,
    liters_limit numeric,
    vehicle_used integer,
    liters_used numeric,
    start_time time,
    interval_minutes integer,
    vehicles_per_interval integer,
    allocation_order integer,
    primary key (station_id, fuel_type)
  ) on commit drop;
  truncate table queue_allocation_capacity;

  insert into queue_allocation_capacity (
    station_id, fuel_type, vehicle_limit, liters_limit, vehicle_used, liters_used,
    start_time, interval_minutes, vehicles_per_interval, allocation_order
  )
  select
    dl.station_id,
    dftl.fuel_type,
    coalesce(dftl.vehicle_limit, 0),
    dftl.liters_limit,
    0,
    0,
    dfs.start_time,
    dfs.interval_minutes,
    dfs.vehicles_per_interval,
    s.allocation_order
  from public.daily_limits dl
  join public.daily_fuel_type_limits dftl on dftl.daily_limit_id = dl.id
  join public.stations s on s.id = dl.station_id and s.is_active
  join public.daily_fueling_schedules dfs
    on dfs.date = dl.date
   and dfs.station_id = dl.station_id
   and dfs.fuel_category = public.get_fuel_queue_category(dftl.fuel_type)
  where dl.date = target_date
    and dl.status = 'OPEN'
    and dftl.status = 'OPEN'
    and dftl.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
    and coalesce(dftl.vehicle_limit, 0) > 0;

  update queue_allocation_capacity capacity
  set vehicle_used = usage.vehicle_used,
      liters_used = usage.liters_used
  from (
    select
      dqa.station_id,
      dqa.assigned_fuel_type,
      count(*)::integer as vehicle_used,
      coalesce(sum(coalesce(fr.liters, dqa.allocated_liters)), 0)::numeric as liters_used
    from public.daily_queue_allocations dqa
    left join public.fueling_records fr on fr.allocation_id = dqa.id
    where dqa.allocation_date = target_date
      and dqa.status = 'FUELED'
    group by dqa.station_id, dqa.assigned_fuel_type
  ) usage
  where capacity.station_id = usage.station_id
    and capacity.fuel_type = usage.assigned_fuel_type;

  update public.daily_queue_allocations
  set status = 'PAUSED_BY_LIMIT',
      paused_at = now(),
      paused_reason = 'LIMIT_REALLOCATION'
  where allocation_date = target_date
    and status = 'ACTIVE';

  select coalesce(max(daily_position), 0)
  into current_daily_position
  from public.daily_queue_allocations
  where allocation_date = target_date
    and status = 'FUELED';

  create temporary table if not exists queue_station_positions (
    station_id uuid,
    fuel_category text,
    station_position integer,
    station_fuel_position integer,
    primary key (station_id, fuel_category)
  ) on commit drop;
  truncate table queue_station_positions;

  insert into queue_station_positions (station_id, fuel_category, station_position, station_fuel_position)
  select
    station_id,
    public.get_fuel_queue_category(assigned_fuel_type),
    max(station_position),
    max(station_fuel_position)
  from public.daily_queue_allocations
  where allocation_date = target_date
    and status = 'FUELED'
  group by station_id, public.get_fuel_queue_category(assigned_fuel_type);

  for candidate in
    with candidates as (
      select
        fqe.*,
        case when dqa.id is not null then 0 else 1 end as priority,
        dqa.id as allocation_id
      from public.fuel_queue_entries fqe
      left join public.daily_queue_allocations dqa
        on dqa.queue_entry_id = fqe.id
       and dqa.allocation_date = target_date
       and dqa.status = 'PAUSED_BY_LIMIT'
      where fqe.status = 'WAITING'
        and not exists (
          select 1
          from public.fueling_records fr
          where fr.vehicle_id = fqe.vehicle_id
            and fr.date = target_date
            and coalesce(fr.is_manual_override, false) = false
        )
    )
    select *
    from candidates
    order by priority, permanent_number, id
  loop
    select
      capacity.*,
      compatible.ordinality
    into picked
    from unnest(public.get_compatible_fuel_types(
      candidate.preferred_fuel_type,
      candidate.fuel_preference_mode
    )) with ordinality compatible(fuel_type, ordinality)
    join queue_allocation_capacity capacity on capacity.fuel_type = compatible.fuel_type
    where capacity.vehicle_used < capacity.vehicle_limit
      and (
        capacity.liters_limit is null
        or capacity.liters_used + candidate.requested_liters <= capacity.liters_limit
      )
    order by
      compatible.ordinality,
      least(
        capacity.vehicle_limit - capacity.vehicle_used,
        case
          when capacity.liters_limit is null then capacity.vehicle_limit - capacity.vehicle_used
          else floor((capacity.liters_limit - capacity.liters_used) / candidate.requested_liters)::integer
        end
      ) desc,
      capacity.allocation_order,
      capacity.station_id
    limit 1;

    if picked.station_id is null then
      if candidate.allocation_id is not null then
        paused_count := paused_count + 1;
      end if;
      continue;
    end if;

    current_daily_position := current_daily_position + 1;

    select
      coalesce(max(station_position), 0) + 1,
      coalesce(max(station_fuel_position), 0) + 1
    into current_station_position, current_station_fuel_position
    from queue_station_positions
    where station_id = picked.station_id
      and fuel_category = public.get_fuel_queue_category(picked.fuel_type);

    insert into queue_station_positions (station_id, fuel_category, station_position, station_fuel_position)
    values (
      picked.station_id,
      public.get_fuel_queue_category(picked.fuel_type),
      current_station_position,
      current_station_fuel_position
    )
    on conflict (station_id, fuel_category) do update
    set station_position = excluded.station_position,
        station_fuel_position = excluded.station_fuel_position;

    computed_arrival_at :=
      ((target_date + picked.start_time) at time zone 'Europe/Moscow')
      + make_interval(mins => (
          floor((current_station_fuel_position - 1)::numeric / picked.vehicles_per_interval)::integer
          * picked.interval_minutes
        ));

    insert into public.daily_queue_allocations (
      allocation_date,
      queue_entry_id,
      station_id,
      assigned_fuel_type,
      allocated_liters,
      daily_position,
      station_position,
      station_fuel_position,
      arrival_at,
      status,
      call_status,
      paused_at,
      paused_reason
    )
    values (
      target_date,
      candidate.id,
      picked.station_id,
      picked.fuel_type,
      candidate.requested_liters,
      current_daily_position,
      current_station_position,
      current_station_fuel_position,
      computed_arrival_at,
      'ACTIVE',
      'NOT_CALLED',
      null,
      null
    )
    on conflict (allocation_date, queue_entry_id) do update
    set station_id = excluded.station_id,
        assigned_fuel_type = excluded.assigned_fuel_type,
        allocated_liters = excluded.allocated_liters,
        daily_position = excluded.daily_position,
        station_position = excluded.station_position,
        station_fuel_position = excluded.station_fuel_position,
        arrival_at = excluded.arrival_at,
        status = 'ACTIVE',
        paused_at = null,
        paused_reason = null;

    update queue_allocation_capacity
    set vehicle_used = vehicle_used + 1,
        liters_used = liters_used + candidate.requested_liters
    where station_id = picked.station_id
      and fuel_type = picked.fuel_type;

    active_count := active_count + 1;
    picked := null;
  end loop;

  select count(*)::integer
  into paused_count
  from public.daily_queue_allocations
  where allocation_date = target_date
    and status = 'PAUSED_BY_LIMIT';

  return jsonb_build_object(
    'date', target_date,
    'active_count', active_count,
    'paused_count', paused_count
  );
end;
$$;

drop function if exists public.create_daily_limit(date, jsonb, uuid, uuid);
create function public.create_daily_limit(
  target_date date,
  fuel_type_limits jsonb default '[]'::jsonb,
  client_mutation_id uuid default gen_random_uuid(),
  target_station_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  saved_limit public.daily_limits%rowtype;
  item jsonb;
  allocation_result jsonb;
begin
  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;
  if target_date is null then raise exception 'INVALID_DATE'; end if;
  if target_station_id is null or not exists (
    select 1 from public.stations where id = target_station_id and is_active
  ) then raise exception 'INVALID_STATION'; end if;

  insert into public.daily_limits (
    date, station_id, total_vehicle_limit, max_liters_per_vehicle,
    status, created_by, client_mutation_id
  ) values (
    target_date, target_station_id, 1, 20, 'OPEN', current_profile_id,
    coalesce(client_mutation_id, gen_random_uuid())
  )
  on conflict (date, station_id) where station_id is not null do update
  set status = 'OPEN',
      created_by = excluded.created_by,
      client_mutation_id = excluded.client_mutation_id
  returning * into saved_limit;

  for item in select value from jsonb_array_elements(coalesce(fuel_type_limits, '[]'::jsonb))
  loop
    if item->>'fuel_type' not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
      raise exception 'INVALID_FUEL_TYPE';
    end if;
    if coalesce((item->>'vehicle_limit')::integer, 0) < 0 then
      raise exception 'INVALID_VEHICLE_LIMIT';
    end if;
    if nullif(item->>'liters_limit', '')::numeric < 0 then
      raise exception 'INVALID_LITERS_LIMIT';
    end if;
    if coalesce((item->>'vehicle_limit')::integer, 0) > 0
      and coalesce(item->>'status', 'OPEN') = 'OPEN'
      and not exists (
        select 1
        from public.daily_fueling_schedules dfs
        where dfs.date = target_date
          and dfs.station_id = target_station_id
          and dfs.fuel_category = public.get_fuel_queue_category(item->>'fuel_type')
      ) then
      raise exception 'MISSING_FUELING_SCHEDULE';
    end if;

    insert into public.daily_fuel_type_limits (
      daily_limit_id, fuel_type, fuel_category, limit_mode,
      vehicle_limit, liters_limit, status
    ) values (
      saved_limit.id,
      item->>'fuel_type',
      public.get_fuel_queue_category(item->>'fuel_type'),
      'vehicle_count',
      coalesce((item->>'vehicle_limit')::integer, 0),
      nullif(item->>'liters_limit', '')::numeric,
      coalesce(item->>'status', 'OPEN')
    )
    on conflict (daily_limit_id, fuel_type) do update
    set vehicle_limit = excluded.vehicle_limit,
        liters_limit = excluded.liters_limit,
        status = excluded.status,
        fuel_category = excluded.fuel_category,
        limit_mode = excluded.limit_mode;
  end loop;

  update public.daily_limits dl
  set total_vehicle_limit = greatest(1, coalesce((
    select sum(vehicle_limit) from public.daily_fuel_type_limits where daily_limit_id = dl.id
  ), 0))
  where dl.id = saved_limit.id;

  allocation_result := public.allocate_daily_queue(target_date);

  perform public.audit_action(
    'CREATE_DAILY_LIMIT', 'daily_limit', saved_limit.id, null,
    jsonb_build_object('station_id', target_station_id, 'date', target_date, 'allocation', allocation_result)
  );

  return jsonb_build_object(
    'id', saved_limit.id,
    'date', target_date,
    'station_id', target_station_id,
    'status', saved_limit.status,
    'client_mutation_id', saved_limit.client_mutation_id,
    'allocation', allocation_result,
    'fuel_type_limits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fuel_type', fuel_type,
        'fuel_category', fuel_category,
        'vehicle_limit', vehicle_limit,
        'liters_limit', liters_limit,
        'status', status
      ) order by fuel_type)
      from public.daily_fuel_type_limits
      where daily_limit_id = saved_limit.id
    ), '[]'::jsonb)
  );
end;
$$;

drop function if exists public.get_daily_fueling_schedule(date);
create function public.get_daily_fueling_schedule(target_date date default current_date, target_station_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', dfs.id,
    'date', dfs.date,
    'station_id', dfs.station_id,
    'fuel_category', dfs.fuel_category,
    'start_time', to_char(dfs.start_time, 'HH24:MI'),
    'interval_minutes', dfs.interval_minutes,
    'vehicles_per_interval', dfs.vehicles_per_interval,
    'updated_at', dfs.updated_at,
    'client_mutation_id', dfs.client_mutation_id
  ) order by s.allocation_order, dfs.fuel_category), '[]'::jsonb)
  from public.daily_fueling_schedules dfs
  join public.stations s on s.id = dfs.station_id
  where dfs.date = target_date
    and (target_station_id is null or dfs.station_id = target_station_id);
$$;

drop function if exists public.set_daily_fueling_schedule(date, jsonb, uuid);
create function public.set_daily_fueling_schedule(
  target_date date,
  target_station_id uuid,
  schedules jsonb,
  client_mutation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  item jsonb;
begin
  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.stations where id = target_station_id and is_active) then
    raise exception 'INVALID_STATION';
  end if;
  for item in select value from jsonb_array_elements(schedules)
  loop
    insert into public.daily_fueling_schedules (
      date, station_id, fuel_category, start_time, interval_minutes,
      vehicles_per_interval, updated_by, client_mutation_id
    ) values (
      target_date,
      target_station_id,
      item->>'fuel_category',
      (item->>'start_time')::time,
      (item->>'interval_minutes')::integer,
      (item->>'vehicles_per_interval')::integer,
      current_profile_id,
      coalesce(client_mutation_id, gen_random_uuid())
    )
    on conflict (date, station_id, fuel_category) do update
    set start_time = excluded.start_time,
        interval_minutes = excluded.interval_minutes,
        vehicles_per_interval = excluded.vehicles_per_interval,
        updated_by = excluded.updated_by,
        client_mutation_id = excluded.client_mutation_id;
  end loop;
  perform public.allocate_daily_queue(target_date);
  return public.get_daily_fueling_schedule(target_date, target_station_id);
end;
$$;

drop function if exists public.create_reservation(text, text, text, text, numeric, text, text, uuid);
create function public.create_reservation(
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
  current_profile_id uuid := public.get_current_profile_id();
  normalized_plate text := public.normalize_plate_number(plate_number);
  vehicle_row public.vehicles%rowtype;
  driver_row public.drivers%rowtype;
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if current_profile_id is null
    or not public.has_role(array['mayor', 'station_manager', 'mayor_assistant']) then
    raise exception 'FORBIDDEN';
  end if;
  if normalized_plate = '' then raise exception 'INVALID_PLATE_NUMBER'; end if;
  if trim(coalesce(driver_full_name, '')) = '' then raise exception 'INVALID_DRIVER_FULL_NAME'; end if;
  if trim(coalesce(driver_phone, '')) = '' then raise exception 'INVALID_DRIVER_PHONE'; end if;
  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then raise exception 'INVALID_FUEL_TYPE'; end if;
  if fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE') then raise exception 'INVALID_FUEL_PREFERENCE_MODE'; end if;
  if fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;
  if requested_liters is null or requested_liters <= 0 then raise exception 'INVALID_REQUESTED_LITERS'; end if;

  select * into saved_entry
  from public.fuel_queue_entries
  where fuel_queue_entries.client_mutation_id = create_reservation.client_mutation_id
  limit 1;
  if saved_entry.id is not null then return public.queue_entry_to_json(saved_entry); end if;

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (normalized_plate, normalized_plate)
  on conflict (normalized_plate_number) do update set plate_number = excluded.plate_number
  returning * into vehicle_row;
  if vehicle_row.is_blocked then raise exception 'VEHICLE_BLOCKED'; end if;
  if exists (select 1 from public.fuel_queue_entries where vehicle_id = vehicle_row.id and status = 'WAITING') then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  insert into public.drivers (full_name, phone)
  values (trim(driver_full_name), trim(driver_phone))
  returning * into driver_row;

  insert into public.fuel_queue_entries (
    vehicle_id, driver_id, preferred_fuel_type, fuel_preference_mode,
    requested_liters, operator_id, comment, client_mutation_id
  ) values (
    vehicle_row.id, driver_row.id, fuel_type, fuel_preference_mode,
    requested_liters, current_profile_id, nullif(trim(coalesce(comment, '')), ''),
    coalesce(client_mutation_id, gen_random_uuid())
  ) returning * into saved_entry;

  perform public.audit_action('CREATE_QUEUE_ENTRY', 'fuel_queue_entry', saved_entry.id, null, to_jsonb(saved_entry));
  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone
  );
end;
$$;

drop function if exists public.create_consumer_reservation(uuid, text, text, text, numeric, text, text, uuid);
create function public.create_consumer_reservation(
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
  current_profile_id uuid := public.get_current_profile_id();
  driver_row public.drivers%rowtype;
  vehicle_row public.vehicles%rowtype;
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if current_profile_id is null or public.get_current_user_role() <> 'consumer' then raise exception 'FORBIDDEN'; end if;
  if not exists (
    select 1 from public.profile_vehicles pv
    where pv.profile_id = current_profile_id and pv.vehicle_id = create_consumer_reservation.vehicle_id
  ) then raise exception 'VEHICLE_NOT_OWNED'; end if;
  select * into vehicle_row from public.vehicles where id = create_consumer_reservation.vehicle_id;
  if vehicle_row.id is null or vehicle_row.is_blocked then raise exception 'VEHICLE_BLOCKED'; end if;
  if exists (select 1 from public.fuel_queue_entries where vehicle_id = vehicle_row.id and status = 'WAITING') then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;
  if trim(coalesce(driver_full_name, '')) = '' or trim(coalesce(driver_phone, '')) = '' then
    raise exception 'INVALID_DRIVER';
  end if;
  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then raise exception 'INVALID_FUEL_TYPE'; end if;
  if fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE')
    or (fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100')) then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;
  if requested_liters is null or requested_liters <= 0 then raise exception 'INVALID_REQUESTED_LITERS'; end if;

  select * into saved_entry from public.fuel_queue_entries
  where fuel_queue_entries.client_mutation_id = create_consumer_reservation.client_mutation_id limit 1;
  if saved_entry.id is not null then return public.queue_entry_to_json(saved_entry); end if;

  insert into public.drivers (full_name, phone)
  values (trim(driver_full_name), trim(driver_phone)) returning * into driver_row;
  insert into public.fuel_queue_entries (
    vehicle_id, driver_id, preferred_fuel_type, fuel_preference_mode,
    requested_liters, operator_id, comment, client_mutation_id
  ) values (
    vehicle_row.id, driver_row.id, fuel_type, fuel_preference_mode,
    requested_liters, current_profile_id, nullif(trim(coalesce(comment, '')), ''),
    coalesce(client_mutation_id, gen_random_uuid())
  ) returning * into saved_entry;
  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone
  );
end;
$$;

create or replace function public.get_today_call_list(
  target_date date default current_date,
  page_size integer default 25,
  cursor_queue_number integer default null,
  cursor_id uuid default null,
  plate_search text default null,
  created_by_profile_id uuid default null,
  call_filter text default 'all',
  gasoline_fuel_filter text default 'all',
  fuel_category_filter text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_search text := public.normalize_plate_number(plate_search);
  effective_size integer := least(greatest(coalesce(page_size, 25), 1), 100);
begin
  if public.get_current_profile_id() is null then raise exception 'FORBIDDEN'; end if;
  return (
    with base as (
      select
        dqa.id,
        dqa.id as allocation_id,
        fqe.id as queue_entry_id,
        fqe.permanent_number,
        fqe.permanent_number as queue_number,
        fqe.permanent_number as ticket_number,
        dqa.allocation_date as date,
        dqa.station_id,
        s.name as station_name,
        s.address as station_address,
        fqe.vehicle_id,
        fqe.driver_id,
        fqe.operator_id,
        fqe.preferred_fuel_type as fuel_type,
        fqe.preferred_fuel_type,
        fqe.fuel_preference_mode,
        fqe.requested_liters,
        dqa.assigned_fuel_type,
        dqa.assigned_fuel_type as matched_fuel_type,
        dqa.daily_position,
        dqa.daily_position as current_position,
        greatest(dqa.daily_position - 1, 0) as people_ahead,
        dqa.station_position,
        dqa.station_fuel_position,
        dqa.arrival_at,
        dqa.status as allocation_status,
        fqe.status,
        fqe.sync_status,
        fqe.comment,
        fqe.client_mutation_id,
        dqa.status = 'ACTIVE' as is_within_today_limit,
        dqa.status = 'ACTIVE' as is_callable_now,
        case when dqa.status = 'PAUSED_BY_LIMIT' then 'PAUSED_BY_LIMIT' else null end as call_unavailable_reason,
        dqa.call_status as latest_call_status,
        v.normalized_plate_number,
        d.full_name as driver_full_name,
        d.phone as driver_phone,
        op.full_name as created_by_full_name,
        op.role as created_by_role,
        op.signature_name as created_by_signature_name,
        dqa.updated_at
      from public.daily_queue_allocations dqa
      join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
      join public.vehicles v on v.id = fqe.vehicle_id
      left join public.drivers d on d.id = fqe.driver_id
      left join public.profiles op on op.id = fqe.operator_id
      join public.stations s on s.id = dqa.station_id
      where dqa.allocation_date = target_date
        and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED')
        and public.can_access_station(dqa.station_id)
    ),
    filtered as (
      select * from base
      where (normalized_search = '' or normalized_plate_number ilike '%' || normalized_search || '%')
        and (created_by_profile_id is null or operator_id = created_by_profile_id)
        and (gasoline_fuel_filter = 'all' or assigned_fuel_type = gasoline_fuel_filter)
        and (fuel_category_filter is null or public.get_fuel_queue_category(assigned_fuel_type) = fuel_category_filter)
        and (
          call_filter = 'all'
          or (call_filter = 'call' and allocation_status = 'ACTIVE' and latest_call_status <> 'CONTACTED')
          or (call_filter = 'contacted' and latest_call_status = 'CONTACTED')
          or (call_filter = 'no_answer' and latest_call_status = 'NO_ANSWER')
        )
        and (
          cursor_queue_number is null or cursor_id is null
          or (daily_position, id) > (cursor_queue_number, cursor_id)
        )
      order by daily_position, id
      limit effective_size + 1
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(row_value) order by daily_position, id)
        from (select * from filtered limit effective_size) row_value), '[]'::jsonb),
      'next_cursor', case when (select count(*) from filtered) > effective_size then (
        select jsonb_build_object('queue_number', daily_position, 'id', id)
        from filtered order by daily_position, id offset effective_size - 1 limit 1
      ) else null end,
      'summary', jsonb_build_object(
        'total_count', (select count(*) from base),
        'callable_count', (select count(*) from base where allocation_status = 'ACTIVE' and latest_call_status <> 'CONTACTED'),
        'contacted_count', (select count(*) from base where latest_call_status = 'CONTACTED'),
        'no_answer_count', (select count(*) from base where latest_call_status = 'NO_ANSWER'),
        'category_counts', jsonb_build_object(
          'GASOLINE', (select count(*) from base where public.get_fuel_queue_category(assigned_fuel_type) = 'GASOLINE'),
          'DIESEL', (select count(*) from base where public.get_fuel_queue_category(assigned_fuel_type) = 'DIESEL'),
          'GAS', (select count(*) from base where public.get_fuel_queue_category(assigned_fuel_type) = 'GAS')
        ),
        'callable_category_counts', jsonb_build_object(
          'GASOLINE', (select count(*) from base where allocation_status = 'ACTIVE' and public.get_fuel_queue_category(assigned_fuel_type) = 'GASOLINE'),
          'DIESEL', (select count(*) from base where allocation_status = 'ACTIVE' and public.get_fuel_queue_category(assigned_fuel_type) = 'DIESEL'),
          'GAS', (select count(*) from base where allocation_status = 'ACTIVE' and public.get_fuel_queue_category(assigned_fuel_type) = 'GAS')
        )
      )
    )
  );
end;
$$;

create or replace function public.get_today_queue_authors(
  target_date date default current_date,
  plate_search text default null,
  call_filter text default 'all',
  gasoline_fuel_filter text default 'all'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id,
    'display_name', p.full_name,
    'role', p.role,
    'signature_name', p.signature_name
  ) order by p.full_name), '[]'::jsonb)
  from public.profiles p
  where exists (
    select 1
    from public.daily_queue_allocations dqa
    join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
    join public.vehicles v on v.id = fqe.vehicle_id
    where dqa.allocation_date = target_date
      and fqe.operator_id = p.id
      and (public.normalize_plate_number(plate_search) = '' or v.normalized_plate_number ilike '%' || public.normalize_plate_number(plate_search) || '%')
      and (gasoline_fuel_filter = 'all' or dqa.assigned_fuel_type = gasoline_fuel_filter)
      and (call_filter = 'all' or call_filter = 'call' and dqa.status = 'ACTIVE' or dqa.call_status = upper(call_filter))
  );
$$;

create or replace function public.create_reservation_call_log(
  reservation_id uuid,
  status text,
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
  current_profile_id uuid := public.get_current_profile_id();
  saved_log public.daily_queue_allocation_call_logs%rowtype;
  caller public.profiles%rowtype;
begin
  if current_profile_id is null then raise exception 'FORBIDDEN'; end if;
  if status not in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER') then raise exception 'INVALID_CALL_STATUS'; end if;
  if not exists (
    select 1 from public.daily_queue_allocations
    where id = reservation_id and status = 'ACTIVE' and public.can_access_station(station_id)
  ) then raise exception 'ALLOCATION_NOT_ACTIVE'; end if;

  select * into saved_log from public.daily_queue_allocation_call_logs
  where daily_queue_allocation_call_logs.client_mutation_id = create_reservation_call_log.client_mutation_id
  limit 1;
  if saved_log.id is null then
    insert into public.daily_queue_allocation_call_logs (
      allocation_id, status, called_by, comment, client_mutation_id
    ) values (
      reservation_id, status, current_profile_id,
      nullif(trim(coalesce(comment, '')), ''), coalesce(client_mutation_id, gen_random_uuid())
    ) returning * into saved_log;
    update public.daily_queue_allocations
    set call_status = status
    where id = reservation_id;
  end if;
  select * into caller from public.profiles where id = saved_log.called_by;
  return jsonb_build_object(
    'id', saved_log.id,
    'allocation_id', saved_log.allocation_id,
    'reservation_id', saved_log.allocation_id,
    'status', saved_log.status,
    'called_by_profile_id', saved_log.called_by,
    'called_by_full_name', caller.full_name,
    'called_by_role', caller.role,
    'called_by_signature_name', caller.signature_name,
    'called_at', saved_log.called_at,
    'comment', saved_log.comment,
    'client_mutation_id', saved_log.client_mutation_id,
    'sync_status', saved_log.sync_status
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
  normalized_plate text := public.normalize_plate_number(plate_number);
  vehicle_row public.vehicles%rowtype;
  allocation_row record;
begin
  if public.get_current_profile_id() is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'PROFILE_NOT_FOUND', 'normalized_plate_number', normalized_plate);
  end if;
  if not public.can_access_station(station_id) then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'STATION_ACCESS_DENIED', 'normalized_plate_number', normalized_plate);
  end if;
  select * into vehicle_row from public.vehicles where normalized_plate_number = normalized_plate limit 1;
  if vehicle_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate);
  end if;
  if vehicle_row.is_blocked then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'VEHICLE_BLOCKED', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'block_reason', vehicle_row.block_reason);
  end if;
  if exists (
    select 1 from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id and fr.date = check_date and coalesce(fr.is_manual_override, false) = false
  ) then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'ALREADY_FUELED', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id);
  end if;

  select
    dqa.*,
    fqe.permanent_number,
    fqe.preferred_fuel_type,
    fqe.fuel_preference_mode,
    fqe.requested_liters
  into allocation_row
  from public.daily_queue_allocations dqa
  join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
  where fqe.vehicle_id = vehicle_row.id
    and dqa.allocation_date = check_date
  limit 1;

  if allocation_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id);
  end if;
  if allocation_row.status <> 'ACTIVE' or allocation_row.station_id <> check_vehicle_access.station_id then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'OUTSIDE_TODAY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'allocation_id', allocation_row.id,
      'reservation_id', allocation_row.id,
      'reservation_station_id', allocation_row.station_id,
      'queue_entry_id', allocation_row.queue_entry_id,
      'queue_number', allocation_row.permanent_number,
      'matched_fuel_type', allocation_row.assigned_fuel_type,
      'is_within_today_limit', false
    );
  end if;
  return jsonb_build_object(
    'status', 'ALLOWED',
    'reason', 'ACTIVE_RESERVATION',
    'normalized_plate_number', normalized_plate,
    'date', check_date,
    'station_id', station_id,
    'vehicle_id', vehicle_row.id,
    'allocation_id', allocation_row.id,
    'reservation_id', allocation_row.id,
    'queue_entry_id', allocation_row.queue_entry_id,
    'queue_number', allocation_row.permanent_number,
    'fuel_type', allocation_row.preferred_fuel_type,
    'preferred_fuel_type', allocation_row.preferred_fuel_type,
    'fuel_preference_mode', allocation_row.fuel_preference_mode,
    'matched_fuel_type', allocation_row.assigned_fuel_type,
    'requested_liters', allocation_row.requested_liters,
    'effective_liters', allocation_row.allocated_liters,
    'category_position', allocation_row.station_fuel_position,
    'is_within_today_limit', true,
    'is_callable_now', true,
    'arrival_at', allocation_row.arrival_at,
    'call_status', allocation_row.call_status
  );
end;
$$;

create or replace function public.create_fueling_record_for_allocation(
  allocation_id uuid,
  liters numeric,
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
  current_profile_id uuid := public.get_current_profile_id();
  allocation_row record;
  saved_record public.fueling_records%rowtype;
begin
  if current_profile_id is null or not public.has_role(array['mayor', 'station_manager', 'cashier']) then
    raise exception 'FORBIDDEN';
  end if;
  if liters is null or liters <= 0 then raise exception 'INVALID_LITERS'; end if;
  select dqa.*, fqe.vehicle_id, fqe.driver_id
  into allocation_row
  from public.daily_queue_allocations dqa
  join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
  where dqa.id = allocation_id
  for update;
  if allocation_row.id is null or allocation_row.status <> 'ACTIVE' then raise exception 'ALLOCATION_NOT_ACTIVE'; end if;
  if not public.can_access_station(allocation_row.station_id) then raise exception 'STATION_ACCESS_DENIED'; end if;
  if liters > allocation_row.allocated_liters then raise exception 'LITERS_LIMIT_EXCEEDED'; end if;
  if exists (
    select 1 from public.fueling_records fr
    where fr.vehicle_id = allocation_row.vehicle_id
      and fr.date = allocation_row.allocation_date
      and coalesce(fr.is_manual_override, false) = false
  ) then raise exception 'ALREADY_FUELED'; end if;

  select * into saved_record from public.fueling_records
  where fueling_records.client_mutation_id = create_fueling_record_for_allocation.client_mutation_id limit 1;
  if saved_record.id is null then
    insert into public.fueling_records (
      date, station_id, vehicle_id, driver_id, allocation_id, queue_entry_id,
      fuel_type, liters, cashier_id, is_manual_override, comment,
      client_mutation_id, sync_status, fueled_at
    ) values (
      allocation_row.allocation_date, allocation_row.station_id, allocation_row.vehicle_id,
      allocation_row.driver_id, allocation_row.id, allocation_row.queue_entry_id,
      allocation_row.assigned_fuel_type, liters, current_profile_id, false,
      nullif(trim(coalesce(comment, '')), ''), coalesce(client_mutation_id, gen_random_uuid()),
      'SYNCED', coalesce(fueled_at, now())
    ) returning * into saved_record;
    update public.daily_queue_allocations
    set status = 'FUELED', fueled_at = saved_record.fueled_at, finalized_at = now()
    where id = allocation_row.id;
    update public.fuel_queue_entries set status = 'FUELED' where id = allocation_row.queue_entry_id;
    perform public.allocate_daily_queue(allocation_row.allocation_date);
  end if;
  return jsonb_build_object(
    'id', saved_record.id,
    'date', saved_record.date,
    'station_id', saved_record.station_id,
    'vehicle_id', saved_record.vehicle_id,
    'driver_id', saved_record.driver_id,
    'allocation_id', saved_record.allocation_id,
    'reservation_id', saved_record.queue_entry_id,
    'queue_entry_id', saved_record.queue_entry_id,
    'preferential_queue_entry_id', null,
    'fuel_type', saved_record.fuel_type,
    'liters', saved_record.liters,
    'is_manual_override', saved_record.is_manual_override,
    'override_id', saved_record.override_id,
    'comment', saved_record.comment,
    'client_mutation_id', saved_record.client_mutation_id,
    'sync_status', saved_record.sync_status,
    'fueled_at', saved_record.fueled_at
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
  current_profile_id uuid := public.get_current_profile_id();
begin
  if current_profile_id is null then raise exception 'FORBIDDEN'; end if;
  return (
    select public.queue_entry_to_json(fqe) || jsonb_build_object(
      'normalized_plate_number', v.normalized_plate_number,
      'driver_full_name', d.full_name,
      'driver_phone', d.phone,
      'allocation', case when dqa.id is null then null else jsonb_build_object(
        'id', dqa.id,
        'date', dqa.allocation_date,
        'station_id', dqa.station_id,
        'station_name', s.name,
        'station_address', s.address,
        'assigned_fuel_type', dqa.assigned_fuel_type,
        'daily_position', dqa.daily_position,
        'station_position', dqa.station_position,
        'station_fuel_position', dqa.station_fuel_position,
        'arrival_at', dqa.arrival_at,
        'status', dqa.status,
        'call_status', dqa.call_status
      ) end,
      'date', dqa.allocation_date,
      'station_id', dqa.station_id,
      'station_name', s.name,
      'station_address', s.address,
      'current_position', dqa.daily_position,
      'people_ahead', case when dqa.daily_position is null then null else greatest(dqa.daily_position - 1, 0) end,
      'matched_fuel_type', dqa.assigned_fuel_type,
      'is_within_today_limit', dqa.status = 'ACTIVE',
      'is_callable_now', dqa.status = 'ACTIVE'
      ,'is_fuel_preference_update_locked', dqa.id is not null and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT')
    )
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id and pv.profile_id = current_profile_id
    join public.vehicles v on v.id = fqe.vehicle_id
    left join public.drivers d on d.id = fqe.driver_id
    left join public.daily_queue_allocations dqa
      on dqa.queue_entry_id = fqe.id
     and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
    left join public.stations s on s.id = dqa.station_id
    where fqe.status = 'WAITING'
    order by fqe.permanent_number
    limit 1
  );
end;
$$;

create or replace function public.check_public_queue_position(plate_number text, phone_last4 text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  normalized_plate text := public.normalize_plate_number(plate_number);
  matched record;
begin
  if regexp_replace(coalesce(phone_last4, ''), '\D', '', 'g') !~ '^[0-9]{4}$' then
    return jsonb_build_object('status', 'INVALID_INPUT', 'public_status', 'INVALID_INPUT', 'remaining_attempts', 10);
  end if;
  select fqe.*, dqa.id as allocation_id, dqa.daily_position, dqa.station_position,
    dqa.arrival_at, dqa.status as allocation_status, dqa.assigned_fuel_type, dqa.call_status
  into matched
  from public.fuel_queue_entries fqe
  join public.vehicles v on v.id = fqe.vehicle_id
  left join public.drivers d on d.id = fqe.driver_id
  left join public.daily_queue_allocations dqa
    on dqa.queue_entry_id = fqe.id
   and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
  where v.normalized_plate_number = normalized_plate
    and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 4) = regexp_replace(phone_last4, '\D', '', 'g')
  order by fqe.permanent_number desc
  limit 1;
  if matched.id is null then
    return jsonb_build_object('status', 'NOT_FOUND', 'public_status', 'NOT_FOUND', 'remaining_attempts', 10);
  end if;
  return jsonb_build_object(
    'status', 'FOUND',
    'queue_number', matched.permanent_number,
    'ticket_number', matched.permanent_number,
    'permanent_number', matched.permanent_number,
    'current_position', matched.daily_position,
    'people_ahead', case when matched.daily_position is null then null else greatest(matched.daily_position - 1, 0) end,
    'preferred_fuel_type', matched.preferred_fuel_type,
    'fuel_preference_mode', matched.fuel_preference_mode,
    'allocation_status', matched.allocation_status,
    'arrival_at', matched.arrival_at,
    'public_status', case
      when matched.status <> 'WAITING' then 'COMPLETED_OR_CANCELLED'
      when matched.allocation_id is null then 'QUEUE_NOT_READY'
      when matched.allocation_status = 'PAUSED_BY_LIMIT' then 'PAUSED_BY_LIMIT'
      when matched.allocation_status = 'ACTIVE' then 'IN_CALL_LIST'
      else 'QUEUE_NOT_READY'
    end,
    'is_within_today_limit', matched.allocation_status = 'ACTIVE',
    'is_callable_now', matched.allocation_status = 'ACTIVE',
    'matched_fuel_type', matched.assigned_fuel_type,
    'remaining_attempts', 10
  );
end;
$$;

create or replace function public.finalize_daily_queue(target_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  missed_count integer;
  expired_count integer;
  grace_days integer := public.get_reservation_no_show_grace_days();
begin
  if target_date is null then raise exception 'INVALID_DATE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finalize_daily_queue:' || target_date::text, 0));
  with marked as (
    update public.daily_queue_allocations dqa
    set status = 'MISSED', missed_at = now(), finalized_at = now()
    where dqa.allocation_date = target_date
      and dqa.status = 'ACTIVE'
      and dqa.call_status in ('CONTACTED', 'NO_ANSWER')
      and not exists (select 1 from public.fueling_records fr where fr.allocation_id = dqa.id)
    returning queue_entry_id
  ) select count(*)::integer into missed_count from marked;

  with marked as (
    update public.daily_queue_allocations dqa
    set status = 'EXPIRED', finalized_at = now()
    where dqa.allocation_date = target_date
      and dqa.status = 'ACTIVE'
      and dqa.call_status = 'NOT_CALLED'
      and not exists (select 1 from public.fueling_records fr where fr.allocation_id = dqa.id)
    returning queue_entry_id
  ) select count(*)::integer into expired_count from marked;

  if grace_days > 0 then
    update public.fuel_queue_entries fqe
    set status = 'NO_SHOW'
    where fqe.status = 'WAITING'
      and (select count(*) from public.daily_queue_allocations dqa where dqa.queue_entry_id = fqe.id and dqa.status = 'MISSED') >= grace_days;
  end if;
  return jsonb_build_object('date', target_date, 'missed_count', missed_count, 'expired_count', expired_count);
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
declare
  result jsonb;
begin
  if public.get_current_profile_id() is null then raise exception 'FORBIDDEN'; end if;
  begin
    case operation_type
      when 'CREATE_RESERVATION' then
        result := public.create_reservation(
          payload->>'plate_number', payload->>'driver_full_name', payload->>'driver_phone',
          payload->>'fuel_type', (payload->>'requested_liters')::numeric,
          coalesce(payload->>'fuel_preference_mode', 'EXACT'), payload->>'comment', client_mutation_id
        );
      when 'CREATE_ALLOCATION_CALL_LOG' then
        result := public.create_reservation_call_log(
          coalesce((payload->>'allocation_id')::uuid, (payload->>'reservation_id')::uuid),
          payload->>'status', payload->>'comment', client_mutation_id
        );
      when 'CREATE_FUELING_RECORD' then
        result := public.create_fueling_record_for_allocation(
          (payload->>'allocation_id')::uuid,
          (payload->>'liters')::numeric,
          coalesce((payload->>'fueled_at')::timestamptz, now()),
          payload->>'comment', client_mutation_id
        );
      else
        raise exception 'UNSUPPORTED_OPERATION';
    end case;
    return jsonb_build_object(
      'status', 'SYNCED', 'operation_type', operation_type,
      'client_mutation_id', client_mutation_id, 'data', result
    );
  exception when others then
    return jsonb_build_object(
      'status', 'CONFLICT', 'operation_type', operation_type,
      'client_mutation_id', client_mutation_id, 'reason', sqlerrm, 'payload', payload
    );
  end;
end;
$$;

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
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if public.get_current_profile_id() is null then raise exception 'FORBIDDEN'; end if;
  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then raise exception 'INVALID_FUEL_TYPE'; end if;
  if fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE')
    or (fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100')) then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;
  if exists (
    select 1 from public.daily_queue_allocations
    where queue_entry_id = reservation_id and status in ('ACTIVE', 'PAUSED_BY_LIMIT')
  ) then raise exception 'FUEL_PREFERENCE_LOCKED_BY_ALLOCATION'; end if;
  update public.fuel_queue_entries
  set preferred_fuel_type = fuel_type,
      fuel_preference_mode = update_reservation_fuel_preference.fuel_preference_mode
  where id = reservation_id and status = 'WAITING'
  returning * into saved_entry;
  if saved_entry.id is null then raise exception 'QUEUE_ENTRY_NOT_WAITING'; end if;
  return public.queue_entry_to_json(saved_entry);
end;
$$;

create or replace function public.cancel_reservation(
  reservation_id uuid,
  reason text,
  comment text default null,
  client_mutation_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if current_profile_id is null then raise exception 'FORBIDDEN'; end if;
  update public.fuel_queue_entries
  set status = 'CANCELLED',
      cancelled_by = current_profile_id,
      cancelled_at = now(),
      cancel_reason = reason,
      cancel_comment = nullif(trim(coalesce(comment, '')), '')
  where id = reservation_id and status = 'WAITING'
  returning * into saved_entry;
  if saved_entry.id is null then raise exception 'QUEUE_ENTRY_NOT_WAITING'; end if;
  update public.daily_queue_allocations
  set status = 'EXPIRED', finalized_at = now()
  where queue_entry_id = saved_entry.id and status in ('ACTIVE', 'PAUSED_BY_LIMIT');
  perform public.allocate_daily_queue((now() at time zone 'Europe/Moscow')::date);
  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'cancelled_by', saved_entry.cancelled_by,
    'cancelled_at', saved_entry.cancelled_at,
    'cancel_reason', saved_entry.cancel_reason,
    'cancel_comment', saved_entry.cancel_comment
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
begin
  if not exists (
    select 1
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id
    where fqe.id = reservation_id and pv.profile_id = public.get_current_profile_id()
  ) then raise exception 'FORBIDDEN'; end if;
  return public.cancel_reservation(reservation_id, 'CONSUMER_CANCELLED', null, client_mutation_id);
end;
$$;

create or replace function public.get_daily_limit_overview(target_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with limit_rows as (
    select
      dl.id,
      dl.date,
      dl.station_id,
      dl.status as limit_status,
      dl.updated_at,
      s.name as station_name,
      s.address as station_address,
      dftl.fuel_type,
      dftl.fuel_category,
      dftl.vehicle_limit,
      dftl.liters_limit,
      dftl.status as fuel_status
    from public.daily_limits dl
    join public.stations s on s.id = dl.station_id
    join public.daily_fuel_type_limits dftl on dftl.daily_limit_id = dl.id
    where dl.date = target_date and dl.station_id is not null
  ),
  allocation_usage as (
    select
      dqa.station_id,
      dqa.assigned_fuel_type as fuel_type,
      count(*) filter (where dqa.status in ('ACTIVE', 'FUELED'))::integer as vehicle_count,
      coalesce(sum(coalesce(fr.liters, dqa.allocated_liters)) filter (where dqa.status in ('ACTIVE', 'FUELED')), 0)::numeric as liters_count,
      max(fqe.permanent_number) filter (where dqa.status in ('ACTIVE', 'FUELED')) as projected_number
    from public.daily_queue_allocations dqa
    join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
    left join public.fueling_records fr on fr.allocation_id = dqa.id
    where dqa.allocation_date = target_date
    group by dqa.station_id, dqa.assigned_fuel_type
  ),
  enriched as (
    select
      lr.*,
      coalesce(au.vehicle_count, 0) as used_vehicles,
      coalesce(au.liters_count, 0) as used_liters,
      au.projected_number
    from limit_rows lr
    left join allocation_usage au
      on au.station_id = lr.station_id and au.fuel_type = lr.fuel_type
  ),
  station_json as (
    select
      id,
      station_id,
      jsonb_build_object(
        'exists', true,
        'id', id,
        'date', target_date,
        'station_id', station_id,
        'station_name', max(station_name),
        'station_address', max(station_address),
        'status', max(limit_status),
        'updated_at', max(updated_at),
        'category_overviews', jsonb_agg(jsonb_build_object(
          'fuel_type', fuel_type,
          'fuel_category', fuel_category,
          'label', fuel_type,
          'limit_mode', 'vehicle_count',
          'vehicle_limit', vehicle_limit,
          'liters_limit', liters_limit,
          'queue_count', used_vehicles,
          'queued_liters', used_liters,
          'covered_vehicle_count', used_vehicles,
          'covered_liters', used_liters,
          'remaining_vehicle_count', greatest(vehicle_limit - used_vehicles, 0),
          'remaining_liters', case when liters_limit is null then null else greatest(liters_limit - used_liters, 0) end,
          'projected_queue_number', projected_number,
          'status', fuel_status
        ) order by fuel_type)
      ) as value
    from enriched
    group by id, station_id
  ),
  global_category_rows as (
    select jsonb_build_object(
      'fuel_type', fuel_type,
      'fuel_category', max(fuel_category),
      'label', fuel_type,
      'limit_mode', 'vehicle_count',
      'vehicle_limit', sum(vehicle_limit),
      'liters_limit', case when count(liters_limit) = 0 then null else sum(liters_limit) end,
      'queue_count', sum(used_vehicles),
      'queued_liters', sum(used_liters),
      'covered_vehicle_count', sum(used_vehicles),
      'covered_liters', sum(used_liters),
      'remaining_vehicle_count', greatest(sum(vehicle_limit) - sum(used_vehicles), 0),
      'remaining_liters', case when count(liters_limit) = 0 then null else greatest(sum(liters_limit) - sum(used_liters), 0) end,
      'projected_queue_number', max(projected_number)
    ) as value,
    fuel_type
    from enriched
    group by fuel_type
  ),
  global_categories as (
    select jsonb_agg(value order by fuel_type) as value
    from global_category_rows
  )
  select jsonb_build_object(
    'exists', exists(select 1 from limit_rows),
    'id', null,
    'date', target_date,
    'station_id', null,
    'station_name', 'Все АЗС',
    'station_address', null,
    'status', case when exists(select 1 from limit_rows where limit_status = 'OPEN') then 'OPEN' else null end,
    'category_overviews', coalesce((select value from global_categories), '[]'::jsonb),
    'station_overviews', coalesce((select jsonb_agg(value order by station_id) from station_json), '[]'::jsonb),
    'updated_at', (select max(updated_at) from limit_rows)
  );
$$;

drop function if exists public.get_reservation_limit_station_assignments(date);

create or replace function public.export_queue_backup(target_date date default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'queue_entry_id', fqe.id,
    'permanent_number', fqe.permanent_number,
    'queue_number', fqe.permanent_number,
    'ticket_number', fqe.permanent_number,
    'normalized_plate_number', v.normalized_plate_number,
    'driver_full_name', d.full_name,
    'driver_phone', d.phone,
    'preferred_fuel_type', fqe.preferred_fuel_type,
    'fuel_preference_mode', fqe.fuel_preference_mode,
    'requested_liters', fqe.requested_liters,
    'queue_status', fqe.status,
    'allocation_id', dqa.id,
    'date', dqa.allocation_date,
    'station_id', dqa.station_id,
    'station_name', s.name,
    'assigned_fuel_type', dqa.assigned_fuel_type,
    'daily_position', dqa.daily_position,
    'station_position', dqa.station_position,
    'station_fuel_position', dqa.station_fuel_position,
    'arrival_at', dqa.arrival_at,
    'allocation_status', dqa.status,
    'latest_call_status', dqa.call_status,
    'created_at', fqe.created_at,
    'updated_at', greatest(fqe.updated_at, dqa.updated_at)
  ) order by fqe.permanent_number, dqa.allocation_date), '[]'::jsonb)
  from public.fuel_queue_entries fqe
  join public.vehicles v on v.id = fqe.vehicle_id
  left join public.drivers d on d.id = fqe.driver_id
  left join public.daily_queue_allocations dqa
    on dqa.queue_entry_id = fqe.id
   and (target_date is null or dqa.allocation_date = target_date)
  left join public.stations s on s.id = dqa.station_id
  where target_date is null or dqa.id is not null;
$$;
