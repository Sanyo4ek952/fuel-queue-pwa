set check_function_bodies = off;
set search_path = public, extensions;

create or replace function public.get_daily_limit_overview(
  target_date date,
  target_station_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  daily_limit_row public.daily_limits%rowtype;
  active_statuses text[] := array['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'];
  occupied_vehicle_count integer := 0;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  select *
  into daily_limit_row
  from public.daily_limits dl
  where dl.date = target_date
    and dl.station_id = target_station_id
  limit 1;

  if daily_limit_row.id is null then
    return jsonb_build_object(
      'exists', false,
      'date', target_date,
      'station_id', target_station_id,
      'status', null,
      'total_vehicle_limit', null,
      'max_liters_per_vehicle', null,
      'occupied_vehicle_count', 0,
      'remaining_vehicle_count', null,
      'fuel_type_overviews', '[]'::jsonb,
      'updated_at', null
    );
  end if;

  select count(*)
  into occupied_vehicle_count
  from public.fuel_reservations fr
  where fr.date = target_date
    and fr.station_id = target_station_id
    and fr.status = any(active_statuses);

  return jsonb_build_object(
    'exists', true,
    'id', daily_limit_row.id,
    'date', daily_limit_row.date,
    'station_id', daily_limit_row.station_id,
    'status', daily_limit_row.status,
    'total_vehicle_limit', daily_limit_row.total_vehicle_limit,
    'max_liters_per_vehicle', daily_limit_row.max_liters_per_vehicle,
    'occupied_vehicle_count', occupied_vehicle_count,
    'remaining_vehicle_count', greatest(daily_limit_row.total_vehicle_limit - occupied_vehicle_count, 0),
    'fuel_type_overviews', coalesce((
      with fuel_types(fuel_type, sort_order) as (
        values
          ('AI_92', 1),
          ('AI_95', 2),
          ('AI_100', 3),
          ('DIESEL', 4),
          ('GAS', 5),
          ('OTHER', 6)
      ),
      active_reservations as (
        select
          fr.fuel_type,
          count(*)::integer as occupied_vehicle_count,
          coalesce(sum(fr.requested_liters), 0)::numeric as reserved_liters
        from public.fuel_reservations fr
        where fr.date = target_date
          and fr.station_id = target_station_id
          and fr.status = any(active_statuses)
        group by fr.fuel_type
      )
      select jsonb_agg(
        jsonb_build_object(
          'fuel_type', ft.fuel_type,
          'vehicle_limit', coalesce(dftl.vehicle_limit, 0),
          'occupied_vehicle_count', coalesce(ar.occupied_vehicle_count, 0),
          'remaining_vehicle_count', greatest(coalesce(dftl.vehicle_limit, 0) - coalesce(ar.occupied_vehicle_count, 0), 0),
          'liters_limit', dftl.liters_limit,
          'reserved_liters', coalesce(ar.reserved_liters, 0),
          'remaining_liters', case
            when dftl.liters_limit is null then null
            else greatest(dftl.liters_limit - coalesce(ar.reserved_liters, 0), 0)
          end
        )
        order by ft.sort_order
      )
      from fuel_types ft
      left join public.daily_fuel_type_limits dftl
        on dftl.daily_limit_id = daily_limit_row.id
       and dftl.fuel_type = ft.fuel_type
      left join active_reservations ar
        on ar.fuel_type = ft.fuel_type
    ), '[]'::jsonb),
    'updated_at', daily_limit_row.updated_at
  );
end;
$$;

grant execute on function public.get_daily_limit_overview(date, uuid) to authenticated;
