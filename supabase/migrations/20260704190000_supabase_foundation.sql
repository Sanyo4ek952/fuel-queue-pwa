set check_function_bodies = off;
set search_path = public, extensions;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.normalize_plate_number(value text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text;
begin
  normalized := upper(regexp_replace(coalesce(value, ''), '[^0-9A-Za-zАВЕКМНОРСТУХавекмнорстух]', '', 'g'));
  normalized := translate(
    normalized,
    'АВЕКМНОРСТУХавекмнорстух',
    'ABEKMHOPCTYXABEKMHOPCTYX'
  );
  normalized := regexp_replace(normalized, '[^0-9A-Z]', '', 'g');

  return normalized;
end;
$$;

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (
    role in (
      'operator',
      'cashier',
      'shift_supervisor',
      'station_admin',
      'city_admin',
      'viewer'
    )
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_stations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, station_id)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null,
  normalized_plate_number text not null unique,
  is_blocked boolean not null default false,
  block_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_normalized_plate_not_empty check (normalized_plate_number <> '')
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_limits (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references public.stations(id),
  total_vehicle_limit integer not null check (total_vehicle_limit > 0),
  max_liters_per_vehicle numeric(10, 2) not null check (max_liters_per_vehicle > 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'PAUSED')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, station_id)
);

create table public.daily_fuel_type_limits (
  id uuid primary key default gen_random_uuid(),
  daily_limit_id uuid not null references public.daily_limits(id) on delete cascade,
  fuel_type text not null check (fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER')),
  vehicle_limit integer not null check (vehicle_limit >= 0),
  liters_limit numeric(10, 2) check (liters_limit is null or liters_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_limit_id, fuel_type)
);

create table public.fuel_reservations (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references public.stations(id),
  vehicle_id uuid not null references public.vehicles(id),
  driver_id uuid references public.drivers(id),
  fuel_type text not null check (fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER')),
  requested_liters numeric(10, 2) not null check (requested_liters > 0),
  queue_number integer not null check (queue_number > 0),
  status text not null default 'RESERVED' check (
    status in (
      'RESERVED',
      'ARRIVED',
      'APPROVED',
      'FUELING',
      'FUELED',
      'REJECTED',
      'CANCELLED',
      'NO_SHOW',
      'EXPIRED',
      'ERROR',
      'CONFLICT'
    )
  ),
  operator_id uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  comment text,
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED' check (sync_status in ('SYNCED', 'PENDING', 'SYNCING', 'FAILED', 'CONFLICT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, station_id, queue_number),
  unique (client_mutation_id)
);

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references public.stations(id),
  vehicle_id uuid not null references public.vehicles(id),
  driver_id uuid references public.drivers(id),
  reservation_id uuid references public.fuel_reservations(id),
  fuel_type text not null check (fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER')),
  requested_liters numeric(10, 2) not null check (requested_liters > 0),
  status text not null default 'WAITING' check (
    status in (
      'WAITING',
      'ARRIVED',
      'APPROVED',
      'FUELING',
      'FUELED',
      'REJECTED',
      'CANCELLED',
      'NO_SHOW',
      'EXPIRED',
      'ERROR',
      'CONFLICT'
    )
  ),
  operator_id uuid not null references public.profiles(id),
  comment text,
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED' check (sync_status in ('SYNCED', 'PENDING', 'SYNCING', 'FAILED', 'CONFLICT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_mutation_id)
);

