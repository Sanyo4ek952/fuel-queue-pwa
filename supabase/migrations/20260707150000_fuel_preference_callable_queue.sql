set check_function_bodies = off;
set search_path = public, extensions;

alter table public.fuel_reservations
  add column if not exists fuel_preference_mode text not null default 'EXACT';

alter table public.fuel_reservations
  drop constraint if exists fuel_reservations_fuel_preference_mode_check,
  add constraint fuel_reservations_fuel_preference_mode_check
    check (fuel_preference_mode in ('EXACT', 'ANY_GASOLINE'));

update public.fuel_reservations
set fuel_preference_mode = 'EXACT'
where fuel_preference_mode is null;

drop index if exists public.daily_fuel_category_limits_unique;
drop index if exists public.daily_fuel_type_limits_exact_unique;

insert into public.daily_fuel_type_limits (
  daily_limit_id,
  fuel_type,
  fuel_category,
  limit_mode,
  vehicle_limit,
  liters_limit
)
select
  dftl.daily_limit_id,
  fuel_type_row.fuel_type,
  'GASOLINE',
  dftl.limit_mode,
  0,
  null
from public.daily_fuel_type_limits dftl
cross join (values ('AI_92'), ('AI_100')) as fuel_type_row(fuel_type)
where dftl.fuel_category = 'GASOLINE'
  and not exists (
    select 1
    from public.daily_fuel_type_limits existing
    where existing.daily_limit_id = dftl.daily_limit_id
      and existing.fuel_type = fuel_type_row.fuel_type
  );

create unique index if not exists daily_fuel_type_limits_exact_unique
on public.daily_fuel_type_limits (daily_limit_id, fuel_type);

create index if not exists idx_reservations_callable_queue
on public.fuel_reservations (status, queue_number, fuel_type, fuel_preference_mode);

create index if not exists idx_daily_fuel_type_limits_exact
on public.daily_fuel_type_limits (daily_limit_id, fuel_type);

create index if not exists idx_reservation_call_logs_contacted
on public.reservation_call_logs (reservation_id, status, called_at desc);

create or replace function public.get_compatible_fuel_types(
  fuel_type text,
  fuel_preference_mode text default 'EXACT'
)
returns text[]
language sql
immutable
as $$
  select case
    when fuel_preference_mode = 'ANY_GASOLINE'
      and fuel_type in ('AI_92', 'AI_95', 'AI_100')
      then array['AI_92', 'AI_95', 'AI_100']::text[]
    else array[fuel_type]::text[]
  end
$$;

create or replace function public.get_fuel_preference_label(
  fuel_type text,
  fuel_preference_mode text default 'EXACT'
)
returns text
language sql
immutable
as $$
  select case
    when fuel_preference_mode = 'ANY_GASOLINE'
      and fuel_type in ('AI_92', 'AI_95', 'AI_100')
      then 'Подойдёт АИ-92/95/100'
    else 'Только ' || case fuel_type
      when 'AI_92' then 'АИ-92'
      when 'AI_95' then 'АИ-95'
      when 'AI_100' then 'АИ-100'
      when 'DIESEL' then 'дизель'
      when 'GAS' then 'газ'
      else fuel_type
    end
  end
$$;

drop function if exists public.get_callable_reservations(date);

