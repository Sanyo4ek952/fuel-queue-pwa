set check_function_bodies = off;
set search_path = public, extensions;

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
      'station_id', coalesce(fr.station_id, assigned_station.station_id),
      'station_name', coalesce(s.name, assigned_station.station_name),
      'station_address', coalesce(s.address, assigned_station.station_address),
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
      'is_within_today_limit', coalesce(c.is_within_today_limit, assigned_station.station_id is not null, false),
      'is_callable_now', coalesce(c.is_callable_now, false),
      'matched_fuel_type', coalesce(c.matched_fuel_type, assigned_station.matched_fuel_type),
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
    left join lateral (
      select
        dl.station_id,
        station.name as station_name,
        station.address as station_address,
        dftl.fuel_type as matched_fuel_type
      from public.daily_limits dl
      join public.stations station on station.id = dl.station_id
      join public.daily_fuel_type_limits dftl on dftl.daily_limit_id = dl.id
      where fr.station_id is null
        and dl.date = current_date
        and dl.status = 'OPEN'
        and dl.station_id is not null
        and station.is_active
        and dftl.fuel_type = any(public.get_compatible_fuel_types(fr.fuel_type, fr.fuel_preference_mode))
        and (
          (
            dftl.limit_mode = 'vehicle_count'
            and ap.current_position is not null
            and ap.current_position <= coalesce(dftl.vehicle_limit, 0)
          )
          or (
            dftl.limit_mode = 'fuel_liters'
            and coalesce(dftl.liters_limit, 0) >= coalesce(fr.requested_liters, 20)
          )
        )
      order by station.name asc, dftl.fuel_type asc
      limit 1
    ) assigned_station on true
    cross join fueling_lock
    where fr.operator_id = current_profile_id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by fr.queue_number asc
    limit 1
  );
end;
$$;

grant execute on function public.get_my_queue_status() to authenticated;