create table public.manual_overrides (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references public.stations(id),
  vehicle_id uuid not null references public.vehicles(id),
  reason text not null,
  approved_by uuid not null references public.profiles(id),
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fueling_records (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references public.stations(id),
  vehicle_id uuid not null references public.vehicles(id),
  driver_id uuid references public.drivers(id),
  reservation_id uuid references public.fuel_reservations(id),
  queue_entry_id uuid references public.queue_entries(id),
  fuel_type text not null check (fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER')),
  liters numeric(10, 2) not null check (liters > 0),
  cashier_id uuid not null references public.profiles(id),
  is_manual_override boolean not null default false,
  override_id uuid references public.manual_overrides(id),
  comment text,
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED' check (sync_status in ('SYNCED', 'PENDING', 'SYNCING', 'FAILED', 'CONFLICT')),
  fueled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_mutation_id)
);

create table public.refusal_records (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  station_id uuid not null references public.stations(id),
  vehicle_id uuid references public.vehicles(id),
  driver_id uuid references public.drivers(id),
  reservation_id uuid references public.fuel_reservations(id),
  queue_entry_id uuid references public.queue_entries(id),
  reason text not null,
  comment text,
  user_id uuid not null references public.profiles(id),
  client_mutation_id uuid,
  sync_status text not null default 'SYNCED' check (sync_status in ('SYNCED', 'PENDING', 'SYNCING', 'FAILED', 'CONFLICT')),
  created_at timestamptz not null default now(),
  unique (client_mutation_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create unique index unique_active_reservation_per_vehicle_day
on public.fuel_reservations (date, vehicle_id)
where status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING');

create unique index unique_regular_fueling_per_vehicle_day
on public.fueling_records (date, vehicle_id)
where is_manual_override = false;

create index idx_vehicles_normalized_plate on public.vehicles (normalized_plate_number);
create index idx_reservations_date_station on public.fuel_reservations (date, station_id);
create index idx_reservations_vehicle_date on public.fuel_reservations (vehicle_id, date);
create index idx_fueling_vehicle_date on public.fueling_records (vehicle_id, date);
create index idx_queue_date_station on public.queue_entries (date, station_id);
create index idx_audit_entity on public.audit_logs (entity_type, entity_id);
create index idx_manual_overrides_vehicle_date on public.manual_overrides (vehicle_id, date);
create index idx_daily_fuel_type_limits_limit on public.daily_fuel_type_limits (daily_limit_id);

create trigger set_stations_updated_at before update on public.stations for each row execute function public.set_updated_at();
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_vehicles_updated_at before update on public.vehicles for each row execute function public.set_updated_at();
create trigger set_drivers_updated_at before update on public.drivers for each row execute function public.set_updated_at();
create trigger set_daily_limits_updated_at before update on public.daily_limits for each row execute function public.set_updated_at();
create trigger set_daily_fuel_type_limits_updated_at before update on public.daily_fuel_type_limits for each row execute function public.set_updated_at();
create trigger set_fuel_reservations_updated_at before update on public.fuel_reservations for each row execute function public.set_updated_at();
create trigger set_queue_entries_updated_at before update on public.queue_entries for each row execute function public.set_updated_at();
create trigger set_manual_overrides_updated_at before update on public.manual_overrides for each row execute function public.set_updated_at();
create trigger set_fueling_records_updated_at before update on public.fueling_records for each row execute function public.set_updated_at();

create or replace function public.get_current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.profiles
  where auth_user_id = auth.uid()
    and is_active = true
  limit 1
$$;

create or replace function public.get_current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = public.get_current_profile_id()
  limit 1
$$;

create or replace function public.has_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_current_user_role() = any(required_roles), false)
$$;

create or replace function public.can_access_station(target_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_current_user_role() = 'city_admin', false)
    or exists (
      select 1
      from public.user_stations us
      where us.user_id = public.get_current_profile_id()
        and us.station_id = target_station_id
    )
$$;

create or replace function public.audit_action(
  action text,
  entity_type text,
  entity_id uuid default null,
  old_value jsonb default null,
  new_value jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, old_value, new_value)
  values (public.get_current_profile_id(), action, entity_type, entity_id, old_value, new_value);
end;
$$;

alter table public.stations enable row level security;
alter table public.profiles enable row level security;
alter table public.user_stations enable row level security;
alter table public.vehicles enable row level security;
alter table public.drivers enable row level security;
alter table public.daily_limits enable row level security;
alter table public.daily_fuel_type_limits enable row level security;
alter table public.fuel_reservations enable row level security;
alter table public.queue_entries enable row level security;
alter table public.fueling_records enable row level security;
alter table public.refusal_records enable row level security;
alter table public.manual_overrides enable row level security;
alter table public.audit_logs enable row level security;

create policy stations_select_accessible
on public.stations
for select
to authenticated
using (is_active = true and public.can_access_station(id));

create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (
  id = public.get_current_profile_id()
  or public.has_role(array['station_admin', 'city_admin'])
);

create policy user_stations_select_own_or_admin
on public.user_stations
for select
to authenticated
using (
  user_id = public.get_current_profile_id()
  or public.has_role(array['station_admin', 'city_admin'])
);

create policy vehicles_select_authenticated
on public.vehicles
for select
to authenticated
using (public.get_current_profile_id() is not null);

create policy drivers_select_authenticated
on public.drivers
for select
to authenticated
using (public.get_current_profile_id() is not null);

create policy daily_limits_select_accessible
on public.daily_limits
for select
to authenticated
using (public.can_access_station(station_id));

create policy daily_fuel_type_limits_select_accessible
on public.daily_fuel_type_limits
for select
to authenticated
using (
  exists (
    select 1
    from public.daily_limits dl
    where dl.id = daily_limit_id
      and public.can_access_station(dl.station_id)
  )
);

create policy fuel_reservations_select_accessible
on public.fuel_reservations
for select
to authenticated
using (public.can_access_station(station_id));

create policy queue_entries_select_accessible
on public.queue_entries
for select
to authenticated
using (public.can_access_station(station_id));

create policy fueling_records_select_accessible
on public.fueling_records
for select
to authenticated
using (public.can_access_station(station_id));

create policy refusal_records_select_accessible
on public.refusal_records
for select
to authenticated
using (public.can_access_station(station_id));

create policy manual_overrides_select_accessible
on public.manual_overrides
for select
to authenticated
using (public.can_access_station(station_id));

create policy audit_logs_select_admin
on public.audit_logs
for select
to authenticated
using (public.has_role(array['shift_supervisor', 'station_admin', 'city_admin']));

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
  other_reservation_row public.fuel_reservations%rowtype;
  daily_limit_row public.daily_limits%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  last_fueling_row public.fueling_records%rowtype;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'PROFILE_NOT_FOUND',
      'normalized_plate_number', normalized_plate
    );
  end if;

  if normalized_plate = '' then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'INVALID_PLATE_NUMBER',
      'normalized_plate_number', normalized_plate
    );
  end if;

  if not public.can_access_station(station_id) then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'STATION_ACCESS_DENIED',
      'normalized_plate_number', normalized_plate,
      'station_id', station_id,
      'date', check_date
    );
  end if;

  select *
  into vehicle_row
  from public.vehicles
  where normalized_plate_number = normalized_plate
  limit 1;

  if vehicle_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_ACTIVE_RESERVATION',
      'normalized_plate_number', normalized_plate,
      'station_id', station_id,
      'date', check_date
    );
  end if;

  select *
  into manual_override_row
  from public.manual_overrides
  where vehicle_id = vehicle_row.id
    and station_id = check_vehicle_access.station_id
    and date = check_vehicle_access.check_date
    and used_at is null
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;

  if vehicle_row.is_blocked and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'VEHICLE_BLOCKED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'block_reason', vehicle_row.block_reason
    );
  end if;

  select *
  into last_fueling_row
  from public.fueling_records
  where vehicle_id = vehicle_row.id
    and date = check_vehicle_access.check_date
    and is_manual_override = false
  order by fueled_at desc
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

  select *
  into reservation_row
  from public.fuel_reservations
  where vehicle_id = vehicle_row.id
    and station_id = check_vehicle_access.station_id
    and date = check_vehicle_access.check_date
    and status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  order by queue_number asc
  limit 1;

  if reservation_row.id is null then
    select *
    into other_reservation_row
    from public.fuel_reservations
    where vehicle_id = vehicle_row.id
      and date = check_vehicle_access.check_date
      and status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    order by created_at asc
    limit 1;

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

    if other_reservation_row.id is not null then
      return jsonb_build_object(
        'status', 'BLOCKED',
        'reason', 'RESERVATION_AT_OTHER_STATION',
        'normalized_plate_number', normalized_plate,
        'vehicle_id', vehicle_row.id,
        'reservation_id', other_reservation_row.id,
        'reservation_station_id', other_reservation_row.station_id,
        'date', check_date
      );
    end if;

    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_ACTIVE_RESERVATION',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'station_id', station_id,
      'date', check_date
    );
  end if;

  select *
  into daily_limit_row
  from public.daily_limits
  where date = check_vehicle_access.check_date
    and station_id = check_vehicle_access.station_id
  limit 1;

  if daily_limit_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_DAILY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'station_id', station_id,
      'date', check_date
    );
  end if;

  if daily_limit_row.status <> 'OPEN' and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'DAILY_LIMIT_NOT_OPEN',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'daily_limit_id', daily_limit_row.id,
      'daily_limit_status', daily_limit_row.status
    );
  end if;

  if reservation_row.requested_liters > daily_limit_row.max_liters_per_vehicle and manual_override_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'LITERS_LIMIT_EXCEEDED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'reservation_id', reservation_row.id,
      'requested_liters', reservation_row.requested_liters,
      'max_liters_per_vehicle', daily_limit_row.max_liters_per_vehicle
    );
  end if;

  return jsonb_build_object(
    'status', 'ALLOWED',
    'reason', case when manual_override_row.id is null then 'ACTIVE_RESERVATION' else 'MANUAL_OVERRIDE_ACTIVE' end,
    'normalized_plate_number', normalized_plate,
    'vehicle_id', vehicle_row.id,
    'reservation_id', reservation_row.id,
    'station_id', station_id,
    'date', check_date,
    'queue_number', reservation_row.queue_number,
    'fuel_type', reservation_row.fuel_type,
    'requested_liters', reservation_row.requested_liters,
    'manual_override_id', manual_override_row.id
  );
