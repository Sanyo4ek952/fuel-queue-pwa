-- Local persistent city queue plus saved allocations for today.

do $$
declare
  operator_profile_id uuid;
  station_row record;
  vehicle_id_value uuid;
  driver_id_value uuid;
  n integer;
begin
  perform set_config('search_path', 'public, extensions', true);

  select id into operator_profile_id
  from public.profiles
  where role in ('mayor', 'mayor_assistant', 'station_manager') and is_active
  order by case role when 'mayor' then 0 else 1 end
  limit 1;
  if operator_profile_id is null then
    raise exception 'Run local-dev-users.sql first.';
  end if;

  delete from public.daily_queue_allocation_call_logs;
  delete from public.daily_queue_allocations;
  delete from public.fuel_queue_entries where comment = 'Local 250 city queue seed';
  delete from public.daily_limits dl
  using public.stations s
  where dl.station_id = s.id
    and dl.date = (now() at time zone 'Europe/Moscow')::date
    and s.is_active;

  for station_row in select * from public.stations where is_active order by allocation_order
  loop
    insert into public.daily_fueling_schedules (
      date, station_id, fuel_category, start_time, interval_minutes,
      vehicles_per_interval, updated_by
    ) values
      ((now() at time zone 'Europe/Moscow')::date, station_row.id, 'GASOLINE', '13:00', 5, 5, operator_profile_id),
      ((now() at time zone 'Europe/Moscow')::date, station_row.id, 'DIESEL', '13:00', 5, 5, operator_profile_id),
      ((now() at time zone 'Europe/Moscow')::date, station_row.id, 'GAS', '13:00', 5, 5, operator_profile_id)
    on conflict (date, station_id, fuel_category) do update
    set start_time = excluded.start_time,
        interval_minutes = excluded.interval_minutes,
        vehicles_per_interval = excluded.vehicles_per_interval;
  end loop;

  for n in 1..250 loop
    insert into public.vehicles (plate_number, normalized_plate_number)
    values (
      U&'\0422' || lpad((n % 1000)::text, 3, '0') || U&'\0421\0422' || (100 + n)::text,
      U&'\0422' || lpad((n % 1000)::text, 3, '0') || U&'\0421\0422' || (100 + n)::text
    )
    on conflict (normalized_plate_number) do update set plate_number = excluded.plate_number
    returning id into vehicle_id_value;
    insert into public.drivers (full_name, phone)
    values (
      format(U&'\0422\0435\0441\0442\043E\0432\044B\0439 \0432\043E\0434\0438\0442\0435\043B\044C %s', n),
      format('+7978000%04s', n)
    )
    returning id into driver_id_value;
    insert into public.fuel_queue_entries (
      vehicle_id, driver_id, preferred_fuel_type, fuel_preference_mode,
      requested_liters, operator_id, comment
    ) values (
      vehicle_id_value,
      driver_id_value,
      (array['AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS'])[(n % 5) + 1],
      case when n % 7 = 0 and n % 5 < 3 then 'ANY_GASOLINE' else 'EXACT' end,
      40,
      operator_profile_id,
      'Local 250 city queue seed'
    );
  end loop;

  perform public.allocate_daily_queue((now() at time zone 'Europe/Moscow')::date);
end;
$$;
