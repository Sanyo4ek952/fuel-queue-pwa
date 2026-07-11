set check_function_bodies = off;
set search_path = public, extensions;

alter table public.stations
  add column if not exists allocation_order integer;

create sequence if not exists public.stations_allocation_order_seq;

with ordered as (
  select id, row_number() over (order by created_at, id)::integer as position
  from public.stations
)
update public.stations s
set allocation_order = ordered.position
from ordered
where ordered.id = s.id
  and s.allocation_order is null;

alter table public.stations
  alter column allocation_order set default nextval('public.stations_allocation_order_seq'),
  alter column allocation_order set not null;

select setval(
  'public.stations_allocation_order_seq',
  greatest(coalesce((select max(allocation_order) from public.stations), 0), 1),
  true
);

create unique index if not exists stations_allocation_order_unique
on public.stations (allocation_order);

create sequence if not exists public.fuel_queue_permanent_number_seq;

create table if not exists public.fuel_queue_entries (
  id uuid primary key default gen_random_uuid(),
  permanent_number bigint not null default nextval('public.fuel_queue_permanent_number_seq'),
  vehicle_id uuid not null references public.vehicles(id),
  driver_id uuid references public.drivers(id),
  preferred_fuel_type text not null check (preferred_fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')),
  fuel_preference_mode text not null default 'EXACT' check (fuel_preference_mode in ('EXACT', 'ANY_GASOLINE')),
  requested_liters numeric(10, 2) not null check (requested_liters > 0),
  status text not null default 'WAITING' check (status in ('WAITING', 'FUELED', 'CANCELLED', 'NO_SHOW', 'ERROR', 'CONFLICT')),
  operator_id uuid not null references public.profiles(id),
  comment text,
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED' check (sync_status in ('SYNCED', 'PENDING', 'SYNCING', 'FAILED', 'CONFLICT')),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  cancel_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (permanent_number),
  unique (client_mutation_id),
  constraint any_gasoline_requires_gasoline check (
    fuel_preference_mode <> 'ANY_GASOLINE'
    or preferred_fuel_type in ('AI_92', 'AI_95', 'AI_100')
  )
);

create unique index if not exists fuel_queue_entries_one_waiting_vehicle
on public.fuel_queue_entries (vehicle_id)
where status = 'WAITING';

create index if not exists fuel_queue_entries_waiting_number
on public.fuel_queue_entries (permanent_number, id)
where status = 'WAITING';

alter table public.daily_fueling_schedules
  add column if not exists station_id uuid references public.stations(id);

update public.daily_fueling_schedules dfs
set station_id = station.id
from lateral (
  select s.id
  from public.stations s
  where s.is_active
  order by s.allocation_order, s.id
  limit 1
) station
where dfs.station_id is null;

alter table public.daily_fueling_schedules
  alter column station_id set not null;

alter table public.daily_fueling_schedules
  drop constraint if exists daily_fueling_schedules_date_fuel_category_key;

create unique index if not exists daily_fueling_schedules_station_category_unique
on public.daily_fueling_schedules (date, station_id, fuel_category);

alter table public.daily_fuel_type_limits
  add column if not exists status text not null default 'OPEN';

alter table public.daily_fuel_type_limits
  drop constraint if exists daily_fuel_type_limits_status_check;

alter table public.daily_fuel_type_limits
  add constraint daily_fuel_type_limits_status_check check (status in ('OPEN', 'PAUSED'));

create table if not exists public.daily_queue_allocations (
  id uuid primary key default gen_random_uuid(),
  allocation_date date not null,
  queue_entry_id uuid not null references public.fuel_queue_entries(id),
  station_id uuid not null references public.stations(id),
  assigned_fuel_type text not null check (assigned_fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS')),
  allocated_liters numeric(10, 2) not null check (allocated_liters > 0),
  daily_position integer not null check (daily_position > 0),
  station_position integer not null check (station_position > 0),
  station_fuel_position integer not null check (station_fuel_position > 0),
  arrival_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED', 'MISSED', 'EXPIRED')),
  call_status text not null default 'NOT_CALLED' check (call_status in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER')),
  paused_at timestamptz,
  paused_reason text,
  fueled_at timestamptz,
  missed_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (allocation_date, queue_entry_id)
);

create unique index if not exists daily_queue_allocations_active_daily_position
on public.daily_queue_allocations (allocation_date, daily_position)
where status in ('ACTIVE', 'FUELED');

create index if not exists daily_queue_allocations_station_date
on public.daily_queue_allocations (allocation_date, station_id, status, station_fuel_position);

create table if not exists public.daily_queue_allocation_call_logs (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null references public.daily_queue_allocations(id),
  status text not null check (status in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER')),
  called_by uuid not null references public.profiles(id),
  comment text,
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED' check (sync_status in ('SYNCED', 'PENDING', 'SYNCING', 'FAILED', 'CONFLICT')),
  called_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (client_mutation_id)
);

alter table public.fueling_records
  drop constraint if exists fueling_records_queue_entry_id_fkey;

alter table public.fueling_records
  add column if not exists allocation_id uuid references public.daily_queue_allocations(id),
  add column if not exists queue_entry_id uuid;

alter table public.fueling_records
  add constraint fueling_records_fuel_queue_entry_id_fkey
  foreign key (queue_entry_id) references public.fuel_queue_entries(id);

alter table public.fueling_records
  drop constraint if exists fueling_records_regular_allocation_required,
  add constraint fueling_records_regular_allocation_required check (
    is_manual_override
    or (allocation_id is not null and queue_entry_id is not null)
  );

alter table public.refusal_records
  drop constraint if exists refusal_records_queue_entry_id_fkey;

alter table public.refusal_records
  add constraint refusal_records_fuel_queue_entry_id_fkey
  foreign key (queue_entry_id) references public.fuel_queue_entries(id);

create unique index if not exists fueling_records_allocation_unique
on public.fueling_records (allocation_id)
where allocation_id is not null and is_manual_override = false;

create or replace function public.prevent_permanent_number_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.permanent_number is distinct from old.permanent_number then
    raise exception 'PERMANENT_NUMBER_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_fuel_queue_permanent_number_change on public.fuel_queue_entries;
create trigger prevent_fuel_queue_permanent_number_change
before update on public.fuel_queue_entries
for each row execute function public.prevent_permanent_number_change();

drop trigger if exists set_fuel_queue_entries_updated_at on public.fuel_queue_entries;
create trigger set_fuel_queue_entries_updated_at
before update on public.fuel_queue_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_daily_queue_allocations_updated_at on public.daily_queue_allocations;
create trigger set_daily_queue_allocations_updated_at
before update on public.daily_queue_allocations
for each row execute function public.set_updated_at();

alter table public.fuel_queue_entries enable row level security;
alter table public.daily_queue_allocations enable row level security;
alter table public.daily_queue_allocation_call_logs enable row level security;
