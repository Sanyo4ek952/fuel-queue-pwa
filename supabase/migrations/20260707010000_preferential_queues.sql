set check_function_bodies = off;
set search_path = public, extensions;

create table if not exists public.preferential_queues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_by uuid not null references public.profiles(id),
  client_mutation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_mutation_id)
);

create table if not exists public.preferential_queue_entries (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.preferential_queues(id),
  vehicle_id uuid not null references public.vehicles(id),
  driver_id uuid references public.drivers(id),
  fuel_type text not null check (fuel_type in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER')),
  requested_liters numeric(10, 2) not null check (requested_liters > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'FUELED', 'CANCELLED')),
  comment text,
  cancelled_comment text,
  created_by uuid not null references public.profiles(id),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  client_mutation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_mutation_id)
);

alter table public.fueling_records
  add column if not exists preferential_queue_entry_id uuid references public.preferential_queue_entries(id);

drop trigger if exists set_preferential_queues_updated_at on public.preferential_queues;
create trigger set_preferential_queues_updated_at
before update on public.preferential_queues
for each row execute function public.set_updated_at();

drop trigger if exists set_preferential_queue_entries_updated_at on public.preferential_queue_entries;
create trigger set_preferential_queue_entries_updated_at
before update on public.preferential_queue_entries
for each row execute function public.set_updated_at();

alter table public.preferential_queues enable row level security;
alter table public.preferential_queue_entries enable row level security;

drop policy if exists preferential_queues_select_authenticated on public.preferential_queues;
create policy preferential_queues_select_authenticated
on public.preferential_queues
for select
to authenticated
using (public.get_current_profile_id() is not null);

drop policy if exists preferential_queue_entries_select_authenticated on public.preferential_queue_entries;
create policy preferential_queue_entries_select_authenticated
on public.preferential_queue_entries
for select
to authenticated
using (public.get_current_profile_id() is not null);

drop index if exists preferential_queues_active_name_unique;
create unique index preferential_queues_active_name_unique
on public.preferential_queues (lower(name))
where status = 'ACTIVE';

drop index if exists preferential_queue_entries_active_vehicle_unique;
create unique index preferential_queue_entries_active_vehicle_unique
on public.preferential_queue_entries (vehicle_id)
where status = 'ACTIVE';

create index if not exists idx_preferential_queue_entries_queue_status
on public.preferential_queue_entries (queue_id, status, created_at);

create index if not exists idx_fueling_preferential_queue_entry
on public.fueling_records (preferential_queue_entry_id);

