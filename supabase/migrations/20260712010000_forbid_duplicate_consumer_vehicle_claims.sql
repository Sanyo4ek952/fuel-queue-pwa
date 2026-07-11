CREATE OR REPLACE FUNCTION public.create_consumer_vehicle(
  plate_number text,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid;
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  profile_vehicle_row public.profile_vehicles%rowtype;
  active_vehicle_count integer;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  if normalized_plate = '' then
    raise exception 'INVALID_PLATE_NUMBER';
  end if;

  perform pg_advisory_xact_lock(hashtext('consumer_vehicle_plate_' || normalized_plate));
  perform pg_advisory_xact_lock(hashtext('consumer_vehicle_' || current_profile_id::text));

  select count(*)
  into active_vehicle_count
  from public.profile_vehicles pv
  where pv.profile_id = current_profile_id
    and pv.status = 'ACTIVE';

  insert into public.vehicles (plate_number, normalized_plate_number)
  values (plate_number, normalized_plate)
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  if vehicle_row.is_blocked then
    raise exception 'VEHICLE_BLOCKED';
  end if;

  select *
  into profile_vehicle_row
  from public.profile_vehicles pv
  where pv.profile_id = current_profile_id
    and pv.vehicle_id = vehicle_row.id
  limit 1;

  if exists (
    select 1
    from public.profile_vehicles pv
    where pv.vehicle_id = vehicle_row.id
      and pv.profile_id <> current_profile_id
  ) then
    raise exception 'VEHICLE_ALREADY_ASSIGNED';
  end if;

  if exists (
    select 1
    from public.fuel_queue_entries fqe
    where fqe.vehicle_id = vehicle_row.id
      and fqe.status = 'WAITING'
      and fqe.operator_id <> current_profile_id
      and (
        profile_vehicle_row.id is null
        or profile_vehicle_row.created_at > fqe.created_at
      )
  ) then
    raise exception 'VEHICLE_IN_ACTIVE_QUEUE';
  end if;

  if profile_vehicle_row.id is not null then
    if profile_vehicle_row.status <> 'ACTIVE' then
      if active_vehicle_count >= 3 then
        raise exception 'CONSUMER_VEHICLE_LIMIT_EXCEEDED';
      end if;

      update public.profile_vehicles
      set status = 'ACTIVE'
      where id = profile_vehicle_row.id
      returning * into profile_vehicle_row;
    end if;

    return public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row);
  end if;

  if active_vehicle_count >= 3 then
    raise exception 'CONSUMER_VEHICLE_LIMIT_EXCEEDED';
  end if;

  insert into public.profile_vehicles (profile_id, vehicle_id, status)
  values (current_profile_id, vehicle_row.id, 'ACTIVE')
  returning * into profile_vehicle_row;

  perform public.audit_action(
    'CREATE_CONSUMER_VEHICLE',
    'profile_vehicle',
    profile_vehicle_row.id,
    null,
    public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row)
  );

  return public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row);
end;
$$;

ALTER FUNCTION public.create_consumer_vehicle(text, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.create_consumer_vehicle(text, uuid) TO authenticated;
