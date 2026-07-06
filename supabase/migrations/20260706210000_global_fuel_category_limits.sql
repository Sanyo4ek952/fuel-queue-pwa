set check_function_bodies = off;
set search_path = public, extensions;

alter table public.daily_limits
  alter column station_id drop not null;

alter table public.daily_fuel_type_limits
  add column if not exists fuel_category text,
  add column if not exists limit_mode text not null default 'vehicle_count';

update public.daily_fuel_type_limits
set fuel_category = case
  when fuel_type in ('AI_92', 'AI_95', 'AI_100') then 'GASOLINE'
  when fuel_type = 'DIESEL' then 'DIESEL'
  when fuel_type = 'GAS' then 'GAS'
  else 'GASOLINE'
end
where fuel_category is null;

create temporary table daily_fuel_category_limit_rollup on commit drop as
select
  daily_limit_id,
  fuel_category,
  case fuel_category
    when 'GASOLINE' then 'AI_92'
    when 'DIESEL' then 'DIESEL'
    when 'GAS' then 'GAS'
    else 'AI_92'
  end as fuel_type,
  (array_agg(
    id
    order by
      case
        when fuel_category = 'GASOLINE' and fuel_type = 'AI_92' then 0
        when fuel_category = 'DIESEL' and fuel_type = 'DIESEL' then 0
        when fuel_category = 'GAS' and fuel_type = 'GAS' then 0
        else 1
      end,
      created_at asc,
      id asc
  ))[1] as keep_id,
  sum(vehicle_limit)::integer as vehicle_limit,
  case
    when count(liters_limit) = 0 then null
    else sum(coalesce(liters_limit, 0))
  end as liters_limit,
  min(created_at) as created_at,
  max(updated_at) as updated_at
from public.daily_fuel_type_limits
group by daily_limit_id, fuel_category;

delete from public.daily_fuel_type_limits dftl
using daily_fuel_category_limit_rollup rollup
where dftl.daily_limit_id = rollup.daily_limit_id
  and dftl.fuel_category = rollup.fuel_category
  and dftl.id <> rollup.keep_id;

update public.daily_fuel_type_limits dftl
set fuel_type = rollup.fuel_type,
    vehicle_limit = rollup.vehicle_limit,
    liters_limit = rollup.liters_limit,
    created_at = rollup.created_at,
    updated_at = rollup.updated_at
from daily_fuel_category_limit_rollup rollup
where dftl.id = rollup.keep_id;

alter table public.daily_fuel_type_limits
  alter column fuel_category set not null;

alter table public.daily_fuel_type_limits
  drop constraint if exists daily_fuel_type_limits_fuel_category_check,
  add constraint daily_fuel_type_limits_fuel_category_check
    check (fuel_category in ('GASOLINE', 'DIESEL', 'GAS')),
  drop constraint if exists daily_fuel_type_limits_limit_mode_check,
  add constraint daily_fuel_type_limits_limit_mode_check
    check (limit_mode in ('vehicle_count', 'fuel_liters'));

drop index if exists public.daily_limits_global_date_unique;
create unique index daily_limits_global_date_unique
on public.daily_limits (date)
where station_id is null;

drop index if exists public.daily_fuel_category_limits_unique;
create unique index daily_fuel_category_limits_unique
on public.daily_fuel_type_limits (daily_limit_id, fuel_category);

create table if not exists public.personal_vehicle_liter_limits (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  vehicle_id uuid not null references public.vehicles(id),
  liters numeric(10, 2) not null check (liters > 0),
  approved_by uuid not null references public.profiles(id),
  comment text,
  client_mutation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, vehicle_id),
  unique (client_mutation_id)
);

drop trigger if exists set_personal_vehicle_liter_limits_updated_at on public.personal_vehicle_liter_limits;
create trigger set_personal_vehicle_liter_limits_updated_at
before update on public.personal_vehicle_liter_limits
for each row execute function public.set_updated_at();

alter table public.personal_vehicle_liter_limits enable row level security;

drop policy if exists personal_vehicle_liter_limits_select_authenticated on public.personal_vehicle_liter_limits;
create policy personal_vehicle_liter_limits_select_authenticated
on public.personal_vehicle_liter_limits
for select
to authenticated
using (public.get_current_profile_id() is not null);

