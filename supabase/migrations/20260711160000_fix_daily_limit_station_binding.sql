set check_function_bodies = off;
set search_path = public, extensions;

create unique index if not exists daily_limits_station_date_unique
on public.daily_limits (date, station_id)
where station_id is not null;

create or replace function public.create_daily_limit(
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
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_daily_limit.client_mutation_id, gen_random_uuid());
  existing_limit_row public.daily_limits%rowtype;
  saved_limit_row public.daily_limits%rowtype;
  item jsonb;
  item_fuel_type text;
  item_limit_mode text;
  item_vehicle_limit integer;
  item_liters_limit numeric;
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
      1,
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
    item_limit_mode := item->>'limit_mode';
    item_vehicle_limit := coalesce(nullif(item->>'vehicle_limit', '')::integer, 0);
    item_liters_limit := nullif(item->>'liters_limit', '')::numeric;

    if item_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
      raise exception 'INVALID_FUEL_TYPE';
    end if;

    if item_limit_mode not in ('vehicle_count', 'fuel_liters') then
      raise exception 'INVALID_LIMIT_MODE';
    end if;

    if item_vehicle_limit < 0 then
      raise exception 'INVALID_VEHICLE_LIMIT';
    end if;

    if item_liters_limit is not null and item_liters_limit < 0 then
      raise exception 'INVALID_LITERS_LIMIT';
    end if;

    insert into public.daily_fuel_type_limits (
      daily_limit_id,
      fuel_type,
      fuel_category,
      limit_mode,
      vehicle_limit,
      liters_limit
    )
    values (
      saved_limit_row.id,
      item_fuel_type,
      public.get_fuel_queue_category(item_fuel_type),
      item_limit_mode,
      item_vehicle_limit,
      item_liters_limit
    )
    on conflict (daily_limit_id, fuel_type) do update
    set fuel_category = excluded.fuel_category,
        limit_mode = excluded.limit_mode,
        vehicle_limit = excluded.vehicle_limit,
        liters_limit = excluded.liters_limit;
  end loop;

  update public.daily_limits
  set total_vehicle_limit = greatest(1, (
        select coalesce(sum(vehicle_limit), 0)
        from public.daily_fuel_type_limits dftl
        where dftl.daily_limit_id = saved_limit_row.id
      )),
      max_liters_per_vehicle = 20
  where id = saved_limit_row.id
  returning * into saved_limit_row;

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

