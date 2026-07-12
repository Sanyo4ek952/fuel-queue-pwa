alter table public.daily_fuel_type_limits
  add column if not exists liters_used_baseline numeric not null default 0;

CREATE OR REPLACE FUNCTION public.create_daily_limit(
  target_date date,
  fuel_type_limits jsonb DEFAULT '[]'::jsonb,
  client_mutation_id uuid DEFAULT gen_random_uuid(),
  target_station_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_daily_limit.client_mutation_id, gen_random_uuid());
  existing_limit_row public.daily_limits%rowtype;
  saved_limit_row public.daily_limits%rowtype;
  existing_fuel_type_limit_row public.daily_fuel_type_limits%rowtype;
  item jsonb;
  item_fuel_type text;
  item_status text;
  item_liters_limit numeric;
  effective_liters_used_baseline numeric;
  fuel_type_rows jsonb;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if target_station_id is null or not exists (
    select 1
    from public.stations s
    where s.id = target_station_id
      and s.is_active
  ) then
    raise exception 'INVALID_STATION';
  end if;

  if jsonb_typeof(coalesce(fuel_type_limits, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_FUEL_TYPE_LIMITS';
  end if;

  select *
  into existing_limit_row
  from public.daily_limits dl
  where dl.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_limit_row.id is not null
    and (
      existing_limit_row.date is distinct from target_date
      or existing_limit_row.station_id is distinct from target_station_id
    ) then
    raise exception 'IDEMPOTENCY_KEY_REUSED';
  end if;

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
      0,
      20,
      'OPEN',
      current_profile_id,
      effective_client_mutation_id
    )
    on conflict (date, station_id) where station_id is not null do update
    set status = 'OPEN',
        created_by = excluded.created_by,
        client_mutation_id = excluded.client_mutation_id
    returning * into saved_limit_row;
  else
    saved_limit_row := existing_limit_row;
  end if;

  for item in
    select value
    from jsonb_array_elements(coalesce(fuel_type_limits, '[]'::jsonb))
  loop
    item_fuel_type := item->>'fuel_type';
    item_status := item->>'status';
    item_liters_limit := nullif(item->>'liters_limit', '')::numeric;
    effective_liters_used_baseline := 0;

    if item_fuel_type is null
      or item_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
      raise exception 'INVALID_FUEL_TYPE';
    end if;

    if item_status is null or item_status not in ('OPEN', 'PAUSED') then
      raise exception 'INVALID_FUEL_STATUS';
    end if;

    if item_liters_limit is not null and item_liters_limit < 0 then
      raise exception 'INVALID_LITERS_LIMIT';
    end if;

    if item_status = 'OPEN' and coalesce(item_liters_limit, 0) <= 0 then
      raise exception 'INVALID_LITERS_LIMIT';
    end if;

    select *
    into existing_fuel_type_limit_row
    from public.daily_fuel_type_limits dftl
    where dftl.daily_limit_id = saved_limit_row.id
      and dftl.fuel_type = item_fuel_type
    limit 1;

    if existing_fuel_type_limit_row.id is not null
      and existing_fuel_type_limit_row.status = 'PAUSED'
      and item_status = 'OPEN'
      and item_liters_limit is not null
      and item_liters_limit > 0 then
      select coalesce(sum(fr.liters), 0)::numeric
      into effective_liters_used_baseline
      from public.fueling_records fr
      where fr.date = target_date
        and fr.station_id = target_station_id
        and fr.fuel_type = item_fuel_type
        and coalesce(fr.is_manual_override, false) = false
        and fr.preferential_queue_entry_id is null;
    end if;

    insert into public.daily_fuel_type_limits (
      daily_limit_id,
      fuel_type,
      fuel_category,
      limit_mode,
      status,
      vehicle_limit,
      liters_limit,
      liters_used_baseline
    )
    values (
      saved_limit_row.id,
      item_fuel_type,
      public.get_fuel_queue_category(item_fuel_type),
      'fuel_liters',
      item_status,
      0,
      item_liters_limit,
      effective_liters_used_baseline
    )
    on conflict (daily_limit_id, fuel_type) do update
    set fuel_category = excluded.fuel_category,
        limit_mode = excluded.limit_mode,
        status = excluded.status,
        vehicle_limit = excluded.vehicle_limit,
        liters_limit = excluded.liters_limit,
        liters_used_baseline = excluded.liters_used_baseline;
  end loop;

  update public.daily_limits
  set total_vehicle_limit = 0,
      max_liters_per_vehicle = 20
  where id = saved_limit_row.id
  returning * into saved_limit_row;

  insert into public.daily_fueling_schedules (
    date,
    station_id,
    fuel_category,
    start_time,
    interval_minutes,
    vehicles_per_interval,
    updated_by,
    client_mutation_id
  )
  select distinct
    target_date,
    target_station_id,
    dftl.fuel_category,
    time '13:00',
    5,
    5,
    current_profile_id,
    gen_random_uuid()
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = saved_limit_row.id
    and dftl.status = 'OPEN'
    and dftl.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
    and dftl.fuel_category in ('GASOLINE', 'DIESEL', 'GAS')
  on conflict (date, station_id, fuel_category) do nothing;

  perform public.allocate_daily_queue(target_date);

  perform public.audit_action(
    'CREATE_DAILY_LIMIT',
    'daily_limit',
    saved_limit_row.id,
    case when existing_limit_row.id is null then null else to_jsonb(existing_limit_row) end,
    to_jsonb(saved_limit_row)
  );

  select jsonb_agg(
    jsonb_build_object(
      'fuel_type', dftl.fuel_type,
      'fuel_category', dftl.fuel_category,
      'limit_mode', dftl.limit_mode,
      'status', dftl.status,
      'vehicle_limit', dftl.vehicle_limit,
      'liters_limit', dftl.liters_limit
    )
    order by case dftl.fuel_type
      when 'AI_92' then 1
      when 'AI_95' then 2
      when 'AI_100' then 3
      when 'DIESEL' then 4
      when 'GAS' then 5
      else 6
    end
  )
  into fuel_type_rows
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = saved_limit_row.id
    and dftl.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS');

  return jsonb_build_object(
    'id', saved_limit_row.id,
    'date', saved_limit_row.date,
    'station_id', saved_limit_row.station_id,
    'status', saved_limit_row.status,
    'client_mutation_id', saved_limit_row.client_mutation_id,
    'fuel_type_limits', coalesce(fuel_type_rows, '[]'::jsonb),
    'category_limits', coalesce(fuel_type_rows, '[]'::jsonb)
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.allocate_daily_queue_impl(
  target_date date,
  preserve_existing_eta boolean DEFAULT false
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  candidate record;
  picked record;
  current_daily_position integer;
  current_station_position integer;
  current_station_fuel_position integer;
  current_station_eta_position integer;
  computed_arrival_at timestamptz;
  active_count integer := 0;
  paused_count integer := 0;
  reset_eta_positions boolean := false;
begin
  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('allocate_daily_queue:' || target_date::text, 0));

  drop table if exists pg_temp.queue_allocation_capacity;
  create temporary table queue_allocation_capacity (
    station_id uuid,
    fuel_type text,
    limit_mode text,
    vehicle_limit integer,
    liters_limit numeric,
    liters_used_baseline numeric,
    vehicle_used integer,
    liters_used numeric,
    start_time time,
    interval_minutes integer,
    vehicles_per_interval integer,
    allocation_order integer,
    primary key (station_id, fuel_type)
  ) on commit drop;

  insert into queue_allocation_capacity (
    station_id, fuel_type, limit_mode, vehicle_limit, liters_limit, liters_used_baseline,
    vehicle_used, liters_used, start_time, interval_minutes, vehicles_per_interval, allocation_order
  )
  select
    dl.station_id,
    dftl.fuel_type,
    coalesce(dftl.limit_mode, 'fuel_liters'),
    coalesce(dftl.vehicle_limit, 0),
    dftl.liters_limit,
    coalesce(dftl.liters_used_baseline, 0),
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
    and (
      (
        coalesce(dftl.limit_mode, 'fuel_liters') = 'fuel_liters'
        and coalesce(dftl.liters_limit, 0) > 0
      )
      or (
        coalesce(dftl.limit_mode, 'fuel_liters') = 'vehicle_count'
        and coalesce(dftl.vehicle_limit, 0) > 0
      )
    );

  update queue_allocation_capacity capacity
  set vehicle_used = usage.vehicle_used,
      liters_used = greatest(usage.liters_used - capacity.liters_used_baseline, 0)
  from (
    select
      dqa.station_id,
      dqa.assigned_fuel_type,
      count(*)::integer as vehicle_used,
      coalesce(sum(coalesce(fr.liters, dqa.allocated_liters)), 0)::numeric as liters_used
    from public.daily_queue_allocations dqa
    left join public.fueling_records fr on fr.allocation_id = dqa.id
    where dqa.allocation_date = target_date
      and (
        dqa.status = 'FUELED'
        or (preserve_existing_eta and dqa.status = 'ACTIVE')
      )
    group by dqa.station_id, dqa.assigned_fuel_type
  ) usage
  where capacity.station_id = usage.station_id
    and capacity.fuel_type = usage.assigned_fuel_type;

  select exists (
    select 1
    from public.daily_queue_allocations dqa
    where dqa.allocation_date = target_date
      and dqa.status = 'PAUSED_BY_LIMIT'
  )
  into reset_eta_positions;

  if not preserve_existing_eta then
    update public.daily_queue_allocations
    set status = 'PAUSED_BY_LIMIT',
        paused_at = now(),
        paused_reason = 'LIMIT_REALLOCATION'
    where allocation_date = target_date
      and status = 'ACTIVE';
  end if;

  select coalesce(max(daily_position), 0)
  into current_daily_position
  from public.daily_queue_allocations
  where allocation_date = target_date
    and (
      status = 'FUELED'
      or (preserve_existing_eta and status = 'ACTIVE')
    );

  drop table if exists pg_temp.queue_station_positions;
  create temporary table queue_station_positions (
    station_id uuid,
    fuel_category text,
    station_position integer,
    station_fuel_position integer,
    station_eta_position integer,
    primary key (station_id, fuel_category)
  ) on commit drop;

  insert into queue_station_positions (
    station_id,
    fuel_category,
    station_position,
    station_fuel_position,
    station_eta_position
  )
  select
    station_id,
    public.get_fuel_queue_category(assigned_fuel_type),
    max(station_position),
    max(station_fuel_position),
    case
      when preserve_existing_eta then max(station_fuel_position)
      when reset_eta_positions then 0
      else max(station_fuel_position)
    end
  from public.daily_queue_allocations
  where allocation_date = target_date
    and (
      status = 'FUELED'
      or (preserve_existing_eta and status = 'ACTIVE')
    )
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
        and (
          not preserve_existing_eta
          or not exists (
            select 1
            from public.daily_queue_allocations active_dqa
            where active_dqa.queue_entry_id = fqe.id
              and active_dqa.allocation_date = target_date
              and active_dqa.status = 'ACTIVE'
          )
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
    where (
        capacity.limit_mode = 'fuel_liters'
        and capacity.liters_limit is not null
        and capacity.liters_used + candidate.requested_liters <= capacity.liters_limit
      )
      or (
        capacity.limit_mode = 'vehicle_count'
        and capacity.vehicle_used < capacity.vehicle_limit
        and (
          capacity.liters_limit is null
          or capacity.liters_used + candidate.requested_liters <= capacity.liters_limit
        )
      )
    order by
      compatible.ordinality,
      case
        when capacity.limit_mode = 'fuel_liters' then
          floor((capacity.liters_limit - capacity.liters_used) / candidate.requested_liters)::integer
        when capacity.liters_limit is null then capacity.vehicle_limit - capacity.vehicle_used
        else least(
          capacity.vehicle_limit - capacity.vehicle_used,
          floor((capacity.liters_limit - capacity.liters_used) / candidate.requested_liters)::integer
        )
      end desc,
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
      coalesce(max(station_fuel_position), 0) + 1,
      coalesce(max(station_eta_position), 0) + 1
    into current_station_position, current_station_fuel_position, current_station_eta_position
    from queue_station_positions
    where station_id = picked.station_id
      and fuel_category = public.get_fuel_queue_category(picked.fuel_type);

    insert into queue_station_positions (
      station_id,
      fuel_category,
      station_position,
      station_fuel_position,
      station_eta_position
    )
    values (
      picked.station_id,
      public.get_fuel_queue_category(picked.fuel_type),
      current_station_position,
      current_station_fuel_position,
      current_station_eta_position
    )
    on conflict (station_id, fuel_category) do update
    set station_position = excluded.station_position,
        station_fuel_position = excluded.station_fuel_position,
        station_eta_position = excluded.station_eta_position;

    computed_arrival_at :=
      ((target_date + picked.start_time) at time zone 'Europe/Moscow')
      + make_interval(mins => (
          floor((current_station_eta_position - 1)::numeric / picked.vehicles_per_interval)::integer
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
  into active_count
  from public.daily_queue_allocations
  where allocation_date = target_date
    and status = 'ACTIVE';

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

ALTER FUNCTION public.allocate_daily_queue_impl(date, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.allocate_daily_queue_impl(date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_daily_queue_impl(date, boolean) FROM authenticated;
GRANT ALL ON FUNCTION public.allocate_daily_queue_impl(date, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_daily_limit_overview(target_date date) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with fuel_types(fuel_type, label, sort_order) as (
    values
      ('AI_92'::text, 'AI-92', 1),
      ('AI_95'::text, 'AI-95', 2),
      ('AI_100'::text, 'AI-100', 3),
      ('DIESEL'::text, 'Дизель', 4),
      ('GAS'::text, 'Газ', 5)
  ),
  active_stations as (
    select
      s.id as station_id,
      s.name as station_name,
      s.address as station_address,
      s.allocation_order
    from public.stations s
    where s.is_active
  ),
  station_fuel_grid as (
    select
      s.station_id,
      s.station_name,
      s.station_address,
      s.allocation_order,
      ft.fuel_type,
      ft.label,
      ft.sort_order,
      public.get_fuel_queue_category(ft.fuel_type) as fuel_category
    from active_stations s
    cross join fuel_types ft
  ),
  limit_rows as (
    select
      grid.station_id,
      grid.station_name,
      grid.station_address,
      grid.allocation_order,
      grid.fuel_type,
      grid.label,
      grid.sort_order,
      grid.fuel_category,
      dl.id,
      dl.date,
      dl.status as limit_status,
      dl.updated_at,
      coalesce(dftl.limit_mode, 'fuel_liters') as limit_mode,
      coalesce(dftl.vehicle_limit, 0)::integer as vehicle_limit,
      dftl.liters_limit,
      coalesce(dftl.liters_used_baseline, 0) as liters_used_baseline,
      coalesce(dftl.status, 'OPEN') as fuel_status
    from station_fuel_grid grid
    left join public.daily_limits dl
      on dl.date = target_date
     and dl.station_id = grid.station_id
    left join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = dl.id
     and dftl.fuel_type = grid.fuel_type
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
      greatest(coalesce(au.liters_count, 0) - lr.liters_used_baseline, 0) as used_liters,
      au.projected_number
    from limit_rows lr
    left join allocation_usage au
      on au.station_id = lr.station_id
     and au.fuel_type = lr.fuel_type
  ),
  station_json as (
    select
      station_id,
      jsonb_build_object(
        'exists', true,
        'id', (array_agg(id order by id::text) filter (where id is not null))[1],
        'date', target_date,
        'station_id', station_id,
        'station_name', max(station_name),
        'station_address', max(station_address),
        'status', coalesce(max(limit_status), 'OPEN'),
        'updated_at', max(updated_at),
        'category_overviews', jsonb_agg(jsonb_build_object(
          'fuel_type', fuel_type,
          'fuel_category', fuel_category,
          'label', label,
          'limit_mode', limit_mode,
          'vehicle_limit', vehicle_limit,
          'liters_limit', liters_limit,
          'queue_count', used_vehicles,
          'queued_liters', used_liters,
          'covered_vehicle_count', used_vehicles,
          'covered_liters', used_liters,
          'remaining_vehicle_count', case
            when limit_mode = 'fuel_liters' then null
            else greatest(vehicle_limit - used_vehicles, 0)
          end,
          'remaining_liters', case
            when liters_limit is null then null
            else greatest(liters_limit - used_liters, 0)
          end,
          'projected_queue_number', projected_number,
          'status', fuel_status
        ) order by sort_order)
      ) as value
    from enriched
    group by station_id, allocation_order
  ),
  global_category_rows as (
    select jsonb_build_object(
      'fuel_type', fuel_type,
      'fuel_category', max(fuel_category),
      'label', max(label),
      'limit_mode', case
        when bool_or(limit_mode = 'fuel_liters') then 'fuel_liters'
        else 'vehicle_count'
      end,
      'vehicle_limit', sum(vehicle_limit)::integer,
      'liters_limit', case when count(liters_limit) = 0 then null else sum(liters_limit) end,
      'queue_count', sum(used_vehicles)::integer,
      'queued_liters', sum(used_liters),
      'covered_vehicle_count', sum(used_vehicles)::integer,
      'covered_liters', sum(used_liters),
      'remaining_vehicle_count', case
        when bool_or(limit_mode = 'fuel_liters') then null
        else greatest(sum(vehicle_limit) - sum(used_vehicles), 0)::integer
      end,
      'remaining_liters', case
        when count(liters_limit) = 0 then null
        else greatest(sum(liters_limit) - sum(used_liters), 0)
      end,
      'projected_queue_number', max(projected_number)
    ) as value,
    fuel_type,
    max(sort_order) as sort_order
    from enriched
    group by fuel_type
  ),
  global_categories as (
    select jsonb_agg(value order by sort_order) as value
    from global_category_rows
  )
  select jsonb_build_object(
    'exists', exists(select 1 from active_stations),
    'id', null,
    'date', target_date,
    'station_id', null,
    'station_name', 'Все АЗС',
    'station_address', null,
    'status', case when exists(select 1 from active_stations) then 'OPEN' else null end,
    'category_overviews', coalesce((select value from global_categories), '[]'::jsonb),
    'station_overviews', coalesce((select jsonb_agg(value order by station_id) from station_json), '[]'::jsonb),
    'updated_at', (select max(updated_at) from limit_rows)
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_fueling_record_liters_limit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  daily_limit_row public.daily_limits%rowtype;
  fuel_type_limit_row public.daily_fuel_type_limits%rowtype;
  already_fueled_liters numeric := 0;
begin
  if new.date is null or new.station_id is null or new.fuel_type is null or new.liters is null then
    return new;
  end if;

  if new.preferential_queue_entry_id is not null then
    return new;
  end if;

  select *
  into daily_limit_row
  from public.daily_limits dl
  where dl.date = new.date
    and dl.station_id = new.station_id
    and dl.status = 'OPEN'
  limit 1;

  if daily_limit_row.id is null then
    return new;
  end if;

  select *
  into fuel_type_limit_row
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = daily_limit_row.id
    and dftl.fuel_type = new.fuel_type
  for update;

  if fuel_type_limit_row.id is null
    or fuel_type_limit_row.limit_mode <> 'fuel_liters'
    or fuel_type_limit_row.liters_limit is null then
    return new;
  end if;

  select coalesce(sum(fr.liters), 0)
  into already_fueled_liters
  from public.fueling_records fr
  where fr.date = new.date
    and fr.station_id = new.station_id
    and fr.fuel_type = new.fuel_type
    and fr.is_manual_override = false
    and fr.preferential_queue_entry_id is null
    and fr.id <> new.id;

  if coalesce(new.is_manual_override, false) is false
    and greatest(already_fueled_liters - coalesce(fuel_type_limit_row.liters_used_baseline, 0), 0) + new.liters > fuel_type_limit_row.liters_limit then
    raise exception 'LITERS_LIMIT_EXCEEDED';
  end if;

  return new;
end;
$$;

ALTER FUNCTION public.enforce_fueling_record_liters_limit() OWNER TO postgres;
