CREATE OR REPLACE FUNCTION public.unlink_my_vehicle(
  profile_vehicle_id uuid,
  client_mutation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid;
  profile_vehicle_row public.profile_vehicles%rowtype;
  updated_profile_vehicle_row public.profile_vehicles%rowtype;
  vehicle_row public.vehicles%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  perform pg_advisory_xact_lock(hashtext('consumer_vehicle_' || current_profile_id::text));

  select *
  into profile_vehicle_row
  from public.profile_vehicles pv
  where pv.id = unlink_my_vehicle.profile_vehicle_id
    and pv.profile_id = current_profile_id
    and pv.status = 'ACTIVE'
  for update;

  if profile_vehicle_row.id is null then
    raise exception 'CONSUMER_VEHICLE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtext('consumer_vehicle_id_' || profile_vehicle_row.vehicle_id::text));

  select *
  into vehicle_row
  from public.vehicles v
  where v.id = profile_vehicle_row.vehicle_id;

  if vehicle_row.id is null then
    raise exception 'CONSUMER_VEHICLE_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.fuel_queue_entries fqe
    where fqe.vehicle_id = profile_vehicle_row.vehicle_id
      and fqe.status = 'WAITING'
  ) then
    raise exception 'VEHICLE_IN_ACTIVE_QUEUE';
  end if;

  update public.profile_vehicles
  set status = 'BLOCKED'
  where id = profile_vehicle_row.id
  returning * into updated_profile_vehicle_row;

  perform public.audit_action(
    'UNLINK_CONSUMER_VEHICLE',
    'profile_vehicle',
    updated_profile_vehicle_row.id,
    public.consumer_vehicle_to_json(profile_vehicle_row, vehicle_row),
    public.consumer_vehicle_to_json(updated_profile_vehicle_row, vehicle_row)
  );

  return public.consumer_vehicle_to_json(updated_profile_vehicle_row, vehicle_row);
end;
$$;

ALTER FUNCTION public.unlink_my_vehicle(uuid, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.unlink_my_vehicle(uuid, uuid) TO authenticated;