end;
$$;

create or replace function public.create_daily_limit(
  target_date date,
  target_station_id uuid,
  total_vehicle_limit integer,
  max_liters_per_vehicle numeric,
  fuel_type_limits jsonb default '[]'::jsonb,
  client_mutation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(array['shift_supervisor', 'station_admin']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  raise exception 'RPC_NOT_IMPLEMENTED: create_daily_limit';
end;
$$;

create or replace function public.create_reservation(
  target_date date,
  target_station_id uuid,
  plate_number text,
  driver_full_name text,
  driver_phone text,
  fuel_type text,
  requested_liters numeric,
  comment text default null,
  client_mutation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(array['operator', 'shift_supervisor', 'station_admin']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  raise exception 'RPC_NOT_IMPLEMENTED: create_reservation';
end;
$$;

create or replace function public.create_fueling_record(
  target_station_id uuid,
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
begin
  if not public.has_role(array['cashier', 'shift_supervisor', 'station_admin']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  raise exception 'RPC_NOT_IMPLEMENTED: create_fueling_record';
end;
$$;

create or replace function public.create_manual_override(
  target_date date,
  target_station_id uuid,
  plate_number text,
  reason text,
  expires_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.has_role(array['shift_supervisor', 'station_admin']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(target_station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  raise exception 'RPC_NOT_IMPLEMENTED: create_manual_override';
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
  if public.get_current_profile_id() is null then
    raise exception 'FORBIDDEN';
  end if;

  raise exception 'RPC_NOT_IMPLEMENTED: sync_offline_mutation';
end;
$$;

revoke execute on all functions in schema public from public;

grant execute on function public.normalize_plate_number(text) to authenticated;
grant execute on function public.get_current_profile_id() to authenticated;
grant execute on function public.get_current_user_role() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.can_access_station(uuid) to authenticated;
grant execute on function public.check_vehicle_access(text, uuid, date) to authenticated;
grant execute on function public.create_daily_limit(date, uuid, integer, numeric, jsonb, uuid) to authenticated;
grant execute on function public.create_reservation(date, uuid, text, text, text, text, numeric, text, uuid) to authenticated;
grant execute on function public.create_fueling_record(uuid, text, numeric, text, uuid) to authenticated;
grant execute on function public.create_manual_override(date, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.sync_offline_mutation(uuid, text, jsonb) to authenticated;
