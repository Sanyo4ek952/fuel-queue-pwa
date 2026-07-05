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

grant execute on function public.sync_offline_mutation(uuid, text, jsonb) to authenticated;
