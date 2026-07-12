CREATE OR REPLACE FUNCTION public.allocate_daily_queue(target_date date) RETURNS jsonb
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
    vehicle_used integer,
    liters_used numeric,
    start_time time,
    interval_minutes integer,
    vehicles_per_interval integer,
    allocation_order integer,
    primary key (station_id, fuel_type)
  ) on commit drop;

  insert into queue_allocation_capacity (
    station_id, fuel_type, limit_mode, vehicle_limit, liters_limit, vehicle_used, liters_used,
    start_time, interval_minutes, vehicles_per_interval, allocation_order
  )
  select
    dl.station_id,
    dftl.fuel_type,
    coalesce(dftl.limit_mode, 'fuel_liters'),
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

  select exists (
    select 1
    from public.daily_queue_allocations dqa
    where dqa.allocation_date = target_date
      and dqa.status = 'PAUSED_BY_LIMIT'
  )
  into reset_eta_positions;

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
    case when reset_eta_positions then 0 else max(station_fuel_position) end
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

ALTER FUNCTION public.allocate_daily_queue(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.allocate_daily_queue(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_daily_queue(date) FROM authenticated;
GRANT ALL ON FUNCTION public.allocate_daily_queue(date) TO service_role;