create or replace function public.get_callable_reservations(target_date date default current_date)
returns table (
  reservation_id uuid,
  is_within_today_limit boolean,
  is_callable_now boolean,
  call_unavailable_reason text,
  matched_fuel_type text
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive daily_limit as (
    select *
    from public.daily_limits dl
    where dl.date = target_date
      and dl.station_id is null
      and dl.status = 'OPEN'
    limit 1
  ),
  limit_rows as (
    select
      fuel_type_row.fuel_type,
      coalesce(dftl.limit_mode, 'vehicle_count') as limit_mode,
      coalesce(dftl.vehicle_limit, 0)::integer as vehicle_limit,
      coalesce(dftl.liters_limit, 0)::numeric as liters_limit
    from (values
      ('AI_92', 1),
      ('AI_95', 2),
      ('AI_100', 3),
      ('DIESEL', 4),
      ('GAS', 5)
    ) as fuel_type_row(fuel_type, sort_order)
    left join daily_limit dl on true
    left join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = dl.id
     and dftl.fuel_type = fuel_type_row.fuel_type
  ),
  limit_state as (
    select
      max(limit_mode) filter (where fuel_type = 'AI_92') as ai92_mode,
      max(vehicle_limit) filter (where fuel_type = 'AI_92') as ai92_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'AI_92') as ai92_liters_limit,
      max(limit_mode) filter (where fuel_type = 'AI_95') as ai95_mode,
      max(vehicle_limit) filter (where fuel_type = 'AI_95') as ai95_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'AI_95') as ai95_liters_limit,
      max(limit_mode) filter (where fuel_type = 'AI_100') as ai100_mode,
      max(vehicle_limit) filter (where fuel_type = 'AI_100') as ai100_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'AI_100') as ai100_liters_limit,
      max(limit_mode) filter (where fuel_type = 'DIESEL') as diesel_mode,
      max(vehicle_limit) filter (where fuel_type = 'DIESEL') as diesel_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'DIESEL') as diesel_liters_limit,
      max(limit_mode) filter (where fuel_type = 'GAS') as gas_mode,
      max(vehicle_limit) filter (where fuel_type = 'GAS') as gas_vehicle_limit,
      max(liters_limit) filter (where fuel_type = 'GAS') as gas_liters_limit,
      exists(select 1 from daily_limit) as has_open_daily_limit
    from limit_rows
  ),
  all_active as (
    select
      fr.id,
      fr.vehicle_id,
      fr.fuel_type,
      fr.fuel_preference_mode,
      fr.queue_number,
      fr.status,
      coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
      v.is_blocked,
      exists (
        select 1
        from public.fueling_records fueling
        where fueling.vehicle_id = fr.vehicle_id
          and fueling.date = target_date
          and fueling.is_manual_override = false
      ) as already_fueled,
      exists (
        select 1
        from public.reservation_call_logs rcl
        where rcl.reservation_id = fr.id
          and rcl.status = 'CONTACTED'
      ) as already_contacted
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = target_date
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ),
  ordered as (
    select
      row_number() over (order by queue_number asc, id asc)::integer as rn,
      *
    from all_active
  ),
  allocation as (
    select
      0::integer as rn,
      null::uuid as reservation_id,
      null::text as matched_fuel_type,
      false::boolean as is_within_today_limit,
      coalesce(ls.ai92_vehicle_limit, 0)::integer as ai92_vehicle_remaining,
      coalesce(ls.ai92_liters_limit, 0)::numeric as ai92_liters_remaining,
      coalesce(ls.ai95_vehicle_limit, 0)::integer as ai95_vehicle_remaining,
      coalesce(ls.ai95_liters_limit, 0)::numeric as ai95_liters_remaining,
      coalesce(ls.ai100_vehicle_limit, 0)::integer as ai100_vehicle_remaining,
      coalesce(ls.ai100_liters_limit, 0)::numeric as ai100_liters_remaining,
      coalesce(ls.diesel_vehicle_limit, 0)::integer as diesel_vehicle_remaining,
      coalesce(ls.diesel_liters_limit, 0)::numeric as diesel_liters_remaining,
      coalesce(ls.gas_vehicle_limit, 0)::integer as gas_vehicle_remaining,
      coalesce(ls.gas_liters_limit, 0)::numeric as gas_liters_remaining
    from limit_state ls

    union all

    select
      o.rn,
      o.id,
      choice.matched_fuel_type,
      choice.matched_fuel_type is not null,
      case when choice.matched_fuel_type = 'AI_92' and ls.ai92_mode = 'vehicle_count'
        then allocation.ai92_vehicle_remaining - 1 else allocation.ai92_vehicle_remaining end,
      case when choice.matched_fuel_type = 'AI_92' and ls.ai92_mode = 'fuel_liters'
        then allocation.ai92_liters_remaining - o.effective_liters else allocation.ai92_liters_remaining end,
      case when choice.matched_fuel_type = 'AI_95' and ls.ai95_mode = 'vehicle_count'
        then allocation.ai95_vehicle_remaining - 1 else allocation.ai95_vehicle_remaining end,
      case when choice.matched_fuel_type = 'AI_95' and ls.ai95_mode = 'fuel_liters'
        then allocation.ai95_liters_remaining - o.effective_liters else allocation.ai95_liters_remaining end,
      case when choice.matched_fuel_type = 'AI_100' and ls.ai100_mode = 'vehicle_count'
        then allocation.ai100_vehicle_remaining - 1 else allocation.ai100_vehicle_remaining end,
      case when choice.matched_fuel_type = 'AI_100' and ls.ai100_mode = 'fuel_liters'
        then allocation.ai100_liters_remaining - o.effective_liters else allocation.ai100_liters_remaining end,
      case when choice.matched_fuel_type = 'DIESEL' and ls.diesel_mode = 'vehicle_count'
        then allocation.diesel_vehicle_remaining - 1 else allocation.diesel_vehicle_remaining end,
      case when choice.matched_fuel_type = 'DIESEL' and ls.diesel_mode = 'fuel_liters'
        then allocation.diesel_liters_remaining - o.effective_liters else allocation.diesel_liters_remaining end,
      case when choice.matched_fuel_type = 'GAS' and ls.gas_mode = 'vehicle_count'
        then allocation.gas_vehicle_remaining - 1 else allocation.gas_vehicle_remaining end,
      case when choice.matched_fuel_type = 'GAS' and ls.gas_mode = 'fuel_liters'
        then allocation.gas_liters_remaining - o.effective_liters else allocation.gas_liters_remaining end
    from allocation
    join ordered o on o.rn = allocation.rn + 1
    cross join limit_state ls
    cross join lateral (
      select case
        when not ls.has_open_daily_limit or o.is_blocked or o.already_fueled then null
        when array_position(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode), 'AI_92') is not null
          and (
            (ls.ai92_mode = 'vehicle_count' and allocation.ai92_vehicle_remaining > 0)
            or (ls.ai92_mode = 'fuel_liters' and allocation.ai92_liters_remaining >= o.effective_liters)
          ) then 'AI_92'
        when array_position(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode), 'AI_95') is not null
          and (
            (ls.ai95_mode = 'vehicle_count' and allocation.ai95_vehicle_remaining > 0)
            or (ls.ai95_mode = 'fuel_liters' and allocation.ai95_liters_remaining >= o.effective_liters)
          ) then 'AI_95'
        when array_position(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode), 'AI_100') is not null
          and (
            (ls.ai100_mode = 'vehicle_count' and allocation.ai100_vehicle_remaining > 0)
            or (ls.ai100_mode = 'fuel_liters' and allocation.ai100_liters_remaining >= o.effective_liters)
          ) then 'AI_100'
        when array_position(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode), 'DIESEL') is not null
          and (
            (ls.diesel_mode = 'vehicle_count' and allocation.diesel_vehicle_remaining > 0)
            or (ls.diesel_mode = 'fuel_liters' and allocation.diesel_liters_remaining >= o.effective_liters)
          ) then 'DIESEL'
        when array_position(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode), 'GAS') is not null
          and (
            (ls.gas_mode = 'vehicle_count' and allocation.gas_vehicle_remaining > 0)
            or (ls.gas_mode = 'fuel_liters' and allocation.gas_liters_remaining >= o.effective_liters)
          ) then 'GAS'
        else null
      end as matched_fuel_type
    ) choice
  ),
  latest_calls as (
    select distinct on (rcl.reservation_id)
      rcl.reservation_id,
      rcl.status
    from public.reservation_call_logs rcl
    order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
  )
  select
    o.id as reservation_id,
    coalesce(a.is_within_today_limit, false) as is_within_today_limit,
    (
      coalesce(a.is_within_today_limit, false)
      and not o.is_blocked
      and not o.already_fueled
      and coalesce(lc.status, 'NOT_CALLED') <> 'CONTACTED'
    ) as is_callable_now,
    case
      when o.is_blocked then 'VEHICLE_BLOCKED'
      when o.already_fueled then 'ALREADY_FUELED'
      when coalesce(lc.status, 'NOT_CALLED') = 'CONTACTED' then 'ALREADY_CONTACTED'
      when not (select has_open_daily_limit from limit_state) then 'NO_OPEN_DAILY_LIMIT'
      when coalesce(a.is_within_today_limit, false) then null
      when not exists (
        select 1
        from public.daily_fuel_type_limits dftl
        join daily_limit dl on dl.id = dftl.daily_limit_id
        where dftl.fuel_type = any(public.get_compatible_fuel_types(o.fuel_type, o.fuel_preference_mode))
          and (
            (dftl.limit_mode = 'vehicle_count' and dftl.vehicle_limit > 0)
            or (dftl.limit_mode = 'fuel_liters' and coalesce(dftl.liters_limit, 0) > 0)
          )
      ) then 'NO_COMPATIBLE_FUEL'
      else 'OUTSIDE_TODAY_LIMIT'
    end as call_unavailable_reason,
    a.matched_fuel_type
  from ordered o
  left join allocation a on a.reservation_id = o.id
  left join latest_calls lc on lc.reservation_id = o.id
  order by o.queue_number asc, o.id asc
