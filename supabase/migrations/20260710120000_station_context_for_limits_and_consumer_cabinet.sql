set check_function_bodies = off;
set search_path = public, extensions;

create unique index if not exists daily_limits_station_date_unique
on public.daily_limits (date, station_id)
where station_id is not null;

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
  item_limit_mode text;
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

  if target_station_id is null then
    raise exception 'INVALID_STATION';
  end if;

  if not exists (
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
  from public.daily_limits
  where daily_limits.client_mutation_id = effective_client_mutation_id
  limit 1;

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
      1,
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
    item_limit_mode := item->>'limit_mode';
    item_vehicle_limit := coalesce(nullif(item->>'vehicle_limit', '')::integer, 0);
    item_liters_limit := nullif(item->>'liters_limit', '')::numeric;

    if item_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS') then
      raise exception 'INVALID_FUEL_TYPE';
    end if;

    if item_limit_mode not in ('vehicle_count', 'fuel_liters') then
      raise exception 'INVALID_LIMIT_MODE';
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
      vehicle_limit,
      liters_limit
    )
    values (
      saved_limit_row.id,
      item_fuel_type,
      public.get_fuel_queue_category(item_fuel_type),
      item_limit_mode,
      item_vehicle_limit,
      item_liters_limit
    )
    on conflict (daily_limit_id, fuel_type) do update
    set fuel_category = excluded.fuel_category,
        limit_mode = excluded.limit_mode,
        vehicle_limit = excluded.vehicle_limit,
        liters_limit = excluded.liters_limit;
  end loop;

  update public.daily_limits
  set total_vehicle_limit = greatest(1, (
        select coalesce(sum(vehicle_limit), 0)
        from public.daily_fuel_type_limits dftl
        where dftl.daily_limit_id = saved_limit_row.id
      )),
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
      'limit_mode', dftl.limit_mode,
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
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  return (
    with limits as (
      select
        dl.*,
        s.name as station_name,
        s.address as station_address,
        case when dl.station_id is null then 0 else 1 end as station_sort
      from public.daily_limits dl
      left join public.stations s on s.id = dl.station_id
      where dl.date = target_date
    ),
    station_overviews as (
      select
        l.id,
        l.date,
        l.station_id,
        coalesce(l.station_name, 'Все АЗС') as station_name,
        l.station_address,
        l.status,
        l.updated_at,
        coalesce((
          with fuel_types(fuel_type, label, sort_order) as (
            values
              ('AI_92', 'АИ-92', 1),
              ('AI_95', 'АИ-95', 2),
              ('AI_100', 'АИ-100', 3),
              ('DIESEL', 'Дизель', 4),
              ('GAS', 'Газ', 5)
          ),
          active_reservations as (
            select
              fr.id,
              fr.fuel_type,
              fr.fuel_preference_mode,
              coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
              fr.queue_number
            from public.fuel_reservations fr
            left join public.personal_vehicle_liter_limits pvll
              on pvll.vehicle_id = fr.vehicle_id
             and pvll.date = target_date
            where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
              and (l.station_id is null or fr.station_id = l.station_id)
          ),
          fueled_by_type as (
            select
              fr.fuel_type,
              coalesce(sum(fr.liters), 0)::numeric as fueled_liters
            from public.fueling_records fr
            where fr.date = target_date
              and (l.station_id is null or fr.station_id = l.station_id)
            group by fr.fuel_type
          ),
          reservation_coverage_by_type as (
            select
              fuel_type,
              count(id) filter (
                where cumulative_liters <= greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
              )::integer as liter_mode_covered_count,
              coalesce(sum(effective_liters) filter (
                where cumulative_liters <= greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
              ), 0)::numeric as liter_mode_covered_liters,
              max(queue_number) filter (
                where cumulative_liters <= greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
              ) as liter_mode_projected_queue_number
            from (
              select
                ft.fuel_type,
                ar.id,
                ar.queue_number,
                ar.effective_liters,
                dftl.liters_limit,
                coalesce(fbt.fueled_liters, 0)::numeric as fueled_liters,
                sum(ar.effective_liters) over (
                  partition by ft.fuel_type
                  order by ar.queue_number, ar.id
                )::numeric as cumulative_liters
              from fuel_types ft
              left join public.daily_fuel_type_limits dftl
                on dftl.daily_limit_id = l.id
               and dftl.fuel_type = ft.fuel_type
              join active_reservations ar
                on ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
              left join fueled_by_type fbt
                on fbt.fuel_type = ft.fuel_type
            ) ranked
            group by fuel_type
          ),
          grouped as (
            select
              ft.fuel_type,
              ft.label,
              ft.sort_order,
              public.get_fuel_queue_category(ft.fuel_type) as fuel_category,
              coalesce(dftl.limit_mode, 'vehicle_count') as limit_mode,
              coalesce(dftl.vehicle_limit, 0) as vehicle_limit,
              dftl.liters_limit,
              count(ar.id) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
              )::integer as queue_count,
              coalesce(sum(ar.effective_liters) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
              ), 0)::numeric as queued_liters,
              coalesce(sum(ar.effective_liters) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
                  and ar.queue_number <= coalesce(dftl.vehicle_limit, 0)
              ), 0)::numeric as vehicle_mode_covered_liters,
              count(ar.id) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
                  and ar.queue_number <= coalesce(dftl.vehicle_limit, 0)
              )::integer as vehicle_mode_covered_count,
              coalesce(max(fbt.fueled_liters), 0)::numeric as fueled_liters,
              coalesce(max(rcbt.liter_mode_covered_count), 0)::integer as liter_mode_covered_count,
              coalesce(max(rcbt.liter_mode_covered_liters), 0)::numeric as liter_mode_covered_liters,
              max(rcbt.liter_mode_projected_queue_number) as liter_mode_projected_queue_number,
              max(ar.queue_number) filter (
                where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
                  and ar.queue_number <= coalesce(dftl.vehicle_limit, 0)
              ) as projected_queue_number
            from fuel_types ft
            left join public.daily_fuel_type_limits dftl
              on dftl.daily_limit_id = l.id
             and dftl.fuel_type = ft.fuel_type
            left join active_reservations ar
              on ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
            left join fueled_by_type fbt
              on fbt.fuel_type = ft.fuel_type
            left join reservation_coverage_by_type rcbt
              on rcbt.fuel_type = ft.fuel_type
            group by ft.fuel_type, ft.label, ft.sort_order, dftl.limit_mode, dftl.vehicle_limit, dftl.liters_limit
          )
          select jsonb_agg(
            jsonb_build_object(
              'fuel_type', fuel_type,
              'fuel_category', fuel_category,
              'label', label,
              'limit_mode', limit_mode,
              'vehicle_limit', vehicle_limit,
              'liters_limit', liters_limit,
              'queue_count', queue_count,
              'queued_liters', queued_liters,
              'covered_vehicle_count', case
                when limit_mode = 'vehicle_count' then vehicle_mode_covered_count
                else liter_mode_covered_count
              end,
              'covered_liters', case
                when limit_mode = 'fuel_liters' then liter_mode_covered_liters
                else vehicle_mode_covered_liters
              end,
              'remaining_vehicle_count', case
                when limit_mode = 'vehicle_count' then greatest(vehicle_limit - vehicle_mode_covered_count, 0)
                else null
              end,
              'remaining_liters', case
                when limit_mode = 'fuel_liters' then greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
                else null
              end,
              'projected_queue_number', case
                when limit_mode = 'fuel_liters' then liter_mode_projected_queue_number
                else projected_queue_number
              end
            )
            order by sort_order
          )
          from grouped
        ), '[]'::jsonb) as category_overviews
      from limits l
    )
    select jsonb_build_object(
      'exists', exists(select 1 from limits),
      'date', target_date,
      'id', (select id from limits order by station_sort asc, station_name asc nulls first limit 1),
      'station_id', (select station_id from limits order by station_sort asc, station_name asc nulls first limit 1),
      'status', (select status from limits order by station_sort asc, station_name asc nulls first limit 1),
      'updated_at', (select max(updated_at) from limits),
      'station_overviews', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'date', date,
            'station_id', station_id,
            'station_name', station_name,
            'station_address', station_address,
            'status', status,
            'category_overviews', category_overviews,
            'updated_at', updated_at
          )
          order by case when station_id is null then 0 else 1 end, station_name
        )
        from station_overviews
      ), '[]'::jsonb),
      'category_overviews', coalesce((
        select category_overviews
        from station_overviews
        order by case when station_id is null then 0 else 1 end, station_name
        limit 1
      ), '[]'::jsonb),
      'fuel_type_overviews', '[]'::jsonb
    )
  );
end;
$$;

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
        row_number() over (order by fr.queue_number asc, fr.id asc)::integer as current_position
      from public.fuel_reservations fr
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    )
    select jsonb_build_object(
      'id', fr.id,
      'date', fr.date,
      'station_id', fr.station_id,
      'station_name', s.name,
      'station_address', s.address,
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
    where fr.operator_id = current_profile_id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by fr.queue_number asc
    limit 1
  );
end;
$$;

grant execute on function public.create_daily_limit(date, jsonb, uuid, uuid) to authenticated;
grant execute on function public.get_daily_limit_overview(date) to authenticated;
grant execute on function public.get_my_queue_status() to authenticated;
