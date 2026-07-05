set search_path = public, extensions;

create or replace function public.get_vehicle_fueling_history(plate_number text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if normalized_plate = '' then
    return jsonb_build_object(
      'normalized_plate_number', normalized_plate,
      'vehicle_id', null,
      'vehicle_found', false,
      'total_fueling_count', 0,
      'regular_fueling_count', 0,
      'manual_override_fueling_count', 0,
      'total_liters', 0,
      'first_fueled_at', null,
      'last_fueled_at', null,
      'station_summaries', '[]'::jsonb,
      'fuel_type_summaries', '[]'::jsonb
    );
  end if;

  select *
  into vehicle_row
  from public.vehicles v
  where v.normalized_plate_number = normalized_plate
  limit 1;

  if vehicle_row.id is null then
    return jsonb_build_object(
      'normalized_plate_number', normalized_plate,
      'vehicle_id', null,
      'vehicle_found', false,
      'total_fueling_count', 0,
      'regular_fueling_count', 0,
      'manual_override_fueling_count', 0,
      'total_liters', 0,
      'first_fueled_at', null,
      'last_fueled_at', null,
      'station_summaries', '[]'::jsonb,
      'fuel_type_summaries', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'normalized_plate_number', normalized_plate,
    'vehicle_id', vehicle_row.id,
    'vehicle_found', true,
    'total_fueling_count', (
      select count(*)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
    ),
    'regular_fueling_count', (
      select count(*)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
        and fr.is_manual_override = false
    ),
    'manual_override_fueling_count', (
      select count(*)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
        and fr.is_manual_override = true
    ),
    'total_liters', coalesce((
      select sum(fr.liters)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
    ), 0),
    'first_fueled_at', (
      select min(fr.fueled_at)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
    ),
    'last_fueled_at', (
      select max(fr.fueled_at)
      from public.fueling_records fr
      where fr.vehicle_id = vehicle_row.id
    ),
    'station_summaries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'station_id', station_summary.station_id,
          'station_name', station_summary.station_name,
          'fueling_count', station_summary.fueling_count,
          'total_liters', station_summary.total_liters
        )
        order by station_summary.station_name
      )
      from (
        select
          fr.station_id,
          s.name as station_name,
          count(*) as fueling_count,
          coalesce(sum(fr.liters), 0) as total_liters
        from public.fueling_records fr
        join public.stations s on s.id = fr.station_id
        where fr.vehicle_id = vehicle_row.id
        group by fr.station_id, s.name
      ) station_summary
    ), '[]'::jsonb),
    'fuel_type_summaries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'fuel_type', fuel_summary.fuel_type,
          'fueling_count', fuel_summary.fueling_count,
          'total_liters', fuel_summary.total_liters
        )
        order by fuel_summary.fuel_type
      )
      from (
        select
          fr.fuel_type,
          count(*) as fueling_count,
          coalesce(sum(fr.liters), 0) as total_liters
        from public.fueling_records fr
        where fr.vehicle_id = vehicle_row.id
        group by fr.fuel_type
      ) fuel_summary
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_vehicle_fueling_history(text) to authenticated;
