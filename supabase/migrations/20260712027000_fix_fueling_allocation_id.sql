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

  select dqa.*, fqe.vehicle_id, fqe.driver_id, fqe.status as queue_entry_status
  into allocation_row
  from public.daily_queue_allocations dqa
  join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
  where dqa.id = allocation_id
  for update;

  if allocation_row.id is null or allocation_row.status <> 'ACTIVE' then
    raise exception 'ALLOCATION_NOT_ACTIVE';
  end if;

  if allocation_row.queue_entry_status <> 'WAITING' then
    raise exception 'QUEUE_ENTRY_NOT_WAITING';
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
      queue_entry_id,
      allocation_id,
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
      allocation_row.queue_entry_id,
      allocation_row.id,
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

    perform public.allocate_daily_queue(allocation_row.allocation_date, true);
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

ALTER FUNCTION public.create_fueling_record_for_allocation(uuid, numeric, timestamp with time zone, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_fueling_record_for_allocation(uuid, numeric, timestamp with time zone, text, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_fueling_record_for_allocation(uuid, numeric, timestamp with time zone, text, uuid) TO authenticated;
