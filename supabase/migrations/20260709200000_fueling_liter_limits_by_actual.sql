create or replace function public.enforce_fueling_record_liters_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  daily_limit_row public.daily_limits%rowtype;
  fuel_type_limit_row public.daily_fuel_type_limits%rowtype;
  already_fueled_liters numeric := 0;
begin
  if new.date is null or new.fuel_type is null or new.liters is null then
    return new;
  end if;

  select *
  into daily_limit_row
  from public.daily_limits dl
  where dl.date = new.date
    and dl.station_id is null
  limit 1;

  if daily_limit_row.id is null then
    return new;
  end if;

  select *
  into fuel_type_limit_row
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = daily_limit_row.id
    and dftl.fuel_type = new.fuel_type
  for update;

  if fuel_type_limit_row.id is null
    or fuel_type_limit_row.limit_mode <> 'fuel_liters'
    or fuel_type_limit_row.liters_limit is null then
    return new;
  end if;

  select coalesce(sum(fr.liters), 0)
  into already_fueled_liters
  from public.fueling_records fr
  where fr.date = new.date
    and fr.fuel_type = new.fuel_type
    and fr.id <> new.id;

  if already_fueled_liters + new.liters > fuel_type_limit_row.liters_limit then
    raise exception 'LITERS_LIMIT_EXCEEDED';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_fueling_record_liters_limit_trigger on public.fueling_records;

create trigger enforce_fueling_record_liters_limit_trigger
before insert or update of date, fuel_type, liters
on public.fueling_records
for each row
execute function public.enforce_fueling_record_liters_limit();

create or replace function public.get_daily_limit_overview(target_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  daily_limit_row public.daily_limits%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  select *
  into daily_limit_row
  from public.daily_limits dl
  where dl.date = target_date
    and dl.station_id is null
  limit 1;

  if daily_limit_row.id is null then
    return jsonb_build_object(
      'exists', false,
      'date', target_date,
      'status', null,
      'category_overviews', '[]'::jsonb,
      'fuel_type_overviews', '[]'::jsonb,
      'updated_at', null
    );
  end if;

  return jsonb_build_object(
    'exists', true,
    'id', daily_limit_row.id,
    'date', daily_limit_row.date,
    'station_id', daily_limit_row.station_id,
    'status', daily_limit_row.status,
    'category_overviews', coalesce((
      with fuel_types(fuel_type, label, sort_order) as (
        values
          ('AI_92', 'АИ-92', 1),
          ('AI_95', 'АИ-95', 2),
          ('AI_100', 'АИ-100', 3),
          ('DIESEL', 'Дизель', 4),
          ('GAS', 'Газ', 5)
      ),
      callable as (
        select *
        from public.get_callable_reservations(target_date)
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
      ),
      fueled_by_type as (
        select
          fr.fuel_type,
          coalesce(sum(fr.liters), 0)::numeric as fueled_liters
        from public.fueling_records fr
        where fr.date = target_date
        group by fr.fuel_type
      ),
      grouped as (
        select
          ft.fuel_type,
          ft.label,
          ft.sort_order,
          public.get_fuel_queue_category(ft.fuel_type) as fuel_category,
          dftl.limit_mode,
          coalesce(dftl.vehicle_limit, 0) as vehicle_limit,
          dftl.liters_limit,
          count(ar.id) filter (
            where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
          )::integer as queue_count,
          coalesce(sum(ar.effective_liters) filter (
            where ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
          ), 0)::numeric as queued_liters,
          count(c.reservation_id) filter (where c.matched_fuel_type = ft.fuel_type and c.is_within_today_limit)::integer as covered_vehicle_count,
          coalesce(sum(ar.effective_liters) filter (where c.matched_fuel_type = ft.fuel_type and c.is_within_today_limit), 0)::numeric as projected_covered_liters,
          coalesce(max(fbt.fueled_liters), 0)::numeric as fueled_liters,
          max(ar.queue_number) filter (where c.matched_fuel_type = ft.fuel_type and c.is_within_today_limit) as projected_queue_number
        from fuel_types ft
        left join public.daily_fuel_type_limits dftl
          on dftl.daily_limit_id = daily_limit_row.id
         and dftl.fuel_type = ft.fuel_type
        left join active_reservations ar
          on ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
        left join callable c
          on c.reservation_id = ar.id
        left join fueled_by_type fbt
          on fbt.fuel_type = ft.fuel_type
        group by ft.fuel_type, ft.label, ft.sort_order, dftl.limit_mode, dftl.vehicle_limit, dftl.liters_limit
      )
      select jsonb_agg(
        jsonb_build_object(
          'fuel_type', fuel_type,
          'fuel_category', fuel_category,
          'label', label,
          'limit_mode', coalesce(limit_mode, 'vehicle_count'),
          'vehicle_limit', vehicle_limit,
          'liters_limit', liters_limit,
          'queue_count', queue_count,
          'queued_liters', queued_liters,
          'covered_vehicle_count', covered_vehicle_count,
          'covered_liters', case
            when limit_mode = 'fuel_liters' then fueled_liters
            else projected_covered_liters
          end,
          'remaining_vehicle_count', case
            when coalesce(limit_mode, 'vehicle_count') = 'vehicle_count' then greatest(vehicle_limit - covered_vehicle_count, 0)
            else null
          end,
          'remaining_liters', case
            when limit_mode = 'fuel_liters' then greatest(coalesce(liters_limit, 0) - fueled_liters, 0)
            else null
          end,
          'projected_queue_number', projected_queue_number
        )
        order by sort_order
      )
      from grouped
    ), '[]'::jsonb),
    'fuel_type_overviews', coalesce((
      with fuel_types(fuel_type, label, sort_order) as (
        values
          ('AI_92', 'АИ-92', 1),
          ('AI_95', 'АИ-95', 2),
          ('AI_100', 'АИ-100', 3),
          ('DIESEL', 'Дизель', 4),
          ('GAS', 'Газ', 5)
      )
      select jsonb_agg(
        jsonb_build_object(
          'fuel_type', ft.fuel_type,
          'fuel_category', public.get_fuel_queue_category(ft.fuel_type),
          'label', ft.label,
          'limit_mode', coalesce(dftl.limit_mode, 'vehicle_count'),
          'vehicle_limit', coalesce(dftl.vehicle_limit, 0),
          'liters_limit', dftl.liters_limit
        )
        order by ft.sort_order
      )
      from fuel_types ft
      left join public.daily_fuel_type_limits dftl
        on dftl.daily_limit_id = daily_limit_row.id
       and dftl.fuel_type = ft.fuel_type
    ), '[]'::jsonb),
    'updated_at', daily_limit_row.updated_at
  );
end;
$$;
