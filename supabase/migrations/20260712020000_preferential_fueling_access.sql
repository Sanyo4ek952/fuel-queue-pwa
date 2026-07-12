CREATE OR REPLACE FUNCTION public.enforce_fueling_record_liters_limit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  daily_limit_row public.daily_limits%rowtype;
  fuel_type_limit_row public.daily_fuel_type_limits%rowtype;
  already_fueled_liters numeric := 0;
begin
  if new.date is null or new.station_id is null or new.fuel_type is null or new.liters is null then
    return new;
  end if;

  if new.preferential_queue_entry_id is not null then
    return new;
  end if;

  select *
  into daily_limit_row
  from public.daily_limits dl
  where dl.date = new.date
    and dl.station_id = new.station_id
    and dl.status = 'OPEN'
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
    and fr.station_id = new.station_id
    and fr.fuel_type = new.fuel_type
    and fr.is_manual_override = false
    and fr.preferential_queue_entry_id is null
    and fr.id <> new.id;

  if coalesce(new.is_manual_override, false) is false
    and already_fueled_liters + new.liters > fuel_type_limit_row.liters_limit then
    raise exception 'LITERS_LIMIT_EXCEEDED';
  end if;

  return new;
end;
$$;

ALTER FUNCTION public.enforce_fueling_record_liters_limit() OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.check_vehicle_access(
  plate_number text,
  station_id uuid,
  check_date date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  normalized_plate text := public.normalize_plate_number(plate_number);
  vehicle_row public.vehicles%rowtype;
  preferential_entry_row record;
  allocation_row record;
begin
  if public.get_current_profile_id() is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'PROFILE_NOT_FOUND',
      'normalized_plate_number', normalized_plate
    );
  end if;

  if not public.can_access_station(station_id) then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'STATION_ACCESS_DENIED',
      'normalized_plate_number', normalized_plate
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
      'normalized_plate_number', normalized_plate
    );
  end if;

  if vehicle_row.is_blocked then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'VEHICLE_BLOCKED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'block_reason', vehicle_row.block_reason
    );
  end if;

  select
    pqe.*,
    pq.name as queue_name
  into preferential_entry_row
  from public.preferential_queue_entries pqe
  join public.preferential_queues pq on pq.id = pqe.queue_id
  where pqe.vehicle_id = vehicle_row.id
    and pqe.status = 'ACTIVE'
    and pq.status = 'ACTIVE'
  order by pqe.created_at, pqe.id
  limit 1;

  if preferential_entry_row.id is not null then
    return jsonb_build_object(
      'status', 'ALLOWED',
      'reason', 'PREFERENTIAL_QUEUE_ACTIVE',
      'normalized_plate_number', normalized_plate,
      'date', check_date,
      'station_id', station_id,
      'vehicle_id', vehicle_row.id,
      'preferential_queue_entry_id', preferential_entry_row.id,
      'preferential_queue_id', preferential_entry_row.queue_id,
      'preferential_queue_name', preferential_entry_row.queue_name,
      'fuel_type', preferential_entry_row.fuel_type,
      'preferred_fuel_type', preferential_entry_row.fuel_type,
      'fuel_preference_mode', 'EXACT',
      'matched_fuel_type', preferential_entry_row.fuel_type,
      'requested_liters', preferential_entry_row.requested_liters,
      'effective_liters', preferential_entry_row.requested_liters,
      'is_within_today_limit', true,
      'is_callable_now', true,
      'call_unavailable_reason', null
    );
  end if;

  if exists (
    select 1
    from public.fueling_records fr
    where fr.vehicle_id = vehicle_row.id
      and fr.date = check_date
      and coalesce(fr.is_manual_override, false) = false
      and fr.preferential_queue_entry_id is null
  ) then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'ALREADY_FUELED',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id
    );
  end if;

  select
    dqa.*,
    fqe.permanent_number,
    fqe.preferred_fuel_type,
    fqe.fuel_preference_mode,
    fqe.requested_liters
  into allocation_row
  from public.daily_queue_allocations dqa
  join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
  where fqe.vehicle_id = vehicle_row.id
    and dqa.allocation_date = check_date
  order by
    case
      when dqa.status = 'ACTIVE' and dqa.station_id = check_vehicle_access.station_id then 0
      when dqa.status = 'ACTIVE' then 1
      else 2
    end,
    dqa.daily_position,
    dqa.id
  limit 1;

  if allocation_row.id is null then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'NO_ACTIVE_RESERVATION',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id
    );
  end if;

  if allocation_row.status = 'ACTIVE' and allocation_row.station_id <> check_vehicle_access.station_id then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'RESERVATION_AT_OTHER_STATION',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'allocation_id', allocation_row.id,
      'reservation_id', allocation_row.queue_entry_id,
      'reservation_station_id', allocation_row.station_id,
      'queue_entry_id', allocation_row.queue_entry_id,
      'queue_number', allocation_row.permanent_number,
      'matched_fuel_type', allocation_row.assigned_fuel_type,
      'is_within_today_limit', false
    );
  end if;

  if allocation_row.status <> 'ACTIVE' then
    return jsonb_build_object(
      'status', 'BLOCKED',
      'reason', 'OUTSIDE_TODAY_LIMIT',
      'normalized_plate_number', normalized_plate,
      'vehicle_id', vehicle_row.id,
      'allocation_id', allocation_row.id,
      'reservation_id', allocation_row.queue_entry_id,
      'reservation_station_id', allocation_row.station_id,
      'queue_entry_id', allocation_row.queue_entry_id,
      'queue_number', allocation_row.permanent_number,
      'matched_fuel_type', allocation_row.assigned_fuel_type,
      'is_within_today_limit', false
    );
  end if;

  return jsonb_build_object(
    'status', 'ALLOWED',
    'reason', 'ACTIVE_RESERVATION',
    'normalized_plate_number', normalized_plate,
    'date', check_date,
    'station_id', station_id,
    'vehicle_id', vehicle_row.id,
    'allocation_id', allocation_row.id,
    'reservation_id', allocation_row.queue_entry_id,
    'queue_entry_id', allocation_row.queue_entry_id,
    'queue_number', allocation_row.permanent_number,
    'fuel_type', allocation_row.preferred_fuel_type,
    'preferred_fuel_type', allocation_row.preferred_fuel_type,
    'fuel_preference_mode', allocation_row.fuel_preference_mode,
    'matched_fuel_type', allocation_row.assigned_fuel_type,
    'requested_liters', allocation_row.requested_liters,
    'effective_liters', allocation_row.allocated_liters,
    'category_position', allocation_row.station_fuel_position,
    'is_within_today_limit', true,
    'is_callable_now', true,
    'arrival_at', allocation_row.arrival_at,
    'call_status', allocation_row.call_status
  );