$$;

create or replace function public.create_daily_limit(
  target_date date,
  fuel_type_limits jsonb default '[]'::jsonb,
  client_mutation_id uuid default gen_random_uuid()
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
      null,
      1,
      20,
      'OPEN',
      current_profile_id,
      effective_client_mutation_id
    )
    on conflict (date) where station_id is null do update
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
          coalesce(sum(ar.effective_liters) filter (where c.matched_fuel_type = ft.fuel_type and c.is_within_today_limit), 0)::numeric as covered_liters,
          max(ar.queue_number) filter (where c.matched_fuel_type = ft.fuel_type and c.is_within_today_limit) as projected_queue_number
        from fuel_types ft
        left join public.daily_fuel_type_limits dftl
          on dftl.daily_limit_id = daily_limit_row.id
         and dftl.fuel_type = ft.fuel_type
        left join active_reservations ar
          on ft.fuel_type = any(public.get_compatible_fuel_types(ar.fuel_type, ar.fuel_preference_mode))
        left join callable c
          on c.reservation_id = ar.id
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
          'covered_liters', covered_liters,
          'remaining_vehicle_count', case
            when coalesce(limit_mode, 'vehicle_count') = 'vehicle_count' then greatest(vehicle_limit - covered_vehicle_count, 0)
            else null
          end,
          'remaining_liters', case
            when limit_mode = 'fuel_liters' then greatest(coalesce(liters_limit, 0) - covered_liters, 0)
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

