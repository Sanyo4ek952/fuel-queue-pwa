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
  business_date date := (current_timestamp at time zone 'Europe/Moscow')::date;
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
      'station_id', coalesce(fr.station_id, lsa.limit_station_id),
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
    left join public.get_callable_reservations(business_date) c on c.reservation_id = fr.id
    left join public.get_reservation_limit_station_assignments(business_date) lsa
      on lsa.reservation_id = fr.id
    cross join fueling_lock
    where fr.operator_id = current_profile_id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by fr.queue_number asc
    limit 1
  );
end;
$$;

grant execute on function public.get_my_queue_status() to authenticated;
