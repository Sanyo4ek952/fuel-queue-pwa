CREATE OR REPLACE FUNCTION public.allocate_daily_queue(
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

CREATE OR REPLACE FUNCTION public.allocate_daily_queue(target_date date) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  select public.allocate_daily_queue(target_date, false);
$$;

ALTER FUNCTION public.allocate_daily_queue(date, boolean) OWNER TO postgres;
ALTER FUNCTION public.allocate_daily_queue(date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.allocate_daily_queue(date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_daily_queue(date, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION public.allocate_daily_queue(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_daily_queue(date) FROM authenticated;
GRANT ALL ON FUNCTION public.allocate_daily_queue(date, boolean) TO service_role;
GRANT ALL ON FUNCTION public.allocate_daily_queue(date) TO service_role;

CREATE OR REPLACE FUNCTION "public"."get_today_call_list"("target_date" "date" DEFAULT CURRENT_DATE, "page_size" integer DEFAULT 25, "cursor_queue_number" integer DEFAULT NULL::integer, "cursor_id" "uuid" DEFAULT NULL::"uuid", "plate_search" "text" DEFAULT NULL::"text", "created_by_profile_id" "uuid" DEFAULT NULL::"uuid", "call_filter" "text" DEFAULT 'all'::"text", "gasoline_fuel_filter" "text" DEFAULT 'all'::"text", "fuel_category_filter" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  normalized_search text := public.normalize_plate_number(plate_search);
  effective_size integer := least(greatest(coalesce(page_size, 25), 1), 100);
begin
  if public.get_current_profile_id() is null then raise exception 'FORBIDDEN'; end if;

  return (
    with raw_base as (
      select
        coalesce(dqa.id, fqe.id) as id,
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
        case when dqa.status = 'ACTIVE' then dqa.assigned_fuel_type else null end as assigned_fuel_type,
        case when dqa.status = 'ACTIVE' then dqa.assigned_fuel_type else null end as matched_fuel_type,
        coalesce(dqa.daily_position, fqe.permanent_number) as daily_position,
        coalesce(dqa.daily_position, fqe.permanent_number) as current_position,
        greatest(coalesce(dqa.daily_position, fqe.permanent_number) - 1, 0) as people_ahead,
        dqa.station_position,
        dqa.station_fuel_position,
        case when dqa.status = 'ACTIVE' then dqa.arrival_at else null end as arrival_at,
        coalesce(dqa.status, 'PAUSED_BY_LIMIT') as allocation_status,
        fqe.status,
        fqe.sync_status,
        fqe.comment,
        fqe.client_mutation_id,
        dqa.status = 'ACTIVE' as is_within_today_limit,
        dqa.status = 'ACTIVE' as is_callable_now,
        case
          when dqa.status = 'PAUSED_BY_LIMIT' then 'PAUSED_BY_LIMIT'
          when dqa.id is null then 'OUTSIDE_TODAY_LIMIT'
          else null
        end as call_unavailable_reason,
        dqa.call_status as latest_call_status,
        v.normalized_plate_number,
        d.full_name as driver_full_name,
        d.phone as driver_phone,
        op.full_name as created_by_full_name,
        op.role as created_by_role,
        op.signature_name as created_by_signature_name,
        greatest(fqe.updated_at, coalesce(dqa.updated_at, fqe.updated_at)) as updated_at,
        public.get_fuel_queue_category(
          coalesce(case when dqa.status = 'ACTIVE' then dqa.assigned_fuel_type else null end, fqe.preferred_fuel_type)
        ) as effective_fuel_category,
        coalesce(case when dqa.status = 'ACTIVE' then dqa.assigned_fuel_type else null end, fqe.preferred_fuel_type) as effective_fuel_type
      from public.fuel_queue_entries fqe
      join public.vehicles v on v.id = fqe.vehicle_id
      left join public.drivers d on d.id = fqe.driver_id
      left join public.profiles op on op.id = fqe.operator_id
      left join public.daily_queue_allocations dqa
        on dqa.queue_entry_id = fqe.id
       and dqa.allocation_date = target_date
       and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED')
      left join public.stations s on s.id = dqa.station_id
      where fqe.status = 'WAITING'
        and (
          dqa.id is null
          or dqa.station_id is null
          or public.can_access_station(dqa.station_id)
        )
        and not exists (
          select 1
          from public.fueling_records fr
          where fr.vehicle_id = fqe.vehicle_id
            and fr.date = target_date
            and coalesce(fr.is_manual_override, false) = false
        )
    ),
    base as (
      select
        raw_base.*,
        row_number() over (
          partition by raw_base.effective_fuel_category
          order by raw_base.permanent_number, raw_base.id
        )::integer as fuel_queue_position
      from raw_base
    ),
    filtered as (
      select * from base
      where (normalized_search = '' or normalized_plate_number ilike '%' || normalized_search || '%')
        and (created_by_profile_id is null or operator_id = created_by_profile_id)
        and (gasoline_fuel_filter = 'all' or effective_fuel_type = gasoline_fuel_filter)
        and (fuel_category_filter is null or effective_fuel_category = fuel_category_filter)
        and (
          call_filter = 'all'
          or (call_filter = 'call' and allocation_status = 'ACTIVE' and latest_call_status <> 'CONTACTED')
          or (call_filter = 'contacted' and latest_call_status = 'CONTACTED')
          or (call_filter = 'no_answer' and latest_call_status = 'NO_ANSWER')
        )
        and (
          cursor_queue_number is null or cursor_id is null
          or (fuel_queue_position, id) > (cursor_queue_number, cursor_id)
        )
      order by fuel_queue_position, id
      limit effective_size + 1
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(row_value) order by fuel_queue_position, id)
        from (select * from filtered limit effective_size) row_value), '[]'::jsonb),
      'next_cursor', case when (select count(*) from filtered) > effective_size then (
        select jsonb_build_object('queue_number', fuel_queue_position, 'id', id)
        from filtered order by fuel_queue_position, id offset effective_size - 1 limit 1
      ) else null end,
      'summary', jsonb_build_object(
        'total_count', (select count(*) from base),
        'callable_count', (select count(*) from base where allocation_status = 'ACTIVE' and latest_call_status <> 'CONTACTED'),
        'contacted_count', (select count(*) from base where latest_call_status = 'CONTACTED'),
        'no_answer_count', (select count(*) from base where latest_call_status = 'NO_ANSWER'),
        'category_counts', jsonb_build_object(
          'GASOLINE', (select count(*) from base where effective_fuel_category = 'GASOLINE'),
          'DIESEL', (select count(*) from base where effective_fuel_category = 'DIESEL'),
          'GAS', (select count(*) from base where effective_fuel_category = 'GAS')
        ),
        'callable_category_counts', jsonb_build_object(
          'GASOLINE', (select count(*) from base where allocation_status = 'ACTIVE' and effective_fuel_category = 'GASOLINE'),
          'DIESEL', (select count(*) from base where allocation_status = 'ACTIVE' and effective_fuel_category = 'DIESEL'),
          'GAS', (select count(*) from base where allocation_status = 'ACTIVE' and effective_fuel_category = 'GAS')
        )
      )
    )
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.get_my_queue_status() RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
begin
  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  return (
    with raw_base as (
      select
        fqe.*,
        dqa.id as allocation_id,
        dqa.allocation_date,
        dqa.station_id as allocation_station_id,
        dqa.assigned_fuel_type,
        dqa.daily_position,
        dqa.station_position,
        dqa.station_fuel_position,
        case when dqa.status = 'ACTIVE' then dqa.arrival_at else null end as arrival_at,
        dqa.status as allocation_status,
        dqa.call_status,
        s.name as station_name,
        s.address as station_address,
        v.normalized_plate_number,
        d.full_name as driver_full_name,
        d.phone as driver_phone,
        public.get_fuel_queue_category(coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type)) as effective_fuel_category
      from public.fuel_queue_entries fqe
      join public.vehicles v on v.id = fqe.vehicle_id
      left join public.drivers d on d.id = fqe.driver_id
      left join public.daily_queue_allocations dqa
        on dqa.queue_entry_id = fqe.id
       and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
       and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED')
      left join public.stations s on s.id = dqa.station_id
      where fqe.status = 'WAITING'
        and not exists (
          select 1
          from public.fueling_records fr
          where fr.vehicle_id = fqe.vehicle_id
            and fr.date = (now() at time zone 'Europe/Moscow')::date
            and coalesce(fr.is_manual_override, false) = false
            and fr.preferential_queue_entry_id is null
        )
    ),
    positioned as (
      select
        raw_base.*,
        row_number() over (
          partition by raw_base.effective_fuel_category
          order by raw_base.permanent_number, raw_base.id
        )::integer as fuel_queue_position
      from raw_base
    )
    select public.queue_entry_to_json(fqe_json) || jsonb_build_object(
      'normalized_plate_number', positioned.normalized_plate_number,
      'driver_full_name', positioned.driver_full_name,
      'driver_phone', positioned.driver_phone,
      'fuel_queue_position', coalesce(positioned.fuel_queue_position, positioned.daily_position),
      'allocation', case when positioned.allocation_id is null then null else jsonb_build_object(
        'id', positioned.allocation_id,
        'date', positioned.allocation_date,
        'station_id', positioned.allocation_station_id,
        'station_name', positioned.station_name,
        'station_address', positioned.station_address,
        'assigned_fuel_type', positioned.assigned_fuel_type,
        'daily_position', positioned.daily_position,
        'station_position', positioned.station_position,
        'station_fuel_position', positioned.station_fuel_position,
        'arrival_at', positioned.arrival_at,
        'status', positioned.allocation_status,
        'call_status', positioned.call_status
      ) end,
      'date', positioned.allocation_date,
      'station_id', positioned.allocation_station_id,
      'station_name', positioned.station_name,
      'station_address', positioned.station_address,
      'current_position', positioned.daily_position,
      'people_ahead', case when positioned.daily_position is null then null else greatest(positioned.daily_position - 1, 0) end,
      'matched_fuel_type', positioned.assigned_fuel_type,
      'is_within_today_limit', positioned.allocation_status = 'ACTIVE',
      'is_callable_now', positioned.allocation_status = 'ACTIVE',
      'is_fuel_preference_update_locked', positioned.allocation_id is not null and positioned.allocation_status in ('ACTIVE', 'PAUSED_BY_LIMIT')
    )
    from positioned
    join public.fuel_queue_entries fqe_json on fqe_json.id = positioned.id
    join public.profile_vehicles pv
      on pv.vehicle_id = positioned.vehicle_id
     and pv.profile_id = current_profile_id
    where positioned.operator_id = current_profile_id
       or pv.created_at <= positioned.created_at
    order by positioned.permanent_number
    limit 1
  );
end;
$$;

ALTER FUNCTION public.get_my_queue_status() OWNER TO postgres;
GRANT ALL ON FUNCTION public.get_my_queue_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.check_public_queue_position(
  plate_number text,
  phone_last4 text,
  client_ip_hash text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  normalized_plate text := public.normalize_plate_number(plate_number);
  normalized_phone_last4 text := regexp_replace(coalesce(phone_last4, ''), '\D', '', 'g');
  matched record;
  ip_limit jsonb;
  plate_limit jsonb;
  search_result jsonb;
  response_remaining_attempts integer;
begin
  if trim(coalesce(client_ip_hash, '')) = '' then
    raise exception 'CLIENT_IP_HASH_REQUIRED';
  end if;

  ip_limit := public.apply_public_queue_rate_limit(
    'IP_REQUEST',
    client_ip_hash,
    10,
    interval '15 minutes',
    interval '30 minutes'
  );

  if not coalesce((ip_limit ->> 'allowed')::boolean, false) then
    return jsonb_build_object(
      'status', 'LIMIT_EXCEEDED',
      'public_status', 'LIMIT_EXCEEDED',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'fuel_queue_position', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'remaining_attempts', 0,
      'retry_after_seconds', (ip_limit ->> 'retry_after_seconds')::integer,
      'error_code', 'PUBLIC_QUEUE_IP_RATE_LIMITED'
    );
  end if;

  if normalized_phone_last4 !~ '^[0-9]{4}$' or normalized_plate = '' then
    return jsonb_build_object(
      'status', 'INVALID_INPUT',
      'public_status', 'INVALID_INPUT',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'fuel_queue_position', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'remaining_attempts', (ip_limit ->> 'remaining_attempts')::integer,
      'retry_after_seconds', 0
    );
  end if;

  with matched_base as (
    select
      fqe.*,
      dqa.id as allocation_id,
      dqa.daily_position,
      dqa.station_position,
      dqa.station_fuel_position,
      case when dqa.status = 'ACTIVE' then dqa.arrival_at else null end as arrival_at,
      dqa.status as allocation_status,
      dqa.assigned_fuel_type,
      dqa.call_status,
      v.normalized_plate_number,
      d.phone as driver_phone,
      public.get_fuel_queue_category(coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type)) as effective_fuel_category
    from public.fuel_queue_entries fqe
    join public.vehicles v on v.id = fqe.vehicle_id
    left join public.drivers d on d.id = fqe.driver_id
    left join public.daily_queue_allocations dqa
      on dqa.queue_entry_id = fqe.id
     and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
     and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED')
  ),
  position_base as (
    select matched_base.*
    from matched_base
    where matched_base.status = 'WAITING'
      and not exists (
        select 1
        from public.fueling_records fr
        where fr.vehicle_id = matched_base.vehicle_id
          and fr.date = (now() at time zone 'Europe/Moscow')::date
          and coalesce(fr.is_manual_override, false) = false
          and fr.preferential_queue_entry_id is null
      )
  ),
  positions as (
    select
      position_base.id,
      row_number() over (
        partition by position_base.effective_fuel_category
        order by position_base.permanent_number, position_base.id
      )::integer as fuel_queue_position
    from position_base
  ),
  positioned as (
    select matched_base.*, positions.fuel_queue_position
    from matched_base
    left join positions on positions.id = matched_base.id
  )
  select *
  into matched
  from positioned
  where normalized_plate_number = normalized_plate
    and right(regexp_replace(coalesce(driver_phone, ''), '\D', '', 'g'), 4) = normalized_phone_last4
  order by permanent_number desc
  limit 1;

  if matched.id is null then
    plate_limit := public.apply_public_queue_rate_limit(
      'PLATE_FAILURE',
      normalized_plate,
      10,
      interval '1 hour',
      interval '30 minutes'
    );

    if not coalesce((plate_limit ->> 'allowed')::boolean, false) then
      return jsonb_build_object(
        'status', 'LIMIT_EXCEEDED',
        'public_status', 'LIMIT_EXCEEDED',
        'queue_number', null,
        'ticket_number', null,
        'current_position', null,
        'people_ahead', null,
        'fuel_queue_position', null,
        'is_within_today_limit', null,
        'is_callable_now', null,
        'remaining_attempts', 0,
        'retry_after_seconds', (plate_limit ->> 'retry_after_seconds')::integer,
        'error_code', 'PUBLIC_QUEUE_PLATE_FAILURE_RATE_LIMITED'
      );
    end if;

    response_remaining_attempts := least(
      (ip_limit ->> 'remaining_attempts')::integer,
      (plate_limit ->> 'remaining_attempts')::integer
    );

    return jsonb_build_object(
      'status', 'NOT_FOUND',
      'public_status', 'NOT_FOUND',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'fuel_queue_position', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'remaining_attempts', response_remaining_attempts,
      'retry_after_seconds', 0
    );
  end if;

  plate_limit := public.apply_public_queue_rate_limit(
    'PLATE_SUCCESS',
    normalized_plate,
    30,
    interval '1 hour',
    interval '30 minutes'
  );

  if not coalesce((plate_limit ->> 'allowed')::boolean, false) then
    return jsonb_build_object(
      'status', 'LIMIT_EXCEEDED',
      'public_status', 'LIMIT_EXCEEDED',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'fuel_queue_position', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'remaining_attempts', 0,
      'retry_after_seconds', (plate_limit ->> 'retry_after_seconds')::integer,
      'error_code', 'PUBLIC_QUEUE_PLATE_SUCCESS_RATE_LIMITED'
    );
  end if;

  response_remaining_attempts := least(
    (ip_limit ->> 'remaining_attempts')::integer,
    (plate_limit ->> 'remaining_attempts')::integer
  );

  search_result := jsonb_build_object(
    'status', 'FOUND',
    'queue_number', matched.permanent_number,
    'ticket_number', matched.permanent_number,
    'permanent_number', matched.permanent_number,
    'current_position', matched.daily_position,
    'people_ahead', case when matched.daily_position is null then null else greatest(matched.daily_position - 1, 0) end,
    'fuel_queue_position', coalesce(matched.fuel_queue_position, matched.daily_position),
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
    'remaining_attempts', response_remaining_attempts,
    'retry_after_seconds', 0
  );

  return search_result;
end;
$$;

ALTER FUNCTION public.check_public_queue_position(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_public_queue_position(text, text, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_public_queue_position(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_reservation(
  reservation_id uuid,
  reason text,
  comment text DEFAULT NULL::text,
  client_mutation_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  actor_role text := public.get_current_user_role();
  saved_entry public.fuel_queue_entries%rowtype;
  can_cancel_as_consumer boolean := false;
  can_cancel_as_staff boolean := false;
begin
  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  select exists (
    select 1
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id
    where fqe.id = cancel_reservation.reservation_id
      and pv.profile_id = current_profile_id
      and pv.status = 'ACTIVE'
      and (
        fqe.operator_id = current_profile_id
        or pv.created_at <= fqe.created_at
      )
  ) into can_cancel_as_consumer;

  can_cancel_as_consumer :=
    actor_role = 'consumer'
    and can_cancel_as_consumer
    and cancel_reservation.reason = 'CONSUMER_CANCELLED';

  select exists (
    select 1
    from public.daily_queue_allocations dqa
    where dqa.queue_entry_id = cancel_reservation.reservation_id
      and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT')
      and public.can_access_station(dqa.station_id)
  ) into can_cancel_as_staff;

  can_cancel_as_staff :=
    public.has_role(array['mayor', 'station_manager', 'mayor_assistant'])
    and can_cancel_as_staff;

  if not (can_cancel_as_consumer or can_cancel_as_staff) then
    raise exception 'FORBIDDEN';
  end if;

  update public.fuel_queue_entries
  set status = 'CANCELLED',
      cancelled_by = current_profile_id,
      cancelled_at = now(),
      cancel_reason = cancel_reservation.reason,
      cancel_comment = nullif(trim(coalesce(cancel_reservation.comment, '')), '')
  where id = cancel_reservation.reservation_id
    and fuel_queue_entries.status = 'WAITING'
  returning * into saved_entry;

  if saved_entry.id is null then
    raise exception 'QUEUE_ENTRY_NOT_WAITING';
  end if;

  update public.daily_queue_allocations
  set status = 'EXPIRED', finalized_at = now()
  where queue_entry_id = saved_entry.id
    and daily_queue_allocations.status in ('ACTIVE', 'PAUSED_BY_LIMIT');

  perform public.allocate_daily_queue((now() at time zone 'Europe/Moscow')::date, true);

  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'cancelled_by', saved_entry.cancelled_by,
    'cancelled_at', saved_entry.cancelled_at,
    'cancel_reason', saved_entry.cancel_reason,
    'cancel_comment', saved_entry.cancel_comment
  );
end;
$$;

ALTER FUNCTION public.cancel_reservation(uuid, text, text, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.cancel_reservation(uuid, text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_fueling_record_for_allocation(
  allocation_id uuid,
  liters numeric,
  fueled_at timestamp with time zone DEFAULT now(),
  comment text DEFAULT NULL::text,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  allocation_row record;
  saved_record public.fueling_records%rowtype;
begin
  if current_profile_id is null or not public.has_role(array['mayor', 'station_manager', 'cashier']) then
    raise exception 'FORBIDDEN';
  end if;

  if liters is null or liters <= 0 then
    raise exception 'INVALID_LITERS';
  end if;

  select dqa.*, fqe.vehicle_id, fqe.driver_id
  into allocation_row
  from public.daily_queue_allocations dqa
  join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
  where dqa.id = allocation_id
  for update;

  if allocation_row.id is null or allocation_row.status <> 'ACTIVE' then
    raise exception 'ALLOCATION_NOT_ACTIVE';
  end if;

  if not public.can_access_station(allocation_row.station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  if liters > allocation_row.allocated_liters then
    raise exception 'LITERS_LIMIT_EXCEEDED';
  end if;

  if exists (
    select 1
    from public.fueling_records fr
    where fr.vehicle_id = allocation_row.vehicle_id
      and fr.date = allocation_row.allocation_date
      and coalesce(fr.is_manual_override, false) = false
      and fr.preferential_queue_entry_id is null
  ) then
    raise exception 'ALREADY_FUELED';
  end if;

  select *
  into saved_record
  from public.fueling_records
  where fueling_records.client_mutation_id = create_fueling_record_for_allocation.client_mutation_id
  limit 1;

  if saved_record.id is null then
    insert into public.fueling_records (
      date,
      station_id,
      vehicle_id,
      driver_id,
      queue_entry_id,
      allocation_id,
      fuel_type,
      liters,
      cashier_id,
      is_manual_override,
      comment,
      client_mutation_id,
      sync_status,
      fueled_at
    ) values (
      allocation_row.allocation_date,
      allocation_row.station_id,
      allocation_row.vehicle_id,
      allocation_row.driver_id,
      allocation_row.id,
      allocation_row.queue_entry_id,
      allocation_row.assigned_fuel_type,
      liters,
      current_profile_id,
      false,
      nullif(trim(coalesce(comment, '')), ''),
      coalesce(client_mutation_id, gen_random_uuid()),
      'SYNCED',
      coalesce(fueled_at, now())
    ) returning * into saved_record;

    update public.daily_queue_allocations
    set status = 'FUELED',
        fueled_at = saved_record.fueled_at,
        finalized_at = now()
    where id = allocation_row.id;

    update public.fuel_queue_entries
    set status = 'FUELED'
    where id = allocation_row.queue_entry_id;

    perform public.allocate_daily_queue(allocation_row.allocation_date, true);
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
    'preferential_queue_entry_id', saved_record.preferential_queue_entry_id,
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

ALTER FUNCTION public.create_fueling_record_for_allocation(uuid, numeric, timestamp with time zone, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_fueling_record_for_allocation(uuid, numeric, timestamp with time zone, text, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_fueling_record_for_allocation(uuid, numeric, timestamp with time zone, text, uuid) TO authenticated;
