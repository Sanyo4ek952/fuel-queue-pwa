alter table public.manual_overrides
add column if not exists client_mutation_id uuid,
add column if not exists sync_status text not null default 'SYNCED'
  check (sync_status in ('SYNCED', 'PENDING', 'SYNCING', 'FAILED', 'CONFLICT'));

create unique index if not exists manual_overrides_client_mutation_id_unique
on public.manual_overrides (client_mutation_id)
where client_mutation_id is not null;

create or replace function public.create_manual_override(
  target_date date,
  target_station_id uuid,
  plate_number text,
  reason text,
  expires_at timestamptz default null,
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
  effective_client_mutation_id uuid := coalesce(create_manual_override.client_mutation_id, gen_random_uuid());
  normalized_plate text;
  vehicle_row public.vehicles%rowtype;
  existing_override_row public.manual_overrides%rowtype;
  saved_override_row public.manual_overrides%rowtype;
begin
  current_profile_id := public.get_current_profile_id();
  normalized_plate := public.normalize_plate_number(plate_number);

  if current_profile_id is null or not public.has_role(array['shift_supervisor', 'station_admin']) then
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

  if coalesce(trim(reason), '') = '' then
    raise exception 'INVALID_REASON';
  end if;

  if expires_at is not null and expires_at <= now() then
    raise exception 'INVALID_EXPIRES_AT';
  end if;

  select *
  into existing_override_row
  from public.manual_overrides
  where manual_overrides.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_override_row.id is not null then
    select *
    into vehicle_row
    from public.vehicles
    where id = existing_override_row.vehicle_id;

    return jsonb_build_object(
      'id', existing_override_row.id,
      'date', existing_override_row.date,
      'station_id', existing_override_row.station_id,
      'vehicle_id', existing_override_row.vehicle_id,
      'normalized_plate_number', vehicle_row.normalized_plate_number,
      'reason', existing_override_row.reason,
      'approved_by', existing_override_row.approved_by,
      'expires_at', existing_override_row.expires_at,
      'used_at', existing_override_row.used_at,
      'client_mutation_id', existing_override_row.client_mutation_id,
      'sync_status', existing_override_row.sync_status
    );
  end if;

  insert into public.vehicles (
    plate_number,
    normalized_plate_number
  )
  values (
    plate_number,
    normalized_plate
  )
  on conflict (normalized_plate_number) do update
  set plate_number = excluded.plate_number
  returning * into vehicle_row;

  insert into public.manual_overrides (
    date,
    station_id,
    vehicle_id,
    reason,
    approved_by,
    expires_at,
    client_mutation_id,
    sync_status
  )
  values (
    target_date,
    target_station_id,
    vehicle_row.id,
    trim(reason),
    current_profile_id,
    create_manual_override.expires_at,
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_override_row;

  perform public.audit_action(
    'CREATE_MANUAL_OVERRIDE',
    'manual_override',
    saved_override_row.id,
    null,
    to_jsonb(saved_override_row)
  );

  return jsonb_build_object(
    'id', saved_override_row.id,
    'date', saved_override_row.date,
    'station_id', saved_override_row.station_id,
    'vehicle_id', saved_override_row.vehicle_id,
    'normalized_plate_number', vehicle_row.normalized_plate_number,
    'reason', saved_override_row.reason,
    'approved_by', saved_override_row.approved_by,
    'expires_at', saved_override_row.expires_at,
    'used_at', saved_override_row.used_at,
    'client_mutation_id', saved_override_row.client_mutation_id,
    'sync_status', saved_override_row.sync_status
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
        (payload->>'target_date')::date,
        (payload->>'station_id')::uuid,
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

grant execute on function public.create_manual_override(date, uuid, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.sync_offline_mutation(uuid, text, jsonb) to authenticated;