create or replace function public.create_preferential_queue(
  name text,
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
  effective_client_mutation_id uuid := coalesce(create_preferential_queue.client_mutation_id, gen_random_uuid());
  saved_queue_row public.preferential_queues%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if coalesce(trim(name), '') = '' then
    raise exception 'INVALID_QUEUE_NAME';
  end if;

  select *
  into saved_queue_row
  from public.preferential_queues pq
  where pq.client_mutation_id = effective_client_mutation_id
  limit 1;

  if saved_queue_row.id is null then
    insert into public.preferential_queues (name, status, created_by, client_mutation_id)
    values (trim(name), 'ACTIVE', current_profile_id, effective_client_mutation_id)
    returning * into saved_queue_row;

    perform public.audit_action(
      'CREATE_PREFERENTIAL_QUEUE',
      'preferential_queue',
      saved_queue_row.id,
      null,
      to_jsonb(saved_queue_row)
    );
  end if;

  return jsonb_build_object(
    'id', saved_queue_row.id,
    'name', saved_queue_row.name,
    'status', saved_queue_row.status,
    'created_by', saved_queue_row.created_by,
    'client_mutation_id', saved_queue_row.client_mutation_id,
    'created_at', saved_queue_row.created_at,
    'updated_at', saved_queue_row.updated_at
  );
end;
$$;

create or replace function public.create_preferential_queue_entry(
  queue_id uuid,
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
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_preferential_queue_entry.client_mutation_id, gen_random_uuid());
  queue_row public.preferential_queues%rowtype;
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  driver_row public.drivers%rowtype;
  saved_entry_row public.preferential_queue_entries%rowtype;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  if queue_id is null then
    raise exception 'INVALID_QUEUE_ID';
  end if;

  select *
  into queue_row
  from public.preferential_queues pq
  where pq.id = create_preferential_queue_entry.queue_id
    and pq.status = 'ACTIVE'
  limit 1;

  if queue_row.id is null then
    raise exception 'PREFERENTIAL_QUEUE_NOT_FOUND';
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

  if requested_liters is null or requested_liters <= 0 then
    raise exception 'INVALID_REQUESTED_LITERS';
  end if;

  select *
  into saved_entry_row
  from public.preferential_queue_entries pqe
  where pqe.client_mutation_id = effective_client_mutation_id
  limit 1;

  if saved_entry_row.id is not null then
    return jsonb_build_object(
      'id', saved_entry_row.id,
      'queue_id', saved_entry_row.queue_id,
      'queue_name', queue_row.name,
      'vehicle_id', saved_entry_row.vehicle_id,
      'driver_id', saved_entry_row.driver_id,
      'normalized_plate_number', normalized_plate,
      'driver_full_name', driver_full_name,
      'driver_phone', driver_phone,
      'fuel_type', saved_entry_row.fuel_type,
      'requested_liters', saved_entry_row.requested_liters,
      'status', saved_entry_row.status,
      'comment', saved_entry_row.comment,
      'client_mutation_id', saved_entry_row.client_mutation_id,
      'created_at', saved_entry_row.created_at,
      'updated_at', saved_entry_row.updated_at
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
    from public.preferential_queue_entries pqe
    where pqe.vehicle_id = vehicle_row.id
      and pqe.status = 'ACTIVE'
  ) then
    raise exception 'ACTIVE_PREFERENTIAL_ENTRY_ALREADY_EXISTS';
  end if;

  insert into public.preferential_queue_entries (
    queue_id,
    vehicle_id,
    driver_id,
    fuel_type,
    requested_liters,
    status,
    comment,
    created_by,
    client_mutation_id
  )
  values (
    queue_row.id,
    vehicle_row.id,
    driver_row.id,
    create_preferential_queue_entry.fuel_type,
    requested_liters,
    'ACTIVE',
    nullif(trim(comment), ''),
    current_profile_id,
    effective_client_mutation_id
  )
  returning * into saved_entry_row;

  perform public.audit_action(
    'CREATE_PREFERENTIAL_QUEUE_ENTRY',
    'preferential_queue_entry',
    saved_entry_row.id,
    null,
    to_jsonb(saved_entry_row)
  );

  return jsonb_build_object(
    'id', saved_entry_row.id,
    'queue_id', saved_entry_row.queue_id,
    'queue_name', queue_row.name,
    'vehicle_id', saved_entry_row.vehicle_id,
    'driver_id', saved_entry_row.driver_id,
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'driver_full_name', driver_row.full_name,
    'driver_phone', driver_row.phone,
    'fuel_type', saved_entry_row.fuel_type,
    'requested_liters', saved_entry_row.requested_liters,
    'status', saved_entry_row.status,
    'comment', saved_entry_row.comment,
    'client_mutation_id', saved_entry_row.client_mutation_id,
    'created_at', saved_entry_row.created_at,
    'updated_at', saved_entry_row.updated_at
  );
end;
$$;

create or replace function public.cancel_preferential_queue_entry(
  entry_id uuid,
  comment text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  old_entry_row public.preferential_queue_entries%rowtype;
  saved_entry_row public.preferential_queue_entries%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or public.get_current_user_role() <> 'mayor' then
    raise exception 'FORBIDDEN';
  end if;

  select *
  into old_entry_row
  from public.preferential_queue_entries pqe
  where pqe.id = cancel_preferential_queue_entry.entry_id
  for update;

  if old_entry_row.id is null then
    raise exception 'PREFERENTIAL_ENTRY_NOT_FOUND';
  end if;

  if old_entry_row.status <> 'ACTIVE' then
    raise exception 'PREFERENTIAL_ENTRY_NOT_ACTIVE';
  end if;

  update public.preferential_queue_entries
  set status = 'CANCELLED',
      cancelled_comment = nullif(trim(cancel_preferential_queue_entry.comment), ''),
      cancelled_by = current_profile_id,
      cancelled_at = now()
  where id = old_entry_row.id
  returning * into saved_entry_row;

  perform public.audit_action(
    'CANCEL_PREFERENTIAL_QUEUE_ENTRY',
    'preferential_queue_entry',
    saved_entry_row.id,
    to_jsonb(old_entry_row),
    to_jsonb(saved_entry_row)
  );

  return jsonb_build_object(
    'id', saved_entry_row.id,
    'queue_id', saved_entry_row.queue_id,
    'status', saved_entry_row.status,
    'cancelled_comment', saved_entry_row.cancelled_comment,
    'cancelled_at', saved_entry_row.cancelled_at
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
  preferential_entry_row public.preferential_queue_entries%rowtype;
  preferential_queue_row public.preferential_queues%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  last_fueling_row public.fueling_records%rowtype;
  daily_limit_row public.daily_limits%rowtype;
  category_limit_row public.daily_fuel_type_limits%rowtype;
  manual_override_is_mayor boolean := false;
  cooldown_days integer;
  next_allowed_date date;
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

  if manual_override_row.id is not null then
    select exists (
      select 1
      from public.profiles p
      where p.id = manual_override_row.approved_by
        and p.role = 'mayor'
    )
    into manual_override_is_mayor;
  end if;

  if vehicle_row.is_blocked and manual_override_row.id is null then
    return jsonb_build_object('status', 'BLOCKED', 'reason', 'VEHICLE_BLOCKED', 'normalized_plate_number', normalized_plate, 'vehicle_id', vehicle_row.id, 'block_reason', vehicle_row.block_reason);
  end if;

  select pqe.*
  into preferential_entry_row
  from public.preferential_queue_entries pqe
  join public.preferential_queues pq on pq.id = pqe.queue_id
  where pqe.vehicle_id = vehicle_row.id
    and pqe.status = 'ACTIVE'
    and pq.status = 'ACTIVE'
  order by pqe.created_at asc
  limit 1;

  if preferential_entry_row.id is not null then
    select *
    into preferential_queue_row
    from public.preferential_queues pq
    where pq.id = preferential_entry_row.queue_id
    limit 1;
  end if;

  select * into last_fueling_row
  from public.fueling_records fr
  where fr.vehicle_id = vehicle_row.id
    and fr.is_manual_override = false
  order by fr.date desc, fr.fueled_at desc
  limit 1;

  if last_fueling_row.id is not null
    and last_fueling_row.date = check_vehicle_access.check_date
    and (manual_override_row.id is null or preferential_entry_row.id is not null) then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'ALREADY_FUELED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'last_fueling_record_id', last_fueling_row.id,
      'last_fueling_station_id', last_fueling_row.station_id,
      'last_fueled_at', last_fueling_row.fueled_at,
      'last_fueling_date', last_fueling_row.date
    );
  end if;

  if preferential_entry_row.id is not null then
    return jsonb_build_object(
      'status', 'ALLOWED',
      'reason', 'PREFERENTIAL_QUEUE_ACTIVE',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'preferential_queue_entry_id', preferential_entry_row.id,
      'preferential_queue_id', preferential_entry_row.queue_id,
      'preferential_queue_name', preferential_queue_row.name,
      'station_id', station_id,
      'date', check_date,
      'fuel_type', preferential_entry_row.fuel_type,
      'fuel_category', public.get_fuel_queue_category(preferential_entry_row.fuel_type),
      'requested_liters', preferential_entry_row.requested_liters,
      'effective_liters', preferential_entry_row.requested_liters
    );
  end if;

  cooldown_days := public.get_reservation_refuel_cooldown();

  if cooldown_days > 0 and last_fueling_row.id is not null and not manual_override_is_mayor then
    next_allowed_date := last_fueling_row.date + cooldown_days;

    if check_vehicle_access.check_date < next_allowed_date then
      return jsonb_build_object(
        'status', 'BLOCKED',
        'reason', 'REFUEL_COOLDOWN_ACTIVE',
        'normalized_plate_number', normalized_plate,
        'vehicle_id', vehicle_row.id,
        'station_id', station_id,
        'date', check_date,
        'last_fueling_record_id', last_fueling_row.id,
        'last_fueling_station_id', last_fueling_row.station_id,
        'last_fueled_at', last_fueling_row.fueled_at,
        'last_fueling_date', last_fueling_row.date,
        'next_allowed_date', next_allowed_date,
        'cooldown_days', cooldown_days,
        'days_since_last_fueling', check_vehicle_access.check_date - last_fueling_row.date
      );
    end if;
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
  preferential_entry_row public.preferential_queue_entries%rowtype;
  manual_override_row public.manual_overrides%rowtype;
  existing_fueling_row public.fueling_records%rowtype;
  saved_fueling_row public.fueling_records%rowtype;
  access_result jsonb;
  effective_fuel_type text;
  effective_driver_id uuid;
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
      'preferential_queue_entry_id', existing_fueling_row.preferential_queue_entry_id,
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

  select * into preferential_entry_row
  from public.preferential_queue_entries
  where id = nullif(access_result->>'preferential_queue_entry_id', '')::uuid
  limit 1
  for update;

  select * into manual_override_row
  from public.manual_overrides
  where id = nullif(access_result->>'manual_override_id', '')::uuid
  limit 1;

  is_override := manual_override_row.id is not null;
  effective_fuel_type := coalesce(preferential_entry_row.fuel_type, reservation_row.fuel_type, nullif(fuel_type, ''));
  effective_driver_id := coalesce(preferential_entry_row.driver_id, reservation_row.driver_id);

  if effective_fuel_type not in ('AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS', 'OTHER') then
    raise exception 'INVALID_FUEL_TYPE';
  end if;

  insert into public.fueling_records (
    date,
    station_id,
    vehicle_id,
    driver_id,
    reservation_id,
    preferential_queue_entry_id,
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
    effective_driver_id,
    reservation_row.id,
    preferential_entry_row.id,
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

  if preferential_entry_row.id is not null then
    update public.preferential_queue_entries
    set status = 'FUELED'
    where id = preferential_entry_row.id;
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
    'preferential_queue_entry_id', saved_fueling_row.preferential_queue_entry_id,
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

grant execute on function public.create_preferential_queue(text, uuid) to authenticated;
grant execute on function public.create_preferential_queue_entry(uuid, text, text, text, text, numeric, text, uuid) to authenticated;
grant execute on function public.cancel_preferential_queue_entry(uuid, text) to authenticated;
grant execute on function public.check_vehicle_access(text, uuid, date) to authenticated;
grant execute on function public.create_fueling_record(uuid, text, numeric, text, date, timestamptz, text, uuid) to authenticated;
