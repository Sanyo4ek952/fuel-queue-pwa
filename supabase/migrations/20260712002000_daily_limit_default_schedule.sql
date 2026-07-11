CREATE OR REPLACE FUNCTION public.create_daily_limit(
  target_date date,
  fuel_type_limits jsonb DEFAULT '[]'::jsonb,
  client_mutation_id uuid DEFAULT gen_random_uuid(),
  target_station_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_daily_limit.client_mutation_id, gen_random_uuid());
  existing_limit_row public.daily_limits%rowtype;
  saved_limit_row public.daily_limits%rowtype;
  item jsonb;
  item_fuel_type text;
  item_status text;
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
    item_liters_limit := nullif(item->>'liters_limit', '')::numeric;

    if item_fuel_type is null
      or item_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
      raise exception 'INVALID_FUEL_TYPE';
    end if;

    if item_status is null or item_status not in ('OPEN', 'PAUSED') then
      raise exception 'INVALID_FUEL_STATUS';
    end if;

    if item_liters_limit is not null and item_liters_limit < 0 then
      raise exception 'INVALID_LITERS_LIMIT';
    end if;

    if item_status = 'OPEN' and coalesce(item_liters_limit, 0) <= 0 then
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
      'fuel_liters',
      item_status,
      0,
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
  set total_vehicle_limit = 0,
      max_liters_per_vehicle = 20
  where id = saved_limit_row.id
  returning * into saved_limit_row;

  insert into public.daily_fueling_schedules (
    date,
    station_id,
    fuel_category,
    start_time,
    interval_minutes,
    vehicles_per_interval,
    updated_by,
    client_mutation_id
  )
  select distinct
    target_date,
    target_station_id,
    dftl.fuel_category,
    time '13:00',
    5,
    5,
    current_profile_id,
    gen_random_uuid()
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = saved_limit_row.id
    and dftl.status = 'OPEN'
    and dftl.fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')
    and dftl.fuel_category in ('GASOLINE', 'DIESEL', 'GAS')
  on conflict (date, station_id, fuel_category) do nothing;

  perform public.allocate_daily_queue(target_date);

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
      'limit_mode', dftl.limit_mode,
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