end;
$$;

ALTER FUNCTION public.check_vehicle_access(text, uuid, date) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.check_vehicle_access(text, uuid, date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_vehicle_access(text, uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_fueling_record_for_allocation(
  allocation_id uuid,
  liters numeric,
  fueled_at timestamp with time zone DEFAULT now(),
  comment text DEFAULT NULL::text,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  allocation_row record;
  saved_record public.fueling_records%rowtype;
begin
  if current_profile_id is null or not public.has_role(array['mayor', 'station_manager', 'cashier']) then
    raise exception 'FORBIDDEN';
  end if;

  if liters is null or liters <= 0 then
    raise exception 'INVALID_LITERS';
  end if;

  select dqa.*, fqe.vehicle_id, fqe.driver_id
  into allocation_row
  from public.daily_queue_allocations dqa
  join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
  where dqa.id = allocation_id
  for update;

  if allocation_row.id is null or allocation_row.status <> 'ACTIVE' then
    raise exception 'ALLOCATION_NOT_ACTIVE';
  end if;

  if not public.can_access_station(allocation_row.station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  if liters > allocation_row.allocated_liters then
    raise exception 'LITERS_LIMIT_EXCEEDED';
  end if;

  if exists (
    select 1
    from public.fueling_records fr
    where fr.vehicle_id = allocation_row.vehicle_id
      and fr.date = allocation_row.allocation_date
      and coalesce(fr.is_manual_override, false) = false
      and fr.preferential_queue_entry_id is null
  ) then
    raise exception 'ALREADY_FUELED';
  end if;

  select *
  into saved_record
  from public.fueling_records
  where fueling_records.client_mutation_id = create_fueling_record_for_allocation.client_mutation_id
  limit 1;

  if saved_record.id is null then
    insert into public.fueling_records (
      date,
      station_id,
      vehicle_id,
      driver_id,
      allocation_id,
      queue_entry_id,
      fuel_type,
      liters,
      cashier_id,
      is_manual_override,
      comment,
      client_mutation_id,
      sync_status,
      fueled_at
    ) values (
      allocation_row.allocation_date,
      allocation_row.station_id,
      allocation_row.vehicle_id,
      allocation_row.driver_id,
      allocation_row.id,
      allocation_row.queue_entry_id,
      allocation_row.assigned_fuel_type,
      liters,
      current_profile_id,
      false,
      nullif(trim(coalesce(comment, '')), ''),
      coalesce(client_mutation_id, gen_random_uuid()),
      'SYNCED',
      coalesce(fueled_at, now())
    ) returning * into saved_record;

    update public.daily_queue_allocations
    set status = 'FUELED',
        fueled_at = saved_record.fueled_at,
        finalized_at = now()
    where id = allocation_row.id;

    update public.fuel_queue_entries
    set status = 'FUELED'
    where id = allocation_row.queue_entry_id;

    perform public.allocate_daily_queue(allocation_row.allocation_date);
  end if;

  return jsonb_build_object(
    'id', saved_record.id,
    'date', saved_record.date,
    'station_id', saved_record.station_id,
    'vehicle_id', saved_record.vehicle_id,
    'driver_id', saved_record.driver_id,
    'allocation_id', saved_record.allocation_id,
    'reservation_id', saved_record.queue_entry_id,
    'queue_entry_id', saved_record.queue_entry_id,
    'preferential_queue_entry_id', saved_record.preferential_queue_entry_id,
    'fuel_type', saved_record.fuel_type,
    'liters', saved_record.liters,
    'is_manual_override', saved_record.is_manual_override,
    'override_id', saved_record.override_id,
    'comment', saved_record.comment,
    'client_mutation_id', saved_record.client_mutation_id,
    'sync_status', saved_record.sync_status,
    'fueled_at', saved_record.fueled_at
  );
end;
$$;

ALTER FUNCTION public.create_fueling_record_for_allocation(
  uuid,
  numeric,
  timestamp with time zone,
  text,
  uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_fueling_record_for_allocation(
  uuid,
  numeric,
  timestamp with time zone,
  text,
  uuid
) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_fueling_record_for_allocation(
  uuid,
  numeric,
  timestamp with time zone,
  text,
  uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_fueling_record_for_preferential_entry(
  preferential_queue_entry_id uuid,
  station_id uuid,
  liters numeric,
  fueled_at timestamp with time zone DEFAULT now(),
  comment text DEFAULT NULL::text,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  entry_row record;
  saved_record public.fueling_records%rowtype;
  remaining_liters numeric;
begin
  if current_profile_id is null or not public.has_role(array['mayor', 'station_manager', 'cashier']) then
    raise exception 'FORBIDDEN';
  end if;

  if not public.can_access_station(station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  if liters is null or liters <= 0 then
    raise exception 'INVALID_LITERS';
  end if;

  select
    pqe.*,
    pq.name as queue_name
  into entry_row
  from public.preferential_queue_entries pqe
  join public.preferential_queues pq on pq.id = pqe.queue_id
  where pqe.id = create_fueling_record_for_preferential_entry.preferential_queue_entry_id
    and pq.status = 'ACTIVE'
  for update of pqe;

  if entry_row.id is null or entry_row.status <> 'ACTIVE' then
    raise exception 'PREFERENTIAL_ENTRY_NOT_ACTIVE';
  end if;

  if liters > entry_row.requested_liters then
    raise exception 'LITERS_LIMIT_EXCEEDED';
  end if;

  select *
  into saved_record
  from public.fueling_records
  where fueling_records.client_mutation_id = create_fueling_record_for_preferential_entry.client_mutation_id
  limit 1;

  if saved_record.id is null then
    remaining_liters := entry_row.requested_liters - liters;

    insert into public.fueling_records (
      date,
      station_id,
      vehicle_id,
      driver_id,
      preferential_queue_entry_id,
      fuel_type,
      liters,
      cashier_id,
      is_manual_override,
      comment,
      client_mutation_id,
      sync_status,
      fueled_at
    ) values (
      (coalesce(fueled_at, now()) at time zone 'Europe/Moscow')::date,
      station_id,
      entry_row.vehicle_id,
      entry_row.driver_id,
      entry_row.id,
      entry_row.fuel_type,
      liters,
      current_profile_id,
      false,
      nullif(trim(coalesce(comment, '')), ''),
      coalesce(client_mutation_id, gen_random_uuid()),
      'SYNCED',
      coalesce(fueled_at, now())
    ) returning * into saved_record;

    update public.preferential_queue_entries
    set requested_liters = remaining_liters,
        status = case when remaining_liters <= 0 then 'FUELED' else 'ACTIVE' end
    where id = entry_row.id;
  end if;

  return jsonb_build_object(
    'id', saved_record.id,
    'date', saved_record.date,
    'station_id', saved_record.station_id,
    'vehicle_id', saved_record.vehicle_id,
    'driver_id', saved_record.driver_id,
    'allocation_id', saved_record.allocation_id,
    'reservation_id', saved_record.queue_entry_id,
    'queue_entry_id', saved_record.queue_entry_id,
    'preferential_queue_entry_id', saved_record.preferential_queue_entry_id,
    'fuel_type', saved_record.fuel_type,
    'liters', saved_record.liters,
    'is_manual_override', saved_record.is_manual_override,
    'override_id', saved_record.override_id,
    'comment', saved_record.comment,
    'client_mutation_id', saved_record.client_mutation_id,
    'sync_status', saved_record.sync_status,
    'fueled_at', saved_record.fueled_at
  );
end;
$$;

ALTER FUNCTION public.create_fueling_record_for_preferential_entry(
  uuid,
  uuid,
  numeric,
  timestamp with time zone,
  text,
  uuid
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_fueling_record_for_preferential_entry(
  uuid,
  uuid,
  numeric,
  timestamp with time zone,
  text,
  uuid
) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_fueling_record_for_preferential_entry(
  uuid,
  uuid,
  numeric,
  timestamp with time zone,
  text,
  uuid
) TO authenticated;
