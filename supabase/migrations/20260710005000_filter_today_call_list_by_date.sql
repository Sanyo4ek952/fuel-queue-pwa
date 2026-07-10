set check_function_bodies = off;
set search_path = public, extensions;

do $$
declare
  function_sql text;
  authors_function_sql text;
begin
  select pg_get_functiondef(
    'public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text)'::regprocedure
  )
  into function_sql;

  if function_sql is null then
    raise exception 'get_today_call_list(date, integer, integer, uuid, text, uuid, text, text) not found';
  end if;

  if position('fr.date = target_date' in function_sql) = 0 then
    function_sql := replace(
      function_sql,
      'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and public.can_access_station(fr.station_id)',
      'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and fr.date = target_date
        and public.can_access_station(fr.station_id)'
    );
  end if;

  if position('fr.date = target_date' in function_sql) = 0 then
    raise exception 'Could not add target_date filter to get_today_call_list';
  end if;

  execute function_sql;

  select pg_get_functiondef(
    'public.get_today_queue_authors(date, text, text, text)'::regprocedure
  )
  into authors_function_sql;

  if authors_function_sql is null then
    raise exception 'get_today_queue_authors(date, text, text, text) not found';
  end if;

  if position('fr.date = target_date' in authors_function_sql) = 0 then
    authors_function_sql := replace(
      authors_function_sql,
      'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and fr.operator_id is not null',
      'where fr.status in (''RESERVED'', ''ARRIVED'', ''APPROVED'', ''FUELING'')
        and fr.date = target_date
        and fr.operator_id is not null'
    );
  end if;

  if position('fr.date = target_date' in authors_function_sql) = 0 then
    raise exception 'Could not add target_date filter to get_today_queue_authors';
  end if;

  execute authors_function_sql;
end $$;

grant execute on function public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text) to authenticated;
grant execute on function public.get_today_queue_authors(date, text, text, text) to authenticated;
