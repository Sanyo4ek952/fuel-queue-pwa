set check_function_bodies = off;
set search_path = public, extensions;

do $$
declare
  call_list_sql text;
  authors_sql text;
begin
  call_list_sql := pg_get_functiondef(
    'public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text, text)'::regprocedure
  );

  call_list_sql := replace(
    call_list_sql,
    'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and fr.date = target_date
        and public.can_access_station(fr.station_id)',
    'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and (fr.station_id is null or public.can_access_station(fr.station_id))'
  );

  if position('and fr.date = target_date' in call_list_sql) > 0 then
    raise exception 'Could not remove target_date membership filter from get_today_call_list';
  end if;

  execute call_list_sql;

  authors_sql := pg_get_functiondef(
    'public.get_today_queue_authors(date, text, text, text)'::regprocedure
  );

  authors_sql := replace(
    authors_sql,
    'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and fr.date = target_date
        and fr.operator_id is not null
        and public.can_access_station(fr.station_id)',
    'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and fr.operator_id is not null
        and (fr.station_id is null or public.can_access_station(fr.station_id))'
  );

  authors_sql := replace(
    authors_sql,
    'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and fr.operator_id is not null
        and public.can_access_station(fr.station_id)',
    'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and fr.operator_id is not null
        and (fr.station_id is null or public.can_access_station(fr.station_id))'
  );

  if position('and fr.date = target_date' in authors_sql) > 0 then
    raise exception 'Could not remove target_date membership filter from get_today_queue_authors';
  end if;

  execute authors_sql;
end;
$$;

grant execute on function public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text, text) to authenticated;
grant execute on function public.get_today_queue_authors(date, text, text, text) to authenticated;
