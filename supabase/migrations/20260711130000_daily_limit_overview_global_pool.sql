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
    with fuel_types(fuel_type, label, sort_order) as (
      values
        ('AI_92'::text, 'AI-92', 1),
        ('AI_95'::text, 'AI-95', 2),
        ('AI_100'::text, 'AI-100', 3),
        ('DIESEL'::text, 'Дизель', 4),
        ('GAS'::text, 'Газ', 5)
    ),
    limits as (
      select
        dl.*,
        s.name as station_name,
        s.address as station_address,
        case when dl.station_id is null then 0 else 1 end as station_sort
      from public.daily_limits dl
      left join public.stations s on s.id = dl.station_id
      where dl.date = target_date
    ),
    open_station_limits as (
      select *
      from limits
      where station_id is not null
        and status = 'OPEN'
    ),
    active_reservations as (
      select
        fr.id,
        fr.station_id,
        fr.vehicle_id,
        fr.fuel_type,
        fr.fuel_preference_mode,
        coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
        fr.queue_number
      from public.fuel_reservations fr
      left join public.personal_vehicle_liter_limits pvll
        on pvll.vehicle_id = fr.vehicle_id
       and pvll.date = target_date
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    ),
    callable as (
      select *
      from public.get_callable_reservations(target_date)
    ),
    fueled_by_type as (
      select
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
        on osl.date = fr.date
       and osl.station_id = fr.station_id
      join public.daily_fuel_type_limits dftl
        on dftl.daily_limit_id = osl.id
       and dftl.fuel_type = fr.fuel_type
      where fr.date = target_date
        and fr.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
      group by fr.fuel_type
    ),
    aggregate_limits as (
      select
        ft.fuel_type,
        ft.label,
        ft.sort_order,
        public.get_fuel_queue_category(ft.fuel_type) as fuel_category,
        coalesce(sum(dftl.vehicle_limit) filter (where dftl.limit_mode = 'vehicle_count'), 0)::integer as vehicle_limit,
        coalesce(sum(dftl.liters_limit) filter (where dftl.limit_mode = 'fuel_liters'), 0)::numeric as liters_limit,
        bool_or(dftl.limit_mode = 'fuel_liters' and coalesce(dftl.liters_limit, 0) > 0) as has_liter_limit
      from fuel_types ft
      left join open_station_limits osl on true
      left join public.daily_fuel_type_limits dftl
        on dftl.daily_limit_id = osl.id
       and dftl.fuel_type = ft.fuel_type
      group by ft.fuel_type, ft.label, ft.sort_order
    ),
    aggregate_overviews as (
      select
        al.fuel_type,
        al.label,
        al.sort_order,
        al.fuel_category,
        case
          when coalesce(al.has_liter_limit, false) and al.vehicle_limit = 0 then 'fuel_liters'
          else 'vehicle_count'
        end as limit_mode,
        al.vehicle_limit,
        nullif(al.liters_limit, 0) as liters_limit,
        count(ar.id) filter (
          where al.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
        )::integer as queue_count,
        coalesce(sum(ar.effective_liters) filter (
          where al.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
        ), 0)::numeric as queued_liters,
        count(ar.id) filter (
          where c.is_within_today_limit
            and c.matched_fuel_type = al.fuel_type
        )::integer as covered_vehicle_count,
        coalesce(sum(ar.effective_liters) filter (
          where c.is_within_today_limit
            and c.matched_fuel_type = al.fuel_type
        ), 0)::numeric as covered_liters,
        coalesce(max(fbt.fueled_vehicle_count), 0)::integer as fueled_vehicle_count,
        coalesce(max(fbt.fueled_liters), 0)::numeric as fueled_liters,
        max(ar.queue_number) filter (
          where c.is_within_today_limit
            and c.matched_fuel_type = al.fuel_type
        ) as projected_queue_number
      from aggregate_limits al
      left join active_reservations ar
        on al.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
      left join callable c on c.reservation_id = ar.id
      left join fueled_by_type fbt on fbt.fuel_type = al.fuel_type
      group by al.fuel_type, al.label, al.sort_order, al.fuel_category, al.vehicle_limit, al.liters_limit, al.has_liter_limit
    ),
    aggregate_category_overviews as (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'fuel_type', fuel_type,
          'fuel_category', fuel_category,
          'label', label,
          'limit_mode', limit_mode,
          'vehicle_limit', vehicle_limit,
          'liters_limit', liters_limit,
          'queue_count', queue_count,
          'queued_liters', queued_liters,
          'covered_vehicle_count', covered_vehicle_count,
          'covered_liters', covered_liters,
          'remaining_vehicle_count', case
            when limit_mode = 'vehicle_count' then greatest(vehicle_limit - fueled_vehicle_count - covered_vehicle_count, 0)
            else null
          end,
          'remaining_liters', case
            when limit_mode = 'fuel_liters' then greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
            else null
          end,
          'projected_queue_number', projected_queue_number
        )
        order by sort_order
      ), '[]'::jsonb) as category_overviews
      from aggregate_overviews
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
          with station_active_reservations as (
            select *
            from active_reservations ar
            where l.station_id is null or ar.station_id = l.station_id
          ),
          station_fueled_by_type as (
            select
              fr.fuel_type,
              coalesce(sum(fr.liters) filter (where coalesce(fr.is_manual_override, false) = false), 0)::numeric as fueled_liters
            from public.fueling_records fr
            where fr.date = target_date
              and (l.station_id is null or fr.station_id = l.station_id)
            group by fr.fuel_type
          ),
          station_grouped as (
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
              count(ar.id) filter (
                where c.is_within_today_limit
                  and c.matched_fuel_type = ft.fuel_type
                  and (l.station_id is null or ar.station_id = l.station_id)
              )::integer as covered_vehicle_count,
              coalesce(sum(ar.effective_liters) filter (
                where c.is_within_today_limit
                  and c.matched_fuel_type = ft.fuel_type
                  and (l.station_id is null or ar.station_id = l.station_id)
              ), 0)::numeric as covered_liters,
              coalesce(max(sfbt.fueled_liters), 0)::numeric as fueled_liters,
              max(ar.queue_number) filter (
                where c.is_within_today_limit
                  and c.matched_fuel_type = ft.fuel_type
                  and (l.station_id is null or ar.station_id = l.station_id)
              ) as projected_queue_number
            from fuel_types ft
            left join public.daily_fuel_type_limits dftl
              on dftl.daily_limit_id = l.id
             and dftl.fuel_type = ft.fuel_type
            left join station_active_reservations ar
              on ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
            left join callable c on c.reservation_id = ar.id
            left join station_fueled_by_type sfbt on sfbt.fuel_type = ft.fuel_type
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
              'covered_vehicle_count', covered_vehicle_count,
              'covered_liters', covered_liters,
              'remaining_vehicle_count', case
                when limit_mode = 'vehicle_count' then greatest(vehicle_limit - covered_vehicle_count, 0)
                else null
              end,
              'remaining_liters', case
                when limit_mode = 'fuel_liters' then greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
                else null
              end,
              'projected_queue_number', projected_queue_number
            )
            order by sort_order
          )
          from station_grouped
        ), '[]'::jsonb) as category_overviews
      from limits l
    )
    select jsonb_build_object(
      'exists', exists(select 1 from limits),
      'date', target_date,
      'id', (select id from limits order by station_sort asc, station_name asc nulls first limit 1),
      'station_id', null,
      'station_name', 'Общий пул',
      'station_address', null,
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
      'category_overviews', (select category_overviews from aggregate_category_overviews),
      'fuel_type_overviews', '[]'::jsonb
    )
  );
end;
$$;

grant execute on function public.get_daily_limit_overview(date) to authenticated;
