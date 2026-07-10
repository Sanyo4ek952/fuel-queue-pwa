set check_function_bodies = off;
set search_path = public, extensions;

do $$
declare
  function_sql text;
  updated_sql text;
begin
  select pg_get_functiondef(
    'public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text)'::regprocedure
  )
  into function_sql;

  if function_sql is null then
    raise exception 'get_today_call_list(date, integer, integer, uuid, text, uuid, text, text) not found';
  end if;

  updated_sql := replace(
    function_sql,
    'row_number() over (order by fr.queue_number asc, fr.id asc)::integer as current_position',
    'row_number() over (partition by public.get_fuel_queue_category(fr.fuel_type) order by fr.queue_number asc, fr.id asc)::integer as current_position'
  );

  if updated_sql = function_sql then
    raise exception 'Could not update get_today_call_list current_position';
  end if;

  execute updated_sql;

  select pg_get_functiondef(
    'public.check_public_queue_position(text, text)'::regprocedure
  )
  into function_sql;

  if function_sql is null then
    raise exception 'check_public_queue_position(text, text) not found';
  end if;

  updated_sql := replace(
    function_sql,
    'row_number() over (order by fr.queue_number asc, fr.id asc)::integer as current_position',
    'row_number() over (partition by public.get_fuel_queue_category(fr.fuel_type) order by fr.queue_number asc, fr.id asc)::integer as current_position'
  );

  if updated_sql = function_sql then
    raise exception 'Could not update check_public_queue_position current_position';
  end if;

  execute updated_sql;

  select pg_get_functiondef(
    'public.get_my_queue_status()'::regprocedure
  )
  into function_sql;

  if function_sql is null then
    raise exception 'get_my_queue_status() not found';
  end if;

  updated_sql := replace(
    function_sql,
    'row_number() over (order by fr.queue_number asc, fr.id asc)::integer as current_position',
    'row_number() over (partition by public.get_fuel_queue_category(fr.fuel_type) order by fr.queue_number asc, fr.id asc)::integer as current_position'
  );

  if updated_sql = function_sql then
    raise exception 'Could not update get_my_queue_status current_position';
  end if;

  execute updated_sql;
end $$;

grant execute on function public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text) to authenticated;
grant execute on function public.check_public_queue_position(text, text) to anon, authenticated;
grant execute on function public.get_my_queue_status() to authenticated;
