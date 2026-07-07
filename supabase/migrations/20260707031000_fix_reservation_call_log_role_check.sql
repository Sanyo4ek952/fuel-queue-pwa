set check_function_bodies = off;
set search_path = public, extensions;

create or replace function public.create_reservation_call_log(
  reservation_id uuid,
  status text,
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
  effective_client_mutation_id uuid := coalesce(create_reservation_call_log.client_mutation_id, gen_random_uuid());
  existing_call_row public.reservation_call_logs%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  saved_call_row public.reservation_call_logs%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if create_reservation_call_log.status not in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER', 'CALL_LATER', 'WRONG_NUMBER') then
    raise exception 'INVALID_CALL_STATUS';
  end if;

  select *
  into existing_call_row
  from public.reservation_call_logs rcl
  where rcl.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_call_row.id is not null then
    return public.reservation_call_log_to_json(existing_call_row);
  end if;

  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.id = create_reservation_call_log.reservation_id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  limit 1;

  if reservation_row.id is null then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  insert into public.reservation_call_logs (
    reservation_id,
    status,
    called_by,
    comment,
    client_mutation_id,
    sync_status
  )
  values (
    create_reservation_call_log.reservation_id,
    create_reservation_call_log.status,
    current_profile_id,
    nullif(trim(coalesce(create_reservation_call_log.comment, '')), ''),
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_call_row;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, new_value)
  values (
    current_profile_id,
    'CREATE_RESERVATION_CALL_LOG',
    'reservation_call_log',
    saved_call_row.id,
    public.reservation_call_log_to_json(saved_call_row)
  );

  return public.reservation_call_log_to_json(saved_call_row);
end;
$$;

grant execute on function public.create_reservation_call_log(uuid, text, text, uuid) to authenticated;
