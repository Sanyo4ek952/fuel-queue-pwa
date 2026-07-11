set check_function_bodies = off;
set search_path = public, extensions;

create or replace function public.get_daily_limit_overview(target_date date)
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

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  return (
    with limits as (
      select
        dl.*,
        s.name as station_name,
        s.address as station_address,
        case when dl.station_id is null then 0 else 1 end as station_sort
      from public.daily_limits dl
      left join public.stations s on s.id = dl.station_id
      where dl.date = target_date
    ),
    station_overviews as (
      select
        l.id,
        l.date,
        l.station_id,
        coalesce(l.station_name, 'Все АЗС') as station_name,
        l.station_address,
        l.status,
        l.updated_at,
        coalesce((
          with fuel_types(fuel_type, label, sort_order) as (
            values
              ('AI_92', 'АИ-92', 1),
              ('AI_95', 'АИ-95', 2),
              ('AI_100', 'АИ-100', 3),
              ('DIESEL', 'Дизель', 4),
              ('GAS', 'Газ', 5)
          ),
          active_reservations as (
            select
              fr.id,
              fr.fuel_type,
              fr.fuel_preference_mode,
              coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
              fr.queue_number
            from public.fuel_reservations fr
            left join public.personal_vehicle_liter_limits pvll
              on pvll.vehicle_id = fr.vehicle_id
             and pvll.date = target_date
            where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
              and (l.station_id is null or fr.station_id = l.station_id)
          ),
          fueled_by_type as (
            select
              fr.fuel_type,
              coalesce(sum(fr.liters), 0)::numeric as fueled_liters
            from public.fueling_records fr
            where fr.date = target_date
              and (l.station_id is null or fr.station_id = l.station_id)
            group by fr.fuel_type
          ),
          reservation_coverage_by_type as (
            select
              fuel_type,
              count(id) filter (
                where cumulative_liters <= greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
              )::integer as liter_mode_covered_count,
              coalesce(sum(effective_liters) filter (
                where cumulative_liters <= greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
              ), 0)::numeric as liter_mode_covered_liters,
              max(queue_number) filter (
                where cumulative_liters <= greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
              ) as liter_mode_projected_queue_number
            from (
              select
                ft.fuel_type,
                ar.id,
                ar.queue_number,
                ar.effective_liters,
                dftl.liters_limit,
                coalesce(fbt.fueled_liters, 0)::numeric as fueled_liters,
                sum(ar.effective_liters) over (
                  partition by ft.fuel_type
                  order by ar.queue_number, ar.id
                )::numeric as cumulative_liters
              from fuel_types ft
              left join public.daily_fuel_type_limits dftl
                on dftl.daily_limit_id = l.id
               and dftl.fuel_type = ft.fuel_type
              join active_reservations ar
                on ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
              left join fueled_by_type fbt
                on fbt.fuel_type = ft.fuel_type
            ) ranked
            group by fuel_type
          ),
          grouped as (
            select
              ft.fuel_type,
              ft.label,
              ft.sort_order,
              public.get_fuel_queue_category(ft.fuel_type) as fuel_category,
              coalesce(dftl.limit_mode, 'vehicle_count') as limit_mode,
              coalesce(dftl.vehicle_limit, 0) as vehicle_limit,
              dftl.liters_limit,
              count(ar.id) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
              )::integer as queue_count,
              coalesce(sum(ar.effective_liters) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
              ), 0)::numeric as queued_liters,
              coalesce(sum(ar.effective_liters) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
                  and ar.queue_number <= coalesce(dftl.vehicle_limit, 0)
              ), 0)::numeric as vehicle_mode_covered_liters,
              count(ar.id) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
                  and ar.queue_number <= coalesce(dftl.vehicle_limit, 0)
              )::integer as vehicle_mode_covered_count,
              coalesce(max(fbt.fueled_liters), 0)::numeric as fueled_liters,
              coalesce(max(rcbt.liter_mode_covered_count), 0)::integer as liter_mode_covered_count,
              coalesce(max(rcbt.liter_mode_covered_liters), 0)::numeric as liter_mode_covered_liters,
              max(rcbt.liter_mode_projected_queue_number) as liter_mode_projected_queue_number,
              max(ar.queue_number) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
                  and ar.queue_number <= coalesce(dftl.vehicle_limit, 0)
              ) as projected_queue_number
            from fuel_types ft
            left join public.daily_fuel_type_limits dftl
              on dftl.daily_limit_id = l.id
             and dftl.fuel_type = ft.fuel_type
            left join active_reservations ar
              on ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
            left join fueled_by_type fbt
              on fbt.fuel_type = ft.fuel_type
            left join reservation_coverage_by_type rcbt
              on rcbt.fuel_type = ft.fuel_type
            group by ft.fuel_type, ft.label, ft.sort_order, dftl.limit_mode, dftl.vehicle_limit, dftl.liters_limit
          )
          select jsonb_agg(
            jsonb_build_object(
              'fuel_type', fuel_type,
              'fuel_category', fuel_category,
              'label', label,
              'limit_mode', limit_mode,
              'vehicle_limit', vehicle_limit,
              'liters_limit', liters_limit,
              'queue_count', queue_count,
              'queued_liters', queued_liters,
              'covered_vehicle_count', case
                when limit_mode = 'vehicle_count' then vehicle_mode_covered_count
                else liter_mode_covered_count
              end,
              'covered_liters', case
                when limit_mode = 'fuel_liters' then liter_mode_covered_liters
                else vehicle_mode_covered_liters
              end,
              'remaining_vehicle_count', case
                when limit_mode = 'vehicle_count' then greatest(vehicle_limit - vehicle_mode_covered_count, 0)
                else null
              end,
              'remaining_liters', case
                when limit_mode = 'fuel_liters' then greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
                else null
              end,
              'projected_queue_number', case
                when limit_mode = 'fuel_liters' then liter_mode_projected_queue_number
                else projected_queue_number
              end
            )
            order by sort_order
          )
          from grouped
        ), '[]'::jsonb) as category_overviews
      from limits l
    )
    select jsonb_build_object(
      'exists', exists(select 1 from limits),
      'date', target_date,
      'id', (select id from limits order by station_sort asc, station_name asc nulls first limit 1),
      'station_id', (select station_id from limits order by station_sort asc, station_name asc nulls first limit 1),
      'status', (select status from limits order by station_sort asc, station_name asc nulls first limit 1),
      'updated_at', (select max(updated_at) from limits),
      'station_overviews', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'date', date,
            'station_id', station_id,
            'station_name', station_name,
            'station_address', station_address,
            'status', status,
            'category_overviews', category_overviews,
            'updated_at', updated_at
          )
          order by case when station_id is null then 0 else 1 end, station_name
        )
        from station_overviews
      ), '[]'::jsonb),
      'category_overviews', coalesce((
        select category_overviews
        from station_overviews
        order by case when station_id is null then 0 else 1 end, station_name
        limit 1
      ), '[]'::jsonb),
      'fuel_type_overviews', '[]'::jsonb
    )
  );
end;
$$;

grant execute on function public.get_daily_limit_overview(date) to authenticated;