create or replace function public.create_reservation(
  plate_number text,
  driver_full_name text,
  driver_phone text,
  fuel_type text,
  requested_liters numeric,
  fuel_preference_mode text default 'EXACT',
  comment text default null,
  client_mutation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_reservation.client_mutation_id, gen_random_uuid());
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  driver_row public.drivers%rowtype;
  existing_reservation_row public.fuel_reservations%rowtype;
  saved_reservation_row public.fuel_reservations%rowtype;
  last_fueling_row public.fueling_records%rowtype;
  cooldown_days integer;
  next_allowed_date date;
  next_queue_number integer;
  effective_fuel_preference_mode text := coalesce(create_reservation.fuel_preference_mode, 'EXACT');
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['mayor_assistant', 'operator', 'station_manager', 'shift_supervisor', 'station_admin', 'mayor']) then
    raise exception 'FORBIDDEN';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  if coalesce(trim(driver_full_name), '') = '' then
    raise exception 'INVALID_DRIVER_FULL_NAME';
  end if;

  if fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if effective_fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  if effective_fuel_preference_mode = 'ANY_GASOLINE' and fuel_type not in ('AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  if requested_liters is null or requested_liters <= 0 then
    raise exception 'INVALID_REQUESTED_LITERS';
  end if;

  perform public.apply_reservation_no_show_policy(current_date - 1);

  select *
  into existing_reservation_row
  from public.fuel_reservations
  where fuel_reservations.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_reservation_row.id is not null then
    return jsonb_build_object(
      'id', existing_reservation_row.id,
      'date', existing_reservation_row.date,
      'station_id', existing_reservation_row.station_id,
      'vehicle_id', existing_reservation_row.vehicle_id,
      'driver_id', existing_reservation_row.driver_id,
      'fuel_type', existing_reservation_row.fuel_type,
      'fuel_preference_mode', existing_reservation_row.fuel_preference_mode,
      'requested_liters', existing_reservation_row.requested_liters,
      'queue_number', existing_reservation_row.queue_number,
      'status', existing_reservation_row.status,
      'client_mutation_id', existing_reservation_row.client_mutation_id
    );
  end if;

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (plate_number, normalized_plate)
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  if vehicle_row.is_blocked then
    raise exception 'VEHICLE_BLOCKED';
  end if;

  cooldown_days := public.get_reservation_refuel_cooldown();

  if cooldown_days > 0 then
    select *
    into last_fueling_row
    from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id
      and fr.is_manual_override = false
    order by fr.date desc, fr.fueled_at desc
    limit 1;

    if last_fueling_row.id is not null then
      next_allowed_date := last_fueling_row.date + cooldown_days;

      if current_date < next_allowed_date then
        raise exception 'REFUEL_COOLDOWN_ACTIVE';
      end if;
    end if;
  end if;

  select *
  into driver_row
  from public.drivers
  where lower(full_name) = lower(trim(driver_full_name))
    and coalesce(phone, '') = coalesce(nullif(trim(driver_phone), ''), '')
  order by created_at asc
  limit 1;

  if driver_row.id is null then
    insert into public.drivers (full_name, phone)
    values (trim(driver_full_name), nullif(trim(driver_phone), ''))
    returning * into driver_row;
  end if;

  if exists (
    select 1
    from public.fuel_reservations fr
    where fr.vehicle_id = vehicle_row.id
      and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ) then
    raise exception 'ACTIVE_RESERVATION_ALREADY_EXISTS';
  end if;

  perform pg_advisory_xact_lock(hashtext('global_reservation_queue'));

  select coalesce(max(queue_number), 0) + 1
  into next_queue_number
  from public.fuel_reservations;

  insert into public.fuel_reservations (
    date,
    station_id,
    vehicle_id,
    driver_id,
    fuel_type,
    fuel_preference_mode,
    requested_liters,
    queue_number,
    status,
    operator_id,
    comment,
    client_mutation_id,
    sync_status
  )
  values (
    null,
    null,
    vehicle_row.id,
    driver_row.id,
    create_reservation.fuel_type,
    effective_fuel_preference_mode,
    requested_liters,
    next_queue_number,
    'RESERVED',
    current_profile_id,
    nullif(trim(comment), ''),
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_reservation_row;

  perform public.audit_action('CREATE_RESERVATION', 'fuel_reservation', saved_reservation_row.id, null, to_jsonb(saved_reservation_row));

  return jsonb_build_object(
    'id', saved_reservation_row.id,
    'date', saved_reservation_row.date,
    'station_id', saved_reservation_row.station_id,
    'vehicle_id', saved_reservation_row.vehicle_id,
    'driver_id', saved_reservation_row.driver_id,
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone,
    'fuel_type', saved_reservation_row.fuel_type,
    'fuel_preference_mode', saved_reservation_row.fuel_preference_mode,
    'requested_liters', saved_reservation_row.requested_liters,
    'queue_number', saved_reservation_row.queue_number,
    'status', saved_reservation_row.status,
    'client_mutation_id', saved_reservation_row.client_mutation_id
  );
end;
$$;

create or replace function public.get_today_call_list(target_date date default current_date)
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

  return coalesce((
    with callable as (
      select *
      from public.get_callable_reservations(target_date)
    ),
    latest_calls as (
      select distinct on (rcl.reservation_id)
        rcl.reservation_id,
        rcl.status,
        rcl.called_by,
        rcl.called_at,
        rcl.comment,
        rcl.client_mutation_id,
        rcl.sync_status
      from public.reservation_call_logs rcl
      order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
    )
    select jsonb_agg(
      jsonb_build_object(
        'id', fr.id,
        'date', fr.date,
        'station_id', fr.station_id,
        'vehicle_id', fr.vehicle_id,
        'driver_id', fr.driver_id,
        'operator_id', fr.operator_id,
        'fuel_type', fr.fuel_type,
        'preferred_fuel_type', fr.fuel_type,
        'fuel_preference_mode', fr.fuel_preference_mode,
        'fuel_category', public.get_fuel_queue_category(fr.fuel_type),
        'requested_liters', fr.requested_liters,
        'effective_liters', coalesce(pvll.liters, fr.requested_liters, 20),
        'queue_number', fr.queue_number,
        'status', fr.status,
        'comment', fr.comment,
        'client_mutation_id', fr.client_mutation_id,
        'sync_status', fr.sync_status,
        'created_at', fr.created_at,
        'updated_at', fr.updated_at,
        'is_within_today_limit', coalesce(c.is_within_today_limit, false),
        'is_callable_now', coalesce(c.is_callable_now, false),
        'call_unavailable_reason', c.call_unavailable_reason,
        'matched_fuel_type', c.matched_fuel_type,
        'normalized_plate_number', v.normalized_plate_number,
        'driver_full_name', d.full_name,
        'driver_phone', d.phone,
        'created_by_full_name', op.full_name,
        'created_by_role', op.role,
        'created_by_signature_name', op.signature_name,
        'latest_call_status', lc.status,
        'latest_called_by_profile_id', lc.called_by,
        'latest_called_by_full_name', cp.full_name,
        'latest_called_by_role', cp.role,
        'latest_called_by_signature_name', cp.signature_name,
        'latest_called_at', lc.called_at,
        'latest_call_comment', lc.comment,
        'latest_call_client_mutation_id', lc.client_mutation_id,
        'latest_call_sync_status', lc.sync_status
      )
      order by fr.queue_number asc, fr.id asc
    )
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.drivers d on d.id = fr.driver_id
    left join public.profiles op on op.id = fr.operator_id
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = target_date
    left join callable c on c.reservation_id = fr.id
    left join latest_calls lc on lc.reservation_id = fr.id
    left join public.profiles cp on cp.id = lc.called_by
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by fr.queue_number asc, fr.id asc
  ), '[]'::jsonb);
end;
$$;

create or replace function public.create_reservation_call_log(
  reservation_id uuid,
  status text,
  comment text default null,
  client_mutation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_reservation_call_log.client_mutation_id, gen_random_uuid());
  existing_call_row public.reservation_call_logs%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  callable_row record;
  saved_call_row public.reservation_call_logs%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if create_reservation_call_log.status not in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER', 'CALL_LATER', 'WRONG_NUMBER') then
    raise exception 'INVALID_CALL_STATUS';
  end if;

  select *
  into existing_call_row
  from public.reservation_call_logs rcl
  where rcl.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_call_row.id is not null then
    return public.reservation_call_log_to_json(existing_call_row);
  end if;

  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.id = create_reservation_call_log.reservation_id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  limit 1;

  if reservation_row.id is null then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  if create_reservation_call_log.status = 'CONTACTED' then
    select *
    into callable_row
    from public.get_callable_reservations(current_date) cr
    where cr.reservation_id = create_reservation_call_log.reservation_id
    limit 1;

    if callable_row.reservation_id is null or callable_row.is_callable_now is not true then
      raise exception 'RESERVATION_NOT_CALLABLE';
    end if;
  end if;

  insert into public.reservation_call_logs (
    reservation_id,
    status,
    called_by,
    comment,
    client_mutation_id,
    sync_status
  )
  values (
    create_reservation_call_log.reservation_id,
    create_reservation_call_log.status,
    current_profile_id,
    nullif(trim(coalesce(create_reservation_call_log.comment, '')), ''),
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_call_row;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, new_value)
  values (
    current_profile_id,
    'CREATE_RESERVATION_CALL_LOG',
    'reservation_call_log',
    saved_call_row.id,
    public.reservation_call_log_to_json(saved_call_row)
  );

  return public.reservation_call_log_to_json(saved_call_row);
end;
$$;

create or replace function public.check_public_queue_position(
  plate_number text,
  phone_last4 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  max_attempts integer := 5;
  normalized_plate text;
  normalized_phone_last4 text;
  request_headers_text text;
  request_headers jsonb := '{}'::jsonb;
  raw_ip text;
  current_ip_key text;
  current_lookup_key text;
  current_attempt_date date := (now() at time zone 'Europe/Moscow')::date;
  ip_attempt_count integer;
  lookup_attempt_count integer;
  used_attempt_count integer;
  remaining_attempts integer;
  matched_record record;
begin
  normalized_plate := public.normalize_plate_number(plate_number);
  normalized_phone_last4 := regexp_replace(coalesce(phone_last4, ''), '\D', '', 'g');

  if normalized_plate !~ '^[АВЕКМНОРСТУХ][0-9]{3}[АВЕКМНОРСТУХ]{2}[0-9]{2,3}$'
    or normalized_phone_last4 !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'status', 'INVALID_INPUT',
      'queue_number', null,
      'preferred_fuel_type', null,
      'fuel_preference_mode', null,
      'public_status', 'INVALID_INPUT',
      'is_within_today_limit', null,
      'is_callable_now', null,
      'matched_fuel_type', null,
      'remaining_attempts', 0
    );
  end if;

  request_headers_text := current_setting('request.headers', true);

  if coalesce(request_headers_text, '') <> '' then
    request_headers := request_headers_text::jsonb;
  end if;

  raw_ip := coalesce(
    nullif(trim(split_part(coalesce(request_headers->>'x-forwarded-for', ''), ',', 1)), ''),
    nullif(trim(coalesce(request_headers->>'cf-connecting-ip', '')), ''),
    nullif(trim(coalesce(request_headers->>'x-real-ip', '')), ''),
    'unknown'
  );
  current_ip_key := encode(digest(raw_ip, 'sha256'), 'hex');
  current_lookup_key := encode(digest(normalized_plate || ':' || normalized_phone_last4, 'sha256'), 'hex');

  select count(*)::integer
  into ip_attempt_count
  from public.public_queue_check_attempts attempts
  where attempts.attempt_date = current_attempt_date
    and attempts.ip_key = current_ip_key;

  select count(*)::integer
  into lookup_attempt_count
  from public.public_queue_check_attempts attempts
  where attempts.attempt_date = current_attempt_date
    and attempts.lookup_key = current_lookup_key;

  if ip_attempt_count >= max_attempts or lookup_attempt_count >= max_attempts then
    return jsonb_build_object(
      'status', 'LIMIT_EXCEEDED',
      'queue_number', null,
      'preferred_fuel_type', null,
      'fuel_preference_mode', null,
      'public_status', 'LIMIT_EXCEEDED',
      'is_within_today_limit', null,
      'is_callable_now', null,
      'matched_fuel_type', null,
      'remaining_attempts', 0
    );
  end if;

  insert into public.public_queue_check_attempts (attempt_date, ip_key, lookup_key)
  values (current_attempt_date, current_ip_key, current_lookup_key);

  used_attempt_count := greatest(ip_attempt_count + 1, lookup_attempt_count + 1);
  remaining_attempts := greatest(max_attempts - used_attempt_count, 0);

  with latest_calls as (
    select distinct on (rcl.reservation_id)
      rcl.reservation_id,
      rcl.status
    from public.reservation_call_logs rcl
    order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
  )
  select
    fr.queue_number,
    fr.fuel_type as preferred_fuel_type,
    fr.fuel_preference_mode,
    coalesce(c.is_within_today_limit, false) as is_within_today_limit,
    coalesce(c.is_callable_now, false) as is_callable_now,
    c.call_unavailable_reason,
    c.matched_fuel_type,
    lc.status as latest_call_status,
    fr.status as reservation_status
  into matched_record
  from public.fuel_reservations fr
  join public.vehicles v on v.id = fr.vehicle_id
  join public.drivers d on d.id = fr.driver_id
  left join public.get_callable_reservations(current_attempt_date) c on c.reservation_id = fr.id
  left join latest_calls lc on lc.reservation_id = fr.id
  where v.normalized_plate_number = normalized_plate
    and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 4) = normalized_phone_last4
  order by
    case when fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING') then 0 else 1 end,
    fr.queue_number asc,
    fr.id asc
  limit 1;

  if matched_record.queue_number is null then
    return jsonb_build_object(
      'status', 'NOT_FOUND',
      'queue_number', null,
      'preferred_fuel_type', null,
      'fuel_preference_mode', null,
      'public_status', 'NOT_FOUND',
      'is_within_today_limit', null,
      'is_callable_now', null,
      'matched_fuel_type', null,
      'remaining_attempts', remaining_attempts
    );
  end if;

  return jsonb_build_object(
    'status', 'FOUND',
    'queue_number', matched_record.queue_number,
    'preferred_fuel_type', matched_record.preferred_fuel_type,
    'fuel_preference_mode', matched_record.fuel_preference_mode,
    'public_status', case
      when matched_record.reservation_status in ('FUELED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'REJECTED') then 'COMPLETED_OR_CANCELLED'
      when matched_record.latest_call_status = 'CONTACTED' then 'INVITED_BY_OPERATOR'
      when matched_record.is_callable_now then 'IN_CALL_LIST'
      when matched_record.call_unavailable_reason = 'NO_COMPATIBLE_FUEL' then 'WAITING_FOR_PREFERRED_FUEL'
      when matched_record.is_within_today_limit then 'WAIT_FOR_CALL'
      else 'QUEUE_NOT_READY'
    end,
    'is_within_today_limit', matched_record.is_within_today_limit,
    'is_callable_now', matched_record.is_callable_now,
    'matched_fuel_type', matched_record.matched_fuel_type,
    'remaining_attempts', remaining_attempts
  );
end;
$$;

create or replace function public.is_reservation_callable_on_date(
  reservation_id uuid,
  target_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select cr.is_within_today_limit
    from public.get_callable_reservations(target_date) cr
    where cr.reservation_id = is_reservation_callable_on_date.reservation_id
    limit 1
  ), false)
$$;

create or replace function public.is_reservation_covered_by_daily_limit(
  reservation_id uuid,
  target_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_reservation_callable_on_date(reservation_id, target_date)
$$;

create or replace function public.apply_reservation_no_show_policy(
  target_date date default current_date - 1
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  grace_days integer;
  first_process_date date;
  process_date date;
  updated_count integer := 0;
  marked_count integer := 0;
  process_updated_count integer;
  process_marked_count integer;
  marked_row public.fuel_reservations%rowtype;
begin
  if target_date is null or target_date >= current_date then
    target_date := current_date - 1;
  end if;

  grace_days := public.get_reservation_no_show_grace_days();

  if grace_days <= 0 then
    return jsonb_build_object(
      'status', 'SKIPPED',
      'reason', 'NO_SHOW_GRACE_DISABLED',
      'target_date', target_date,
      'updated_count', 0,
      'marked_count', 0
    );
  end if;

  select min(greatest(fr.created_at::date, coalesce(fr.last_missed_fueling_date + 1, fr.created_at::date)))
  into first_process_date
  from public.fuel_reservations fr
  where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    and fr.created_at::date <= target_date
    and (
      fr.last_missed_fueling_date is null
      or fr.last_missed_fueling_date < target_date
    );

  if first_process_date is null then
    return jsonb_build_object('status', 'SYNCED', 'target_date', target_date, 'updated_count', 0, 'marked_count', 0);
  end if;

  create temporary table if not exists reservation_no_show_marked_ids (
    id uuid primary key
  ) on commit drop;

  for process_date in
    select generate_series(first_process_date, target_date, interval '1 day')::date
  loop
    truncate table reservation_no_show_marked_ids;

    with confirmed_misses as (
      select fr.id
      from public.fuel_reservations fr
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
        and fr.created_at::date <= process_date
        and (
          fr.last_missed_fueling_date is null
          or fr.last_missed_fueling_date < process_date
        )
        and not exists (
          select 1
          from public.fueling_records fueling
          where fueling.reservation_id = fr.id
            and fueling.date = process_date
        )
        and exists (
          select 1
          from public.reservation_call_logs rcl
          where rcl.reservation_id = fr.id
            and rcl.status = 'CONTACTED'
            and rcl.called_at::date <= process_date
        )
        and public.is_reservation_callable_on_date(fr.id, process_date)
    ),
    updated as (
      update public.fuel_reservations fr
      set missed_fueling_days = fr.missed_fueling_days + 1,
          last_missed_fueling_date = process_date
      from confirmed_misses cm
      where fr.id = cm.id
      returning fr.*
    ),
    marked as (
      update public.fuel_reservations fr
      set status = 'NO_SHOW',
          sync_status = 'SYNCED'
      from updated u
      where fr.id = u.id
        and u.missed_fueling_days >= grace_days
      returning fr.*
    ),
    marked_ids as (
      insert into reservation_no_show_marked_ids (id)
      select marked.id
      from marked
      on conflict (id) do nothing
      returning id
    )
    select
      (select count(*) from updated)::integer,
      (select count(*) from marked_ids)::integer
    into process_updated_count, process_marked_count;

    updated_count := updated_count + process_updated_count;
    marked_count := marked_count + process_marked_count;

    for marked_row in
      select fr.*
      from public.fuel_reservations fr
      inner join reservation_no_show_marked_ids marked_ids on marked_ids.id = fr.id
    loop
      perform public.audit_action('AUTO_MARK_RESERVATION_NO_SHOW', 'fuel_reservation', marked_row.id, null, to_jsonb(marked_row));
    end loop;
  end loop;

  return jsonb_build_object(
    'status', 'SYNCED',
    'target_date', target_date,
    'updated_count', updated_count,
    'marked_count', marked_count
  );
end;
$$;

create or replace function public.update_reservation_fuel_preference(
  reservation_id uuid,
  fuel_type text,
  fuel_preference_mode text,
  comment text default null,
  client_mutation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  reservation_row public.fuel_reservations%rowtype;
  updated_row public.fuel_reservations%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['mayor_assistant', 'operator', 'station_manager', 'shift_supervisor', 'station_admin', 'mayor']) then
    raise exception 'FORBIDDEN';
  end if;

  if update_reservation_fuel_preference.fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  if update_reservation_fuel_preference.fuel_preference_mode not in ('EXACT', 'ANY_GASOLINE') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  if update_reservation_fuel_preference.fuel_preference_mode = 'ANY_GASOLINE'
    and update_reservation_fuel_preference.fuel_type not in ('AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_FUEL_PREFERENCE_MODE';
  end if;

  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.id = update_reservation_fuel_preference.reservation_id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  for update;

  if reservation_row.id is null then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  update public.fuel_reservations
  set fuel_type = update_reservation_fuel_preference.fuel_type,
      fuel_preference_mode = update_reservation_fuel_preference.fuel_preference_mode,
      comment = coalesce(nullif(trim(update_reservation_fuel_preference.comment), ''), comment)
  where id = reservation_row.id
  returning * into updated_row;

  perform public.audit_action(
    'UPDATE_RESERVATION_FUEL_PREFERENCE',
    'fuel_reservation',
    updated_row.id,
    to_jsonb(reservation_row),
    to_jsonb(updated_row)
  );

  return jsonb_build_object(
    'id', updated_row.id,
    'fuel_type', updated_row.fuel_type,
    'fuel_preference_mode', updated_row.fuel_preference_mode,
    'queue_number', updated_row.queue_number,
    'status', updated_row.status
  );
end;
$$;

create or replace function public.sync_offline_mutation(
  client_mutation_id uuid,
  operation_type text,
  payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if operation_type = 'CREATE_RESERVATION' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_reservation(
        payload->>'plate_number',
        payload->>'driver_full_name',
        payload->>'driver_phone',
        payload->>'fuel_type',
        (payload->>'requested_liters')::numeric,
        coalesce(payload->>'fuel_preference_mode', 'EXACT'),
        payload->>'comment',
        client_mutation_id
      )
    );
  end if;

  if operation_type = 'CREATE_FUELING_RECORD' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_fueling_record(
        (payload->>'station_id')::uuid,
        payload->>'plate_number',
        (payload->>'liters')::numeric,
        payload->>'fuel_type',
        (payload->>'target_date')::date,
        (payload->>'fueled_at')::timestamptz,
        payload->>'comment',
        client_mutation_id
      )
    );
  end if;

  if operation_type = 'CREATE_MANUAL_OVERRIDE' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_manual_override(
        (payload->>'target_date')::date,
        (payload->>'station_id')::uuid,
        payload->>'plate_number',
        payload->>'reason',
        nullif(payload->>'expires_at', '')::timestamptz,
        client_mutation_id
      )
    );
  end if;

  if operation_type = 'CREATE_RESERVATION_CALL_LOG' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_reservation_call_log(
        (payload->>'reservation_id')::uuid,
        payload->>'status',
        payload->>'comment',
        client_mutation_id
      )
    );
  end if;

  raise exception 'UNSUPPORTED_OFFLINE_OPERATION';
exception
  when others then
    return jsonb_build_object(
      'status', 'CONFLICT',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'reason', sqlerrm,
      'payload', payload
    );
end;
$$;

grant execute on function public.get_compatible_fuel_types(text, text) to authenticated, anon;
grant execute on function public.get_fuel_preference_label(text, text) to authenticated;
grant execute on function public.get_callable_reservations(date) to authenticated;
grant execute on function public.create_daily_limit(date, jsonb, uuid) to authenticated;
grant execute on function public.get_daily_limit_overview(date) to authenticated;
grant execute on function public.create_reservation(text, text, text, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.get_today_call_list(date) to authenticated;
grant execute on function public.create_reservation_call_log(uuid, text, text, uuid) to authenticated;
grant execute on function public.check_public_queue_position(text, text) to anon, authenticated;
grant execute on function public.is_reservation_callable_on_date(uuid, date) to authenticated;
grant execute on function public.is_reservation_covered_by_daily_limit(uuid, date) to authenticated;
grant execute on function public.apply_reservation_no_show_policy(date) to authenticated;
grant execute on function public.update_reservation_fuel_preference(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.sync_offline_mutation(uuid, text, jsonb) to authenticated;
