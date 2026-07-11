set check_function_bodies = off;
set search_path = public, extensions;

alter table public.daily_limits
  drop constraint if exists daily_limits_total_vehicle_limit_check,
  add constraint daily_limits_total_vehicle_limit_check check (total_vehicle_limit >= 0);

create or replace function public.create_daily_limit(
  target_date date,
  fuel_type_limits jsonb default '[]'::jsonb,
  client_mutation_id uuid default gen_random_uuid(),
  target_station_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_daily_limit.client_mutation_id, gen_random_uuid());
  existing_limit_row public.daily_limits%rowtype;
  saved_limit_row public.daily_limits%rowtype;
  item jsonb;
  item_fuel_type text;
  item_status text;
  item_vehicle_limit integer;
  item_liters_limit numeric;
  fuel_type_rows jsonb;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if target_station_id is null or not exists (
    select 1
    from public.stations s
    where s.id = target_station_id
      and s.is_active
  ) then
    raise exception 'INVALID_STATION';
  end if;

  if jsonb_typeof(coalesce(fuel_type_limits, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_FUEL_TYPE_LIMITS';
  end if;

  select *
  into existing_limit_row
  from public.daily_limits dl
  where dl.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_limit_row.id is not null
    and (
      existing_limit_row.date is distinct from target_date
      or existing_limit_row.station_id is distinct from target_station_id
    ) then
    raise exception 'IDEMPOTENCY_KEY_REUSED';
  end if;

  if existing_limit_row.id is null then
    insert into public.daily_limits (
      date,
      station_id,
      total_vehicle_limit,
      max_liters_per_vehicle,
      status,
      created_by,
      client_mutation_id
    )
    values (
      target_date,
      target_station_id,
      0,
      20,
      'OPEN',
      current_profile_id,
      effective_client_mutation_id
    )
    on conflict (date, station_id) where station_id is not null do update
    set status = 'OPEN',
        created_by = excluded.created_by,
        client_mutation_id = excluded.client_mutation_id
    returning * into saved_limit_row;
  else
    saved_limit_row := existing_limit_row;
  end if;

  for item in
    select value
    from jsonb_array_elements(coalesce(fuel_type_limits, '[]'::jsonb))
  loop
    item_fuel_type := item->>'fuel_type';
    item_status := item->>'status';
    item_vehicle_limit := coalesce(nullif(item->>'vehicle_limit', '')::integer, 0);
    item_liters_limit := nullif(item->>'liters_limit', '')::numeric;

    if item_fuel_type is null
      or item_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
      raise exception 'INVALID_FUEL_TYPE';
    end if;

    if item_status is null or item_status not in ('OPEN', 'PAUSED') then
      raise exception 'INVALID_FUEL_STATUS';
    end if;

    if item_vehicle_limit < 0 then
      raise exception 'INVALID_VEHICLE_LIMIT';
    end if;

    if item_liters_limit is not null and item_liters_limit < 0 then
      raise exception 'INVALID_LITERS_LIMIT';
    end if;

    insert into public.daily_fuel_type_limits (
      daily_limit_id,
      fuel_type,
      fuel_category,
      limit_mode,
      status,
      vehicle_limit,
      liters_limit
    )
    values (
      saved_limit_row.id,
      item_fuel_type,
      public.get_fuel_queue_category(item_fuel_type),
      'vehicle_count',
      item_status,
      item_vehicle_limit,
      item_liters_limit
    )
    on conflict (daily_limit_id, fuel_type) do update
    set fuel_category = excluded.fuel_category,
        limit_mode = excluded.limit_mode,
        status = excluded.status,
        vehicle_limit = excluded.vehicle_limit,
        liters_limit = excluded.liters_limit;
  end loop;

  update public.daily_limits
  set total_vehicle_limit = (
        select coalesce(sum(vehicle_limit) filter (where status = 'OPEN'), 0)
        from public.daily_fuel_type_limits dftl
        where dftl.daily_limit_id = saved_limit_row.id
      ),
      max_liters_per_vehicle = 20
  where id = saved_limit_row.id
  returning * into saved_limit_row;

  perform public.audit_action(
    'CREATE_DAILY_LIMIT',
    'daily_limit',
    saved_limit_row.id,
    case when existing_limit_row.id is null then null else to_jsonb(existing_limit_row) end,
    to_jsonb(saved_limit_row)
  );

  select jsonb_agg(
    jsonb_build_object(
      'fuel_type', dftl.fuel_type,
      'fuel_category', dftl.fuel_category,
      'status', dftl.status,
      'vehicle_limit', dftl.vehicle_limit,
      'liters_limit', dftl.liters_limit
    )
    order by case dftl.fuel_type
      when 'AI_92' then 1
      when 'AI_95' then 2
      when 'AI_100' then 3
      when 'DIESEL' then 4
      when 'GAS' then 5
      else 6
    end
  )
  into fuel_type_rows
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = saved_limit_row.id
    and dftl.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS');

  return jsonb_build_object(
    'id', saved_limit_row.id,
    'date', saved_limit_row.date,
    'station_id', saved_limit_row.station_id,
    'status', saved_limit_row.status,
    'client_mutation_id', saved_limit_row.client_mutation_id,
    'fuel_type_limits', coalesce(fuel_type_rows, '[]'::jsonb),
    'category_limits', coalesce(fuel_type_rows, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_daily_limit_overview(target_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with fuel_types(fuel_type, label, sort_order) as (
    values
      ('AI_92'::text, 'AI-92', 1),
      ('AI_95'::text, 'AI-95', 2),
      ('AI_100'::text, 'AI-100', 3),
      ('DIESEL'::text, 'Дизель', 4),
      ('GAS'::text, 'Газ', 5)
  ),
  active_stations as (
    select
      s.id as station_id,
      s.name as station_name,
      s.address as station_address,
      s.allocation_order
    from public.stations s
    where s.is_active
  ),
  station_fuel_grid as (
    select
      s.station_id,
      s.station_name,
      s.station_address,
      s.allocation_order,
      ft.fuel_type,
      ft.label,
      ft.sort_order,
      public.get_fuel_queue_category(ft.fuel_type) as fuel_category
    from active_stations s
    cross join fuel_types ft
  ),
  limit_rows as (
    select
      grid.station_id,
      grid.station_name,
      grid.station_address,
      grid.allocation_order,
      grid.fuel_type,
      grid.label,
      grid.sort_order,
      grid.fuel_category,
      dl.id,
      dl.date,
      dl.status as limit_status,
      dl.updated_at,
      coalesce(dftl.vehicle_limit, 0)::integer as vehicle_limit,
      dftl.liters_limit,
      coalesce(dftl.status, 'OPEN') as fuel_status
    from station_fuel_grid grid
    left join public.daily_limits dl
      on dl.date = target_date
     and dl.station_id = grid.station_id
    left join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = dl.id
     and dftl.fuel_type = grid.fuel_type
  ),
  allocation_usage as (
    select
      dqa.station_id,
      dqa.assigned_fuel_type as fuel_type,
      count(*) filter (where dqa.status in ('ACTIVE', 'FUELED'))::integer as vehicle_count,
      coalesce(sum(coalesce(fr.liters, dqa.allocated_liters)) filter (where dqa.status in ('ACTIVE', 'FUELED')), 0)::numeric as liters_count,
      max(fqe.permanent_number) filter (where dqa.status in ('ACTIVE', 'FUELED')) as projected_number
    from public.daily_queue_allocations dqa
    join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
    left join public.fueling_records fr on fr.allocation_id = dqa.id
    where dqa.allocation_date = target_date
    group by dqa.station_id, dqa.assigned_fuel_type
  ),
  enriched as (
    select
      lr.*,
      coalesce(au.vehicle_count, 0) as used_vehicles,
      coalesce(au.liters_count, 0) as used_liters,
      au.projected_number
    from limit_rows lr
    left join allocation_usage au
      on au.station_id = lr.station_id
     and au.fuel_type = lr.fuel_type
  ),
  station_json as (
    select
      station_id,
      jsonb_build_object(
        'exists', true,
        'id', (array_agg(id order by id::text) filter (where id is not null))[1],
        'date', target_date,
        'station_id', station_id,
        'station_name', max(station_name),
        'station_address', max(station_address),
        'status', coalesce(max(limit_status), 'OPEN'),
        'updated_at', max(updated_at),
        'category_overviews', jsonb_agg(jsonb_build_object(
          'fuel_type', fuel_type,
          'fuel_category', fuel_category,
          'label', label,
          'limit_mode', 'vehicle_count',
          'vehicle_limit', vehicle_limit,
          'liters_limit', liters_limit,
          'queue_count', used_vehicles,
          'queued_liters', used_liters,
          'covered_vehicle_count', used_vehicles,
          'covered_liters', used_liters,
          'remaining_vehicle_count', greatest(vehicle_limit - used_vehicles, 0),
          'remaining_liters', case when liters_limit is null then null else greatest(liters_limit - used_liters, 0) end,
          'projected_queue_number', projected_number,
          'status', fuel_status
        ) order by sort_order)
      ) as value
    from enriched
    group by station_id, allocation_order
  ),
  global_category_rows as (
    select jsonb_build_object(
      'fuel_type', fuel_type,
      'fuel_category', max(fuel_category),
      'label', max(label),
      'limit_mode', 'vehicle_count',
      'vehicle_limit', sum(vehicle_limit)::integer,
      'liters_limit', case when count(liters_limit) = 0 then null else sum(liters_limit) end,
      'queue_count', sum(used_vehicles)::integer,
      'queued_liters', sum(used_liters),
      'covered_vehicle_count', sum(used_vehicles)::integer,
      'covered_liters', sum(used_liters),
      'remaining_vehicle_count', greatest(sum(vehicle_limit) - sum(used_vehicles), 0)::integer,
      'remaining_liters', case when count(liters_limit) = 0 then null else greatest(sum(liters_limit) - sum(used_liters), 0) end,
      'projected_queue_number', max(projected_number)
    ) as value,
    fuel_type,
    max(sort_order) as sort_order
    from enriched
    group by fuel_type
  ),
  global_categories as (
    select jsonb_agg(value order by sort_order) as value
    from global_category_rows
  )
  select jsonb_build_object(
    'exists', exists(select 1 from active_stations),
    'id', null,
    'date', target_date,
    'station_id', null,
    'station_name', 'Все АЗС',
    'station_address', null,
    'status', case when exists(select 1 from active_stations) then 'OPEN' else null end,
    'category_overviews', coalesce((select value from global_categories), '[]'::jsonb),
    'station_overviews', coalesce((select jsonb_agg(value order by station_id) from station_json), '[]'::jsonb),
    'updated_at', (select max(updated_at) from limit_rows)
  );
$$;

grant execute on function public.create_daily_limit(date, jsonb, uuid, uuid) to authenticated;
grant execute on function public.get_daily_limit_overview(date) to authenticated;