create or replace function public.get_fuel_queue_category(fuel_type text)
returns text
language sql
immutable
as $$
  select case
    when fuel_type in ('AI_92', 'AI_95', 'AI_100') then 'GASOLINE'
    when fuel_type = 'DIESEL' then 'DIESEL'
    when fuel_type = 'GAS' then 'GAS'
    else 'OTHER'
  end
$$;

create or replace function public.create_daily_limit(
  target_date date,
  gasoline_limit_mode text,
  gasoline_vehicle_limit integer,
  gasoline_liters_limit numeric,
  diesel_limit_mode text,
  diesel_vehicle_limit integer,
  diesel_liters_limit numeric,
  gas_limit_mode text,
  gas_vehicle_limit integer,
  gas_liters_limit numeric,
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
  categories jsonb;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if gasoline_limit_mode not in ('vehicle_count', 'fuel_liters')
    or diesel_limit_mode not in ('vehicle_count', 'fuel_liters')
    or gas_limit_mode not in ('vehicle_count', 'fuel_liters') then
    raise exception 'INVALID_LIMIT_MODE';
  end if;

  if (gasoline_limit_mode = 'vehicle_count' and coalesce(gasoline_vehicle_limit, 0) <= 0)
    or (diesel_limit_mode = 'vehicle_count' and coalesce(diesel_vehicle_limit, 0) <= 0)
    or (gas_limit_mode = 'vehicle_count' and coalesce(gas_vehicle_limit, 0) <= 0) then
    raise exception 'INVALID_VEHICLE_LIMIT';
  end if;

  if (gasoline_limit_mode = 'fuel_liters' and coalesce(gasoline_liters_limit, 0) <= 0)
    or (diesel_limit_mode = 'fuel_liters' and coalesce(diesel_liters_limit, 0) <= 0)
    or (gas_limit_mode = 'fuel_liters' and coalesce(gas_liters_limit, 0) <= 0) then
    raise exception 'INVALID_LITERS_LIMIT';
  end if;

  select *
  into existing_limit_row
  from public.daily_limits
  where daily_limits.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_limit_row.id is not null then
    saved_limit_row := existing_limit_row;
  else
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
      greatest(
        coalesce(gasoline_vehicle_limit, 0),
        coalesce(diesel_vehicle_limit, 0),
        coalesce(gas_vehicle_limit, 0),
        1
      ),
      20,
      'OPEN',
      current_profile_id,
      effective_client_mutation_id
    )
    on conflict (date) where station_id is null do update
    set total_vehicle_limit = excluded.total_vehicle_limit,
        max_liters_per_vehicle = excluded.max_liters_per_vehicle,
        status = 'OPEN',
        created_by = excluded.created_by,
        client_mutation_id = excluded.client_mutation_id
    returning * into saved_limit_row;
  end if;

  insert into public.daily_fuel_type_limits (
    daily_limit_id,
    fuel_type,
    fuel_category,
    limit_mode,
    vehicle_limit,
    liters_limit
  )
  values
    (saved_limit_row.id, 'AI_95', 'GASOLINE', gasoline_limit_mode, coalesce(gasoline_vehicle_limit, 0), gasoline_liters_limit),
    (saved_limit_row.id, 'DIESEL', 'DIESEL', diesel_limit_mode, coalesce(diesel_vehicle_limit, 0), diesel_liters_limit),
    (saved_limit_row.id, 'GAS', 'GAS', gas_limit_mode, coalesce(gas_vehicle_limit, 0), gas_liters_limit)
  on conflict (daily_limit_id, fuel_category) do update
  set limit_mode = excluded.limit_mode,
      vehicle_limit = excluded.vehicle_limit,
      liters_limit = excluded.liters_limit;

  perform public.audit_action(
    'CREATE_DAILY_LIMIT',
    'daily_limit',
    saved_limit_row.id,
    null,
    to_jsonb(saved_limit_row)
  );

  select jsonb_agg(
    jsonb_build_object(
      'fuel_category', dftl.fuel_category,
      'limit_mode', dftl.limit_mode,
      'vehicle_limit', dftl.vehicle_limit,
      'liters_limit', dftl.liters_limit
    )
    order by case dftl.fuel_category when 'GASOLINE' then 1 when 'DIESEL' then 2 else 3 end
  )
  into categories
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = saved_limit_row.id
    and dftl.fuel_category in ('GASOLINE', 'DIESEL', 'GAS');

  return jsonb_build_object(
    'id', saved_limit_row.id,
    'date', saved_limit_row.date,
    'station_id', saved_limit_row.station_id,
    'status', saved_limit_row.status,
    'client_mutation_id', saved_limit_row.client_mutation_id,
    'category_limits', coalesce(categories, '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_personal_vehicle_liter_limit(
  target_date date,
  plate_number text,
  liters numeric,
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
  current_role text;
  effective_client_mutation_id uuid := coalesce(create_personal_vehicle_liter_limit.client_mutation_id, gen_random_uuid());
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  saved_limit_row public.personal_vehicle_liter_limits%rowtype;
begin
  current_profile_id := public.get_current_profile_id();
  current_role := public.get_current_user_role();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or current_role not in ('mayor', 'mayor_assistant') then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  if liters is null or liters <= 0 then
    raise exception 'INVALID_LITERS';
  end if;

  select *
  into saved_limit_row
  from public.personal_vehicle_liter_limits
  where personal_vehicle_liter_limits.client_mutation_id = effective_client_mutation_id
  limit 1;

  if saved_limit_row.id is not null then
    return jsonb_build_object(
      'id', saved_limit_row.id,
      'date', saved_limit_row.date,
      'vehicle_id', saved_limit_row.vehicle_id,
      'normalized_plate_number', normalized_plate,
      'liters', saved_limit_row.liters,
      'comment', saved_limit_row.comment,
      'client_mutation_id', saved_limit_row.client_mutation_id
    );
  end if;

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (plate_number, normalized_plate)
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  insert into public.personal_vehicle_liter_limits (
    date,
    vehicle_id,
    liters,
    approved_by,
    comment,
    client_mutation_id
  )
  values (
    target_date,
    vehicle_row.id,
    liters,
    current_profile_id,
    nullif(trim(comment), ''),
    effective_client_mutation_id
  )
  on conflict (date, vehicle_id) do update
  set liters = excluded.liters,
      approved_by = excluded.approved_by,
      comment = excluded.comment,
      client_mutation_id = excluded.client_mutation_id
  returning * into saved_limit_row;

  perform public.audit_action(
    'CREATE_PERSONAL_VEHICLE_LITER_LIMIT',
    'personal_vehicle_liter_limit',
    saved_limit_row.id,
    null,
    to_jsonb(saved_limit_row)
  );

  return jsonb_build_object(
    'id', saved_limit_row.id,
    'date', saved_limit_row.date,
    'vehicle_id', saved_limit_row.vehicle_id,
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'liters', saved_limit_row.liters,
    'comment', saved_limit_row.comment,
    'client_mutation_id', saved_limit_row.client_mutation_id
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
      with categories(fuel_category, label, sort_order) as (
        values
          ('GASOLINE', 'Бензин', 1),
          ('DIESEL', 'Дизель', 2),
          ('GAS', 'Газ', 3)
      ),
      active_reservations as (
        select
          fr.id,
          fr.vehicle_id,
          fr.fuel_type,
          public.get_fuel_queue_category(fr.fuel_type) as fuel_category,
          fr.requested_liters,
          coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
          fr.queue_number
        from public.fuel_reservations fr
        left join public.personal_vehicle_liter_limits pvll
          on pvll.vehicle_id = fr.vehicle_id
         and pvll.date = target_date
        where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
          and public.get_fuel_queue_category(fr.fuel_type) in ('GASOLINE', 'DIESEL', 'GAS')
      ),
      ranked as (
        select
          ar.*,
          row_number() over (partition by ar.fuel_category order by ar.queue_number asc, ar.id asc)::integer as category_position,
          sum(ar.effective_liters) over (partition by ar.fuel_category order by ar.queue_number asc, ar.id asc)::numeric as category_liters
        from active_reservations ar
      ),
      projected as (
        select
          r.*,
          dftl.limit_mode,
          dftl.vehicle_limit,
          dftl.liters_limit,
          (
            (dftl.limit_mode = 'vehicle_count' and r.category_position <= dftl.vehicle_limit)
            or (dftl.limit_mode = 'fuel_liters' and r.category_liters <= coalesce(dftl.liters_limit, 0))
          ) as is_covered
        from ranked r
        join public.daily_fuel_type_limits dftl
          on dftl.daily_limit_id = daily_limit_row.id
         and dftl.fuel_category = r.fuel_category
      ),
      grouped as (
        select
          c.fuel_category,
          c.label,
          c.sort_order,
          dftl.limit_mode,
          coalesce(dftl.vehicle_limit, 0) as vehicle_limit,
          dftl.liters_limit,
          count(r.id)::integer as queue_count,
          coalesce(sum(r.effective_liters), 0)::numeric as queued_liters,
          count(p.id) filter (where p.is_covered)::integer as covered_vehicle_count,
          coalesce(sum(p.effective_liters) filter (where p.is_covered), 0)::numeric as covered_liters,
          max(p.queue_number) filter (where p.is_covered) as projected_queue_number
        from categories c
        left join public.daily_fuel_type_limits dftl
          on dftl.daily_limit_id = daily_limit_row.id
         and dftl.fuel_category = c.fuel_category
        left join ranked r
          on r.fuel_category = c.fuel_category
        left join projected p
          on p.id = r.id
        group by c.fuel_category, c.label, c.sort_order, dftl.limit_mode, dftl.vehicle_limit, dftl.liters_limit
      )
      select jsonb_agg(
        jsonb_build_object(
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
    'updated_at', daily_limit_row.updated_at
  );
end;
$$;

create or replace function public.check_vehicle_access(
  plate_number text,
  station_id uuid,
  check_date date default current_date
)
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
  reservation_row public.fuel_reservations%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  last_fueling_row public.fueling_records%rowtype;
  daily_limit_row public.daily_limits%rowtype;
  category_limit_row public.daily_fuel_type_limits%rowtype;
  queue_category text;
  category_position integer;
  category_liters numeric;
  effective_liters numeric;
  is_covered boolean := false;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'PROFILE_NOT_FOUND', 'normalized_plate_number', normalized_plate);
  end if;

  if normalized_plate = '' then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'INVALID_PLATE_NUMBER', 'normalized_plate_number', normalized_plate);
  end if;

  if not public.can_access_station(station_id) then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'STATION_ACCESS_DENIED', 'normalized_plate_number', normalized_plate, 'station_id', station_id, 'date', check_date);
  end if;

  select * into vehicle_row
  from public.vehicles v
  where v.normalized_plate_number = normalized_plate
  limit 1;

  if vehicle_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate, 'station_id', station_id, 'date', check_date);
  end if;

  select * into manual_override_row
  from public.manual_overrides mo
  where mo.vehicle_id = vehicle_row.id
    and mo.station_id = check_vehicle_access.station_id
    and mo.date = check_vehicle_access.check_date
    and mo.used_at is null
    and (mo.expires_at is null or mo.expires_at > now())
  order by mo.created_at desc
  limit 1;

  if vehicle_row.is_blocked and manual_override_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'VEHICLE_BLOCKED', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'block_reason', vehicle_row.block_reason);
  end if;

  select * into last_fueling_row
  from public.fueling_records fr
  where fr.vehicle_id = vehicle_row.id
    and fr.date = check_vehicle_access.check_date
    and fr.is_manual_override = false
  order by fr.fueled_at desc
  limit 1;

  if last_fueling_row.id is not null and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'ALREADY_FUELED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'last_fueling_record_id', last_fueling_row.id,
      'last_fueling_station_id', last_fueling_row.station_id,
      'last_fueled_at', last_fueling_row.fueled_at
    );
  end if;

  select * into reservation_row
  from public.fuel_reservations fr
  where fr.vehicle_id = vehicle_row.id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  order by fr.queue_number asc
  limit 1;

  if reservation_row.id is null then
    if manual_override_row.id is not null then
      return jsonb_build_object(
        'status', 'ALLOWED',
        'reason', 'MANUAL_OVERRIDE_ACTIVE',
        'normalized_plate_number', normalized_plate,
        'vehicle_id', vehicle_row.id,
        'manual_override_id', manual_override_row.id,
        'station_id', station_id,
        'date', check_date
      );
    end if;

    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_ACTIVE_RESERVATION', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'station_id', station_id, 'date', check_date);
  end if;

  if manual_override_row.id is not null then
    return jsonb_build_object(
      'status', 'ALLOWED',
      'reason', 'MANUAL_OVERRIDE_ACTIVE',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'fuel_category', public.get_fuel_queue_category(reservation_row.fuel_type),
      'requested_liters', reservation_row.requested_liters,
      'manual_override_id', manual_override_row.id
    );
  end if;

  queue_category := public.get_fuel_queue_category(reservation_row.fuel_type);

  if queue_category = 'OTHER' then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'OUTSIDE_TODAY_LIMIT', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'reservation_id', reservation_row.id, 'station_id', station_id, 'date', check_date, 'queue_number', reservation_row.queue_number, 'fuel_type', reservation_row.fuel_type);
  end if;

  select * into daily_limit_row
  from public.daily_limits dl
  where dl.date = check_vehicle_access.check_date
    and dl.station_id is null
    and dl.status = 'OPEN'
  limit 1;

  if daily_limit_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'NO_GLOBAL_DAILY_LIMIT', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'reservation_id', reservation_row.id, 'station_id', station_id, 'date', check_date, 'queue_number', reservation_row.queue_number, 'fuel_type', reservation_row.fuel_type, 'fuel_category', queue_category);
  end if;

  select * into category_limit_row
  from public.daily_fuel_type_limits dftl
  where dftl.daily_limit_id = daily_limit_row.id
    and dftl.fuel_category = queue_category
  limit 1;

  if category_limit_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'OUTSIDE_TODAY_LIMIT', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'reservation_id', reservation_row.id, 'station_id', station_id, 'date', check_date, 'queue_number', reservation_row.queue_number, 'fuel_type', reservation_row.fuel_type, 'fuel_category', queue_category);
  end if;

  with active_reservations as (
    select
      fr.id,
      fr.vehicle_id,
      fr.queue_number,
      coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters
    from public.fuel_reservations fr
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = check_vehicle_access.check_date
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
      and public.get_fuel_queue_category(fr.fuel_type) = queue_category
  ),
  ranked as (
    select
      ar.*,
      row_number() over (order by ar.queue_number asc, ar.id asc)::integer as category_position,
      sum(ar.effective_liters) over (order by ar.queue_number asc, ar.id asc)::numeric as category_liters
    from active_reservations ar
  )
  select r.category_position, r.category_liters, r.effective_liters
  into category_position, category_liters, effective_liters
  from ranked r
  where r.id = reservation_row.id;

  is_covered :=
    (category_limit_row.limit_mode = 'vehicle_count' and category_position <= category_limit_row.vehicle_limit)
    or (category_limit_row.limit_mode = 'fuel_liters' and category_liters <= coalesce(category_limit_row.liters_limit, 0));

  if not is_covered then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'OUTSIDE_TODAY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date,
      'queue_number', reservation_row.queue_number,
      'fuel_type', reservation_row.fuel_type,
      'fuel_category', queue_category,
      'effective_liters', effective_liters,
      'category_position', category_position,
      'category_liters', category_liters
    );
  end if;

  return jsonb_build_object(
    'status', 'ALLOWED',
    'reason', 'ACTIVE_RESERVATION',
    'normalized_plate_number', normalized_plate,
    'vehicle_id', vehicle_row.id,
    'reservation_id', reservation_row.id,
    'station_id', station_id,
    'date', check_date,
    'queue_number', reservation_row.queue_number,
    'fuel_type', reservation_row.fuel_type,
    'fuel_category', queue_category,
    'requested_liters', reservation_row.requested_liters,
    'effective_liters', effective_liters,
    'category_position', category_position,
    'category_liters', category_liters
  );
