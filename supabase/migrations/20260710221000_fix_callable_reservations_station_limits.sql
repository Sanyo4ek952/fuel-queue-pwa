set check_function_bodies = off;
set search_path = public, extensions;

create or replace function public.get_callable_reservations(target_date date default current_date)
returns table (
  reservation_id uuid,
  is_within_today_limit boolean,
  is_callable_now boolean,
  call_unavailable_reason text,
  matched_fuel_type text
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive open_limits as (
    select dl.*
    from public.daily_limits dl
    where dl.date = target_date
      and dl.station_id is not null
      and dl.status = 'OPEN'
  ),
  limit_rows as (
    select
      ol.station_id,
      fuel_type_row.fuel_type,
      coalesce(dftl.limit_mode, 'vehicle_count') as limit_mode,
      coalesce(dftl.vehicle_limit, 0)::integer as vehicle_limit,
      coalesce(dftl.liters_limit, 0)::numeric as liters_limit
    from open_limits ol
    cross join (values
      ('AI_92', 1),
      ('AI_95', 2),
      ('AI_100', 3),
      ('DIESEL', 4),
      ('GAS', 5)
    ) as fuel_type_row(fuel_type, sort_order)
    left join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = ol.id
     and dftl.fuel_type = fuel_type_row.fuel_type
  ),
  limit_state as (
    select
      station_id,
      max(limit_mode) filter (where fuel_type = 'AI_92') as ai92_mode,
      max(vehicle_limit) filter (where fuel_type = 'AI_92') as ai92_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'AI_92') as ai92_liters_limit,
      max(limit_mode) filter (where fuel_type = 'AI_95') as ai95_mode,
      max(vehicle_limit) filter (where fuel_type = 'AI_95') as ai95_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'AI_95') as ai95_liters_limit,
      max(limit_mode) filter (where fuel_type = 'AI_100') as ai100_mode,
      max(vehicle_limit) filter (where fuel_type = 'AI_100') as ai100_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'AI_100') as ai100_liters_limit,
      max(limit_mode) filter (where fuel_type = 'DIESEL') as diesel_mode,
      max(vehicle_limit) filter (where fuel_type = 'DIESEL') as diesel_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'DIESEL') as diesel_liters_limit,
      max(limit_mode) filter (where fuel_type = 'GAS') as gas_mode,
      max(vehicle_limit) filter (where fuel_type = 'GAS') as gas_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'GAS') as gas_liters_limit
    from limit_rows
    group by station_id
  ),
  all_active as (
    select
      fr.id,
      fr.station_id,
      fr.vehicle_id,
      fr.fuel_type,
      fr.fuel_preference_mode,
      fr.queue_number,
      fr.status,
      coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
      v.is_blocked,
      exists (
        select 1
        from public.fueling_records fueling
        where fueling.vehicle_id = fr.vehicle_id
          and fueling.date = target_date
          and fueling.is_manual_override = false
      ) as already_fueled,
      exists (
        select 1
        from public.reservation_call_logs rcl
        where rcl.reservation_id = fr.id
          and rcl.status = 'CONTACTED'
      ) as already_contacted
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = target_date
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ),
  ordered as (
    select
      row_number() over (
        partition by all_active.station_id
        order by all_active.queue_number asc, all_active.id asc
      )::integer as rn,
      all_active.*
    from all_active
    where all_active.station_id is not null
  ),
  allocation as (
    select
      ls.station_id,
      0::integer as rn,
      null::uuid as reservation_id,
      null::text as matched_fuel_type,
      false::boolean as is_within_today_limit,
      coalesce(ls.ai92_vehicle_limit, 0)::integer as ai92_vehicle_remaining,
      coalesce(ls.ai92_liters_limit, 0)::numeric as ai92_liters_remaining,
      coalesce(ls.ai95_vehicle_limit, 0)::integer as ai95_vehicle_remaining,
      coalesce(ls.ai95_liters_limit, 0)::numeric as ai95_liters_remaining,
      coalesce(ls.ai100_vehicle_limit, 0)::integer as ai100_vehicle_remaining,
      coalesce(ls.ai100_liters_limit, 0)::numeric as ai100_liters_remaining,
      coalesce(ls.diesel_vehicle_limit, 0)::integer as diesel_vehicle_remaining,
      coalesce(ls.diesel_liters_limit, 0)::numeric as diesel_liters_remaining,
      coalesce(ls.gas_vehicle_limit, 0)::integer as gas_vehicle_remaining,
      coalesce(ls.gas_liters_limit, 0)::numeric as gas_liters_remaining
    from limit_state ls

    union all

    select
      allocation.station_id,
      o.rn,
      o.id,
      choice.matched_fuel_type,
      choice.matched_fuel_type is not null,
      case when choice.matched_fuel_type = 'AI_92' and ls.ai92_mode = 'vehicle_count'
        then allocation.ai92_vehicle_remaining - 1 else allocation.ai92_vehicle_remaining end,
      case when choice.matched_fuel_type = 'AI_92' and ls.ai92_mode = 'fuel_liters'
        then allocation.ai92_liters_remaining - o.effective_liters else allocation.ai92_liters_remaining end,
      case when choice.matched_fuel_type = 'AI_95' and ls.ai95_mode = 'vehicle_count'
        then allocation.ai95_vehicle_remaining - 1 else allocation.ai95_vehicle_remaining end,
      case when choice.matched_fuel_type = 'AI_95' and ls.ai95_mode = 'fuel_liters'
        then allocation.ai95_liters_remaining - o.effective_liters else allocation.ai95_liters_remaining end,
      case when choice.matched_fuel_type = 'AI_100' and ls.ai100_mode = 'vehicle_count'
        then allocation.ai100_vehicle_remaining - 1 else allocation.ai100_vehicle_remaining end,
      case when choice.matched_fuel_type = 'AI_100' and ls.ai100_mode = 'fuel_liters'
        then allocation.ai100_liters_remaining - o.effective_liters else allocation.ai100_liters_remaining end,
      case when choice.matched_fuel_type = 'DIESEL' and ls.diesel_mode = 'vehicle_count'
        then allocation.diesel_vehicle_remaining - 1 else allocation.diesel_vehicle_remaining end,
      case when choice.matched_fuel_type = 'DIESEL' and ls.diesel_mode = 'fuel_liters'
        then allocation.diesel_liters_remaining - o.effective_liters else allocation.diesel_liters_remaining end,
      case when choice.matched_fuel_type = 'GAS' and ls.gas_mode = 'vehicle_count'
        then allocation.gas_vehicle_remaining - 1 else allocation.gas_vehicle_remaining end,
      case when choice.matched_fuel_type = 'GAS' and ls.gas_mode = 'fuel_liters'
        then allocation.gas_liters_remaining - o.effective_liters else allocation.gas_liters_remaining end
    from allocation
    join ordered o
      on o.station_id = allocation.station_id
     and o.rn = allocation.rn + 1
    join limit_state ls on ls.station_id = allocation.station_id
    cross join lateral (
      select (
        select candidate.fuel_type
        from unnest(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode))
          with ordinality as candidate(fuel_type, sort_order)
        where not o.is_blocked
          and not o.already_fueled
          and (
            (
              candidate.fuel_type = 'AI_92'
              and (
                (ls.ai92_mode = 'vehicle_count' and allocation.ai92_vehicle_remaining > 0)
                or (ls.ai92_mode = 'fuel_liters' and allocation.ai92_liters_remaining >= o.effective_liters)
              )
            )
            or (
              candidate.fuel_type = 'AI_95'
              and (
                (ls.ai95_mode = 'vehicle_count' and allocation.ai95_vehicle_remaining > 0)
                or (ls.ai95_mode = 'fuel_liters' and allocation.ai95_liters_remaining >= o.effective_liters)
              )
            )
            or (
              candidate.fuel_type = 'AI_100'
              and (
                (ls.ai100_mode = 'vehicle_count' and allocation.ai100_vehicle_remaining > 0)
                or (ls.ai100_mode = 'fuel_liters' and allocation.ai100_liters_remaining >= o.effective_liters)
              )
            )
            or (
              candidate.fuel_type = 'DIESEL'
              and (
                (ls.diesel_mode = 'vehicle_count' and allocation.diesel_vehicle_remaining > 0)
                or (ls.diesel_mode = 'fuel_liters' and allocation.diesel_liters_remaining >= o.effective_liters)
              )
            )
            or (
              candidate.fuel_type = 'GAS'
              and (
                (ls.gas_mode = 'vehicle_count' and allocation.gas_vehicle_remaining > 0)
                or (ls.gas_mode = 'fuel_liters' and allocation.gas_liters_remaining >= o.effective_liters)
              )
            )
          )
        order by candidate.sort_order
        limit 1
      ) as matched_fuel_type
    ) choice
  ),
  latest_calls as (
    select distinct on (rcl.reservation_id)
      rcl.reservation_id,
      rcl.status
    from public.reservation_call_logs rcl
    order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
  )
  select
    o.id as reservation_id,
    coalesce(a.is_within_today_limit, false) as is_within_today_limit,
    (
      coalesce(a.is_within_today_limit, false)
      and not o.is_blocked
      and not o.already_fueled
      and coalesce(lc.status, 'NOT_CALLED') <> 'CONTACTED'
    ) as is_callable_now,
    case
      when o.is_blocked then 'VEHICLE_BLOCKED'
      when o.already_fueled then 'ALREADY_FUELED'
      when coalesce(lc.status, 'NOT_CALLED') = 'CONTACTED' then 'ALREADY_CONTACTED'
      when o.station_id is null then 'NO_OPEN_DAILY_LIMIT'
      when not exists (
        select 1
        from open_limits ol
        where ol.station_id = o.station_id
      ) then 'NO_OPEN_DAILY_LIMIT'
      when coalesce(a.is_within_today_limit, false) then null
      when not exists (
        select 1
        from public.daily_fuel_type_limits dftl
        join open_limits ol on ol.id = dftl.daily_limit_id
        where ol.station_id = o.station_id
          and dftl.fuel_type = any(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode))
          and (
            (dftl.limit_mode = 'vehicle_count' and dftl.vehicle_limit > 0)
            or (dftl.limit_mode = 'fuel_liters' and coalesce(dftl.liters_limit, 0) > 0)
          )
      ) then 'NO_COMPATIBLE_FUEL'
      else 'OUTSIDE_TODAY_LIMIT'
    end as call_unavailable_reason,
    a.matched_fuel_type
  from all_active o
  left join allocation a on a.reservation_id = o.id
  left join latest_calls lc on lc.reservation_id = o.id
  order by o.queue_number asc, o.id asc
$$;

grant execute on function public.get_callable_reservations(date) to authenticated;
