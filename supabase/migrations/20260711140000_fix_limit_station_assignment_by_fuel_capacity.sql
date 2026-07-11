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
    join open_station_limits osl
      on osl.station_id = fr.station_id
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
        (
          dftl.limit_mode = 'vehicle_count'
          and coalesce(dftl.vehicle_limit, 0)
            > coalesce(fu.fueled_vehicle_count, 0) + coalesce(eru.queued_vehicle_count, 0)
        )
        or (
          dftl.limit_mode = 'fuel_liters'
          and coalesce(dftl.liters_limit, 0)
            > coalesce(fu.fueled_liters, 0) + coalesce(eru.queued_liters, 0)
        )
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
        order by sc.station_name asc, sc.station_id asc
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
        (capacity.value->>'liters_remaining')::numeric as liters_remaining
      from jsonb_each(state.capacities) as capacity(station_id, value)
      where (
          capacity.value->>'limit_mode' = 'vehicle_count'
          and (capacity.value->>'vehicle_remaining')::integer > 0
        )
        or (
          capacity.value->>'limit_mode' = 'fuel_liters'
          and (capacity.value->>'liters_remaining')::numeric >= next_reservation.effective_liters
        )
      order by capacity.value->>'station_name' asc, (capacity.value->>'station_id')::uuid asc
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

grant execute on function public.get_reservation_limit_station_assignments(date) to authenticated;
