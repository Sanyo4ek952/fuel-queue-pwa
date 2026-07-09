set check_function_bodies = off;
set search_path = public, extensions;

create table if not exists public.daily_fueling_schedules (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  fuel_category text not null check (fuel_category in ('GASOLINE', 'DIESEL', 'GAS')),
  start_time time not null,
  interval_minutes integer not null check (interval_minutes between 1 and 240),
  vehicles_per_interval integer not null check (vehicles_per_interval between 1 and 100),
  updated_by uuid references public.profiles(id),
  client_mutation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, fuel_category)
);

create index if not exists idx_daily_fueling_schedules_date
on public.daily_fueling_schedules (date);

drop trigger if exists set_daily_fueling_schedules_updated_at on public.daily_fueling_schedules;
create trigger set_daily_fueling_schedules_updated_at
before update on public.daily_fueling_schedules
for each row execute function public.set_updated_at();

alter table public.daily_fueling_schedules enable row level security;

drop policy if exists daily_fueling_schedules_select_authenticated on public.daily_fueling_schedules;
create policy daily_fueling_schedules_select_authenticated
on public.daily_fueling_schedules
for select
to authenticated
using (public.get_current_profile_id() is not null);

create or replace function public.get_daily_fueling_schedule(target_date date default current_date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', dfs.id,
        'date', dfs.date,
        'fuel_category', dfs.fuel_category,
        'start_time', to_char(dfs.start_time, 'HH24:MI'),
        'interval_minutes', dfs.interval_minutes,
        'vehicles_per_interval', dfs.vehicles_per_interval,
        'updated_at', dfs.updated_at,
        'client_mutation_id', dfs.client_mutation_id
      )
      order by
        case dfs.fuel_category
          when 'GASOLINE' then 1
          when 'DIESEL' then 2
          when 'GAS' then 3
          else 4
        end
    ),
    '[]'::jsonb
  )
  from public.daily_fueling_schedules dfs
  where dfs.date = get_daily_fueling_schedule.target_date
    and public.get_current_profile_id() is not null
$$;

create or replace function public.set_daily_fueling_schedule(
  target_date date,
  schedules jsonb,
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
  effective_client_mutation_id uuid := coalesce(set_daily_fueling_schedule.client_mutation_id, gen_random_uuid());
  schedule_item jsonb;
  item_category text;
  item_start_time time;
  item_interval_minutes integer;
  item_vehicles_per_interval integer;
  saved_rows jsonb;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if jsonb_typeof(schedules) <> 'array' then
    raise exception 'INVALID_FUELING_SCHEDULE';
  end if;

  create temporary table if not exists daily_fueling_schedule_input (
    fuel_category text primary key,
    start_time time not null,
    interval_minutes integer not null,
    vehicles_per_interval integer not null
  ) on commit drop;

  truncate table daily_fueling_schedule_input;

  for schedule_item in select * from jsonb_array_elements(schedules)
  loop
    item_category := schedule_item->>'fuel_category';
    item_start_time := (schedule_item->>'start_time')::time;
    item_interval_minutes := (schedule_item->>'interval_minutes')::integer;
    item_vehicles_per_interval := (schedule_item->>'vehicles_per_interval')::integer;

    if item_category not in ('GASOLINE', 'DIESEL', 'GAS') then
      raise exception 'INVALID_FUEL_CATEGORY';
    end if;

    if item_interval_minutes is null or item_interval_minutes < 1 or item_interval_minutes > 240 then
      raise exception 'INVALID_INTERVAL_MINUTES';
    end if;

    if item_vehicles_per_interval is null or item_vehicles_per_interval < 1 or item_vehicles_per_interval > 100 then
      raise exception 'INVALID_VEHICLES_PER_INTERVAL';
    end if;

    insert into daily_fueling_schedule_input (
      fuel_category,
      start_time,
      interval_minutes,
      vehicles_per_interval
    )
    values (
      item_category,
      item_start_time,
      item_interval_minutes,
      item_vehicles_per_interval
    )
    on conflict (fuel_category) do update
    set start_time = excluded.start_time,
        interval_minutes = excluded.interval_minutes,
        vehicles_per_interval = excluded.vehicles_per_interval;
  end loop;

  delete from public.daily_fueling_schedules dfs
  where dfs.date = set_daily_fueling_schedule.target_date
    and not exists (
      select 1
      from daily_fueling_schedule_input input
      where input.fuel_category = dfs.fuel_category
    );

  insert into public.daily_fueling_schedules (
    date,
    fuel_category,
    start_time,
    interval_minutes,
    vehicles_per_interval,
    updated_by,
    client_mutation_id
  )
  select
    set_daily_fueling_schedule.target_date,
    input.fuel_category,
    input.start_time,
    input.interval_minutes,
    input.vehicles_per_interval,
    current_profile_id,
    effective_client_mutation_id
  from daily_fueling_schedule_input input
  on conflict (date, fuel_category) do update
  set start_time = excluded.start_time,
      interval_minutes = excluded.interval_minutes,
      vehicles_per_interval = excluded.vehicles_per_interval,
      updated_by = excluded.updated_by,
      client_mutation_id = excluded.client_mutation_id;

  perform public.audit_action(
    'SET_DAILY_FUELING_SCHEDULE',
    'daily_fueling_schedule',
    null,
    null,
    jsonb_build_object(
      'date', target_date,
      'schedules', schedules,
      'client_mutation_id', effective_client_mutation_id
    )
  );

  select public.get_daily_fueling_schedule(target_date)
  into saved_rows;

  return saved_rows;
end;
$$;

grant execute on function public.get_daily_fueling_schedule(date) to authenticated;
grant execute on function public.set_daily_fueling_schedule(date, jsonb, uuid) to authenticated;
