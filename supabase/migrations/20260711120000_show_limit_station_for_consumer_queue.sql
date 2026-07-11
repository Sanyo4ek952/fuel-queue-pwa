set check_function_bodies = off;
set search_path = public, extensions;

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
  with open_station_limits as (
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
    join open_station_limits osl
      on osl.station_id = fr.station_id
    join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = osl.id
     and dftl.fuel_type = fr.fuel_type
    where fr.date = target_date
      and fr.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
    group by fr.station_id, fr.fuel_type
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
        - coalesce(fu.fueled_vehicle_count, 0),
        0
      )::integer as vehicle_capacity,
      greatest(
        case when dftl.limit_mode = 'fuel_liters' then coalesce(dftl.liters_limit, 0) else 0 end
        - coalesce(fu.fueled_liters, 0),
        0
      )::numeric as liters_capacity
    from open_station_limits osl
    join public.daily_fuel_type_limits dftl on dftl.daily_limit_id = osl.id
    left join fueled_usage fu
      on fu.station_id = osl.station_id
     and fu.fuel_type = dftl.fuel_type
    where dftl.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
  ),
  station_ranges as (
    select
      sc.*,
      coalesce(
        sum(sc.vehicle_capacity) over (
          partition by sc.fuel_type
          order by sc.station_name asc, sc.station_id asc
          rows between unbounded preceding and 1 preceding
        ),
        0
      )::integer as vehicle_before,
      sum(sc.vehicle_capacity) over (
        partition by sc.fuel_type
        order by sc.station_name asc, sc.station_id asc
        rows between unbounded preceding and current row
      )::integer as vehicle_through,
      coalesce(
        sum(sc.liters_capacity) over (
          partition by sc.fuel_type
          order by sc.station_name asc, sc.station_id asc
          rows between unbounded preceding and 1 preceding
        ),
        0
      )::numeric as liters_before,
      sum(sc.liters_capacity) over (
        partition by sc.fuel_type
        order by sc.station_name asc, sc.station_id asc
        rows between unbounded preceding and current row
      )::numeric as liters_through,
      sum(sc.vehicle_capacity) over (partition by sc.fuel_type)::integer as total_vehicle_capacity
    from station_capacities sc
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
  ranked_reservations as (
    select
      ar.*,
      row_number() over (
        partition by ar.matched_fuel_type
        order by ar.queue_number asc, ar.id asc
      )::integer as fuel_rank
    from active_reservations ar
  )
  select distinct on (rr.id)
    rr.id as reservation_id,
    coalesce(rr.station_id, sr.station_id) as limit_station_id,
    s.name as limit_station_name,
    s.address as limit_station_address,
    rr.matched_fuel_type
  from ranked_reservations rr
  left join lateral (
    select candidate.*
    from station_ranges candidate
    where candidate.fuel_type = rr.matched_fuel_type
      and (
        (
          rr.fuel_rank <= candidate.total_vehicle_capacity
          and rr.fuel_rank > candidate.vehicle_before
          and rr.fuel_rank <= candidate.vehicle_through
        )
        or (
          rr.fuel_rank > candidate.total_vehicle_capacity
          and coalesce((
            select sum(previous.effective_liters)
            from ranked_reservations previous
            where previous.matched_fuel_type = rr.matched_fuel_type
              and previous.fuel_rank > candidate.total_vehicle_capacity
              and previous.fuel_rank <= rr.fuel_rank
          ), 0) > candidate.liters_before
          and coalesce((
            select sum(previous.effective_liters)
            from ranked_reservations previous
            where previous.matched_fuel_type = rr.matched_fuel_type
              and previous.fuel_rank > candidate.total_vehicle_capacity
              and previous.fuel_rank <= rr.fuel_rank
          ), 0) <= candidate.liters_through
        )
      )
    order by candidate.station_name asc, candidate.station_id asc
    limit 1
  ) sr on rr.station_id is null
  left join public.stations s on s.id = coalesce(rr.station_id, sr.station_id)
  where coalesce(rr.station_id, sr.station_id) is not null
  order by rr.id, s.name asc, s.id asc
$$;

grant execute on function public.get_reservation_limit_station_assignments(date) to authenticated;

do $$
declare
  function_sql text;
  updated_sql text;
begin
  select pg_get_functiondef(
    'public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text, text)'::regprocedure
  )
  into function_sql;

  if function_sql is null then
    raise exception 'get_today_call_list(date, integer, integer, uuid, text, uuid, text, text, text) not found';
  end if;

  updated_sql := replace(
    function_sql,
    's.name as station_name,
        s.address as station_address,',
    'coalesce(s.name, lsa.limit_station_name) as station_name,
        coalesce(s.address, lsa.limit_station_address) as station_address,'
  );

  updated_sql := replace(
    updated_sql,
    'left join public.stations s on s.id = fr.station_id
      left join public.drivers d on d.id = fr.driver_id',
    'left join public.stations s on s.id = fr.station_id
      left join public.get_reservation_limit_station_assignments(target_date) lsa on lsa.reservation_id = fr.id
      left join public.drivers d on d.id = fr.driver_id'
  );

  if updated_sql = function_sql then
    raise exception 'Could not add limit station context to get_today_call_list';
  end if;

  execute updated_sql;
end $$;

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
        row_number() over (
          partition by public.get_fuel_queue_category(fr.fuel_type)
          order by fr.queue_number asc, fr.id asc
        )::integer as current_position
      from public.fuel_reservations fr
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    ),
    fueling_lock as (
      select exists (
        select 1
        from public.fuel_reservations fr
        where fr.status = 'FUELING'
      ) as is_locked
    )
    select jsonb_build_object(
      'id', fr.id,
      'date', fr.date,
      'station_id', fr.station_id,
      'station_name', coalesce(s.name, lsa.limit_station_name),
      'station_address', coalesce(s.address, lsa.limit_station_address),
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
      'is_within_today_limit', coalesce(c.is_within_today_limit, false),
      'is_callable_now', coalesce(c.is_callable_now, false),
      'matched_fuel_type', coalesce(c.matched_fuel_type, lsa.matched_fuel_type),
      'is_fuel_preference_update_locked', fueling_lock.is_locked,
      'status', fr.status,
      'client_mutation_id', fr.client_mutation_id,
      'created_at', fr.created_at,
      'updated_at', fr.updated_at
    )
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.drivers d on d.id = fr.driver_id
    left join public.stations s on s.id = fr.station_id
    left join active_positions ap on ap.id = fr.id
    left join public.get_callable_reservations(current_date) c on c.reservation_id = fr.id
    left join public.get_reservation_limit_station_assignments(current_date) lsa on lsa.reservation_id = fr.id
    cross join fueling_lock
    where fr.operator_id = current_profile_id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by fr.queue_number asc
    limit 1
  );
end;
$$;

grant execute on function public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text, text) to authenticated;
grant execute on function public.get_my_queue_status() to authenticated;