create or replace function public.get_reservation_limit_station_assignments(target_date date default current_date)
returns table (
  reservation_id uuid,
  limit_station_id uuid,
  limit_station_name text,
  limit_station_address text,
  matched_fuel_type text
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive open_station_limits as (
    select
      dl.id,
      dl.station_id,
      s.name as station_name,
      s.address as station_address
    from public.daily_limits dl
    join public.stations s on s.id = dl.station_id
    where dl.date = target_date
      and dl.status = 'OPEN'
      and dl.station_id is not null
      and s.is_active
  ),
  fueled_usage as (
    select
      fr.station_id,
      fr.fuel_type,
      count(*) filter (
        where coalesce(fr.is_manual_override, false) = false
          and dftl.limit_mode = 'vehicle_count'
      )::integer as fueled_vehicle_count,
      coalesce(sum(fr.liters) filter (
        where coalesce(fr.is_manual_override, false) = false
          and dftl.limit_mode = 'fuel_liters'
      ), 0)::numeric as fueled_liters
    from public.fueling_records fr
    join open_station_limits osl on osl.station_id = fr.station_id
    join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = osl.id
     and dftl.fuel_type = fr.fuel_type
    where fr.date = target_date
      and fr.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
    group by fr.station_id, fr.fuel_type
  ),
  callable as (
    select *
    from public.get_callable_reservations(target_date)
    where is_within_today_limit
      and matched_fuel_type is not null
  ),
  active_reservations as (
    select
      fr.id,
      fr.station_id,
      fr.queue_number,
      c.matched_fuel_type,
      coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters
    from public.fuel_reservations fr
    join callable c on c.reservation_id = fr.id
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = target_date
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ),
  explicit_reservation_usage as (
    select
      ar.station_id,
      ar.matched_fuel_type as fuel_type,
      count(*)::integer as queued_vehicle_count,
      coalesce(sum(ar.effective_liters), 0)::numeric as queued_liters
    from active_reservations ar
    where ar.station_id is not null
    group by ar.station_id, ar.matched_fuel_type
  ),
  station_capacities as (
    select
      osl.station_id,
      osl.station_name,
      osl.station_address,
      dftl.fuel_type,
      dftl.limit_mode,
      greatest(
        case when dftl.limit_mode = 'vehicle_count' then coalesce(dftl.vehicle_limit, 0) else 0 end
          - coalesce(fu.fueled_vehicle_count, 0)
          - case when dftl.limit_mode = 'vehicle_count' then coalesce(eru.queued_vehicle_count, 0) else 0 end,
        0
      )::integer as vehicle_remaining,
      greatest(
        case when dftl.limit_mode = 'fuel_liters' then coalesce(dftl.liters_limit, 0) else 0 end
          - coalesce(fu.fueled_liters, 0)
          - case when dftl.limit_mode = 'fuel_liters' then coalesce(eru.queued_liters, 0) else 0 end,
        0
      )::numeric as liters_remaining
    from open_station_limits osl
    join public.daily_fuel_type_limits dftl on dftl.daily_limit_id = osl.id
    left join fueled_usage fu
      on fu.station_id = osl.station_id
     and fu.fuel_type = dftl.fuel_type
    left join explicit_reservation_usage eru
      on eru.station_id = osl.station_id
     and eru.fuel_type = dftl.fuel_type
    where dftl.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
      and (
        (dftl.limit_mode = 'vehicle_count' and coalesce(dftl.vehicle_limit, 0) > coalesce(fu.fueled_vehicle_count, 0) + coalesce(eru.queued_vehicle_count, 0))
        or
        (dftl.limit_mode = 'fuel_liters' and coalesce(dftl.liters_limit, 0) > coalesce(fu.fueled_liters, 0) + coalesce(eru.queued_liters, 0))
      )
  ),
  fuel_capacity_state as (
    select
      sc.fuel_type,
      jsonb_object_agg(
        sc.station_id::text,
        jsonb_build_object(
          'station_id', sc.station_id,
          'station_name', sc.station_name,
          'station_address', sc.station_address,
          'limit_mode', sc.limit_mode,
          'vehicle_remaining', sc.vehicle_remaining,
          'liters_remaining', sc.liters_remaining
        )
        order by sc.station_id
      ) as capacities
    from station_capacities sc
    group by sc.fuel_type
  ),
  explicit_station_assignments as (
    select
      ar.id as reservation_id,
      ar.station_id as limit_station_id,
      s.name as limit_station_name,
      s.address as limit_station_address,
      ar.matched_fuel_type
    from active_reservations ar
    join public.stations s on s.id = ar.station_id
    where ar.station_id is not null
  ),
  ordered_unassigned as (
    select
      ar.*,
      row_number() over (
        partition by ar.matched_fuel_type
        order by ar.queue_number asc, ar.id asc
      )::integer as fuel_rank
    from active_reservations ar
    where ar.station_id is null
  ),
  allocation_state (
    fuel_type,
    fuel_rank,
    reservation_id,
    assigned_station_id,
    assigned_station_name,
    assigned_station_address,
    matched_fuel_type,
    capacities
  ) as (
    select
      fcs.fuel_type,
      0::integer,
      null::uuid,
      null::uuid,
      null::text,
      null::text,
      null::text,
      fcs.capacities
    from fuel_capacity_state fcs

    union all

    select
      state.fuel_type,
      next_reservation.fuel_rank,
      next_reservation.id,
      picked.station_id,
      picked.station_name,
      picked.station_address,
      next_reservation.matched_fuel_type,
      case
        when picked.station_id is null then state.capacities
        when picked.limit_mode = 'vehicle_count' then jsonb_set(
          state.capacities,
          array[picked.station_id::text, 'vehicle_remaining'],
          to_jsonb(greatest(picked.vehicle_remaining - 1, 0)),
          false
        )
        else jsonb_set(
          state.capacities,
          array[picked.station_id::text, 'liters_remaining'],
          to_jsonb(greatest(picked.liters_remaining - next_reservation.effective_liters, 0)),
          false
        )
      end
    from allocation_state state
    join ordered_unassigned next_reservation
      on next_reservation.matched_fuel_type = state.fuel_type
     and next_reservation.fuel_rank = state.fuel_rank + 1
    left join lateral (
      select
        (capacity.value->>'station_id')::uuid as station_id,
        capacity.value->>'station_name' as station_name,
        capacity.value->>'station_address' as station_address,
        capacity.value->>'limit_mode' as limit_mode,
        (capacity.value->>'vehicle_remaining')::integer as vehicle_remaining,
        (capacity.value->>'liters_remaining')::numeric as liters_remaining,
        case
          when capacity.value->>'limit_mode' = 'vehicle_count'
            then (capacity.value->>'vehicle_remaining')::integer
          else floor(
            (capacity.value->>'liters_remaining')::numeric
            / greatest(next_reservation.effective_liters, 0.01)
          )::integer
        end as vehicle_capacity
      from jsonb_each(state.capacities) as capacity(station_id, value)
      where (
          capacity.value->>'limit_mode' = 'vehicle_count'
          and (capacity.value->>'vehicle_remaining')::integer > 0
        )
        or (
          capacity.value->>'limit_mode' = 'fuel_liters'
          and (capacity.value->>'liters_remaining')::numeric >= next_reservation.effective_liters
        )
      order by vehicle_capacity desc, (capacity.value->>'station_id')::uuid asc
      limit 1
    ) picked on true
  ),
  allocated_station_assignments as (
    select
      state.reservation_id,
      state.assigned_station_id as limit_station_id,
      state.assigned_station_name as limit_station_name,
      state.assigned_station_address as limit_station_address,
      state.matched_fuel_type
    from allocation_state state
    where state.fuel_rank > 0
      and state.reservation_id is not null
      and state.assigned_station_id is not null
  )
  select
    assignment.reservation_id,
    assignment.limit_station_id,
    assignment.limit_station_name,
    assignment.limit_station_address,
    assignment.matched_fuel_type
  from explicit_station_assignments assignment

  union all

  select
    assignment.reservation_id,
    assignment.limit_station_id,
    assignment.limit_station_name,
    assignment.limit_station_address,
    assignment.matched_fuel_type
  from allocated_station_assignments assignment
$$;

grant execute on function public.create_daily_limit(date, jsonb, uuid, uuid) to authenticated;
grant execute on function public.get_reservation_limit_station_assignments(date) to authenticated;