end;
$$;

create or replace function public.create_fueling_record(
  target_station_id uuid,
  plate_number text,
  liters numeric,
  fuel_type text default null,
  target_date date default current_date,
  fueled_at timestamptz default now(),
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
  effective_client_mutation_id uuid := coalesce(create_fueling_record.client_mutation_id, gen_random_uuid());
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  existing_fueling_row public.fueling_records%rowtype;
  saved_fueling_row public.fueling_records%rowtype;
  access_result jsonb;
  effective_fuel_type text;
  is_override boolean := false;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['cashier', 'station_manager', 'mayor']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  if liters is null or liters <= 0 then
    raise exception 'INVALID_LITERS';
  end if;

  select *
  into existing_fueling_row
  from public.fueling_records
  where fueling_records.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_fueling_row.id is not null then
    return jsonb_build_object(
      'id', existing_fueling_row.id,
      'date', existing_fueling_row.date,
      'station_id', existing_fueling_row.station_id,
      'vehicle_id', existing_fueling_row.vehicle_id,
      'driver_id', existing_fueling_row.driver_id,
      'reservation_id', existing_fueling_row.reservation_id,
      'queue_entry_id', existing_fueling_row.queue_entry_id,
      'fuel_type', existing_fueling_row.fuel_type,
      'liters', existing_fueling_row.liters,
      'is_manual_override', existing_fueling_row.is_manual_override,
      'override_id', existing_fueling_row.override_id,
      'client_mutation_id', existing_fueling_row.client_mutation_id,
      'sync_status', existing_fueling_row.sync_status,
      'fueled_at', existing_fueling_row.fueled_at
    );
  end if;

  access_result := public.check_vehicle_access(normalized_plate, target_station_id, target_date);

  if access_result->>'status' <> 'ALLOWED' then
    raise exception '%', access_result->>'reason';
  end if;

  select * into vehicle_row
  from public.vehicles
  where normalized_plate_number = normalized_plate
  limit 1;

  select * into reservation_row
  from public.fuel_reservations
  where id = nullif(access_result->>'reservation_id', '')::uuid
  limit 1
  for update;

  select * into manual_override_row
  from public.manual_overrides
  where id = nullif(access_result->>'manual_override_id', '')::uuid
  limit 1;

  is_override := manual_override_row.id is not null;
  effective_fuel_type := coalesce(reservation_row.fuel_type, nullif(fuel_type, ''));

  if effective_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  insert into public.fueling_records (
    date,
    station_id,
    vehicle_id,
    driver_id,
    reservation_id,
    fuel_type,
    liters,
    cashier_id,
    is_manual_override,
    override_id,
    comment,
    client_mutation_id,
    sync_status,
    fueled_at
  )
  values (
    target_date,
    target_station_id,
    vehicle_row.id,
    reservation_row.driver_id,
    reservation_row.id,
    effective_fuel_type,
    liters,
    current_profile_id,
    is_override,
    manual_override_row.id,
    nullif(trim(comment), ''),
    effective_client_mutation_id,
    'SYNCED',
    coalesce(create_fueling_record.fueled_at, now())
  )
  returning * into saved_fueling_row;

  if reservation_row.id is not null then
    update public.fuel_reservations
    set status = 'FUELED',
        approved_by = coalesce(approved_by, current_profile_id)
    where id = reservation_row.id;
  end if;

  if manual_override_row.id is not null then
    update public.manual_overrides
    set used_at = coalesce(create_fueling_record.fueled_at, now())
    where id = manual_override_row.id;
  end if;

  perform public.audit_action('CREATE_FUELING_RECORD', 'fueling_record', saved_fueling_row.id, null, to_jsonb(saved_fueling_row));

  return jsonb_build_object(
    'id', saved_fueling_row.id,
    'date', saved_fueling_row.date,
    'station_id', saved_fueling_row.station_id,
    'vehicle_id', saved_fueling_row.vehicle_id,
    'driver_id', saved_fueling_row.driver_id,
    'reservation_id', saved_fueling_row.reservation_id,
    'queue_entry_id', saved_fueling_row.queue_entry_id,
    'fuel_type', saved_fueling_row.fuel_type,
    'liters', saved_fueling_row.liters,
    'is_manual_override', saved_fueling_row.is_manual_override,
    'override_id', saved_fueling_row.override_id,
    'client_mutation_id', saved_fueling_row.client_mutation_id,
    'sync_status', saved_fueling_row.sync_status,
    'fueled_at', saved_fueling_row.fueled_at
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

  if operation_type = 'CREATE_PERSONAL_VEHICLE_LITER_LIMIT' then
    return jsonb_build_object(
      'status', 'SYNCED',
      'operation_type', operation_type,
      'client_mutation_id', client_mutation_id,
      'data', public.create_personal_vehicle_liter_limit(
        (payload->>'target_date')::date,
        payload->>'plate_number',
        (payload->>'liters')::numeric,
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

grant execute on function public.get_fuel_queue_category(text) to authenticated;
grant execute on function public.create_daily_limit(date, text, integer, numeric, text, integer, numeric, text, integer, numeric, uuid) to authenticated;
grant execute on function public.create_personal_vehicle_liter_limit(date, text, numeric, text, uuid) to authenticated;
grant execute on function public.get_daily_limit_overview(date) to authenticated;
grant execute on function public.check_vehicle_access(text, uuid, date) to authenticated;
grant execute on function public.create_fueling_record(uuid, text, numeric, text, date, timestamptz, text, uuid) to authenticated;
grant execute on function public.sync_offline_mutation(uuid, text, jsonb) to authenticated;
