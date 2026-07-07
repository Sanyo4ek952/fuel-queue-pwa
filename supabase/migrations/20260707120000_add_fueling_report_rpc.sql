set search_path = public, extensions;

create or replace function public.get_fueling_report(
  date_from date,
  date_to date,
  station_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_current_user_role(), '') <> 'mayor' then
    raise exception 'REPORT_ACCESS_DENIED';
  end if;

  if date_from is null or date_to is null or date_from > date_to then
    raise exception 'INVALID_REPORT_PERIOD';
  end if;

  return (
    with filtered_records as (
      select
        fr.id,
        fr.date,
        fr.station_id,
        fr.vehicle_id,
        fr.fuel_type,
        fr.liters
      from public.fueling_records fr
      where fr.date between get_fueling_report.date_from and get_fueling_report.date_to
        and (
          get_fueling_report.station_ids is null
          or cardinality(get_fueling_report.station_ids) = 0
          or fr.station_id = any(get_fueling_report.station_ids)
        )
    ),
    summary as (
      select
        coalesce(sum(fr.liters), 0)::numeric as total_liters,
        count(*)::integer as fueling_count,
        count(distinct fr.vehicle_id)::integer as unique_vehicle_count,
        coalesce(sum(fr.liters) / nullif(count(*), 0), 0)::numeric as average_liters_per_fueling
      from filtered_records fr
    )
    select jsonb_build_object(
      'summary', (
        select jsonb_build_object(
          'total_liters', summary.total_liters,
          'fueling_count', summary.fueling_count,
          'unique_vehicle_count', summary.unique_vehicle_count,
          'average_liters_per_fueling', summary.average_liters_per_fueling
        )
        from summary
      ),
      'by_station', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'station_id', station_summary.station_id,
            'station_name', station_summary.station_name,
            'total_liters', station_summary.total_liters,
            'fueling_count', station_summary.fueling_count,
            'unique_vehicle_count', station_summary.unique_vehicle_count
          )
          order by station_summary.station_name
        )
        from (
          select
            fr.station_id,
            s.name as station_name,
            coalesce(sum(fr.liters), 0)::numeric as total_liters,
            count(*)::integer as fueling_count,
            count(distinct fr.vehicle_id)::integer as unique_vehicle_count
          from filtered_records fr
          join public.stations s on s.id = fr.station_id
          group by fr.station_id, s.name
        ) station_summary
      ), '[]'::jsonb),
      'by_fuel_type', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'fuel_type', fuel_type_summary.fuel_type,
            'total_liters', fuel_type_summary.total_liters,
            'fueling_count', fuel_type_summary.fueling_count,
            'unique_vehicle_count', fuel_type_summary.unique_vehicle_count
          )
          order by fuel_type_summary.fuel_type
        )
        from (
          select
            fr.fuel_type,
            coalesce(sum(fr.liters), 0)::numeric as total_liters,
            count(*)::integer as fueling_count,
            count(distinct fr.vehicle_id)::integer as unique_vehicle_count
          from filtered_records fr
          group by fr.fuel_type
        ) fuel_type_summary
      ), '[]'::jsonb),
      'by_day', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'date', day_summary.date,
            'total_liters', day_summary.total_liters,
            'fueling_count', day_summary.fueling_count,
            'unique_vehicle_count', day_summary.unique_vehicle_count
          )
          order by day_summary.date
        )
        from (
          select
            fr.date,
            coalesce(sum(fr.liters), 0)::numeric as total_liters,
            count(*)::integer as fueling_count,
            count(distinct fr.vehicle_id)::integer as unique_vehicle_count
          from filtered_records fr
          group by fr.date
        ) day_summary
      ), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.get_fueling_report(date, date, uuid[]) to authenticated;
