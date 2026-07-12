CREATE OR REPLACE FUNCTION "public"."create_reservation_call_log"("reservation_id" "uuid", "status" "text", "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  saved_log public.daily_queue_allocation_call_logs%rowtype;
  caller public.profiles%rowtype;
  allocation_row public.daily_queue_allocations%rowtype;
begin
  if current_profile_id is null then raise exception 'FORBIDDEN'; end if;
  if create_reservation_call_log.status not in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER') then raise exception 'INVALID_CALL_STATUS'; end if;

  select *
  into allocation_row
  from public.daily_queue_allocations
  where id = create_reservation_call_log.reservation_id
    and public.can_access_station(station_id);

  if allocation_row.id is null then
    raise exception 'ALLOCATION_NOT_ACTIVE';
  end if;

  if not (
    allocation_row.status = 'ACTIVE'
    or (
      create_reservation_call_log.status = 'NOT_CALLED'
      and allocation_row.status = 'PAUSED_BY_LIMIT'
      and allocation_row.call_status <> 'NOT_CALLED'
    )
  ) then
    raise exception 'ALLOCATION_NOT_ACTIVE';
  end if;

  select * into saved_log from public.daily_queue_allocation_call_logs
  where daily_queue_allocation_call_logs.client_mutation_id = create_reservation_call_log.client_mutation_id
  limit 1;
  if saved_log.id is null then
    insert into public.daily_queue_allocation_call_logs (
      allocation_id, status, called_by, comment, client_mutation_id
    ) values (
      create_reservation_call_log.reservation_id,
      create_reservation_call_log.status,
      current_profile_id,
      nullif(trim(coalesce(create_reservation_call_log.comment, '')), ''),
      coalesce(create_reservation_call_log.client_mutation_id, gen_random_uuid())
    ) returning * into saved_log;
    update public.daily_queue_allocations
    set call_status = create_reservation_call_log.status
    where id = create_reservation_call_log.reservation_id;
  end if;
  select * into caller from public.profiles where id = saved_log.called_by;
  return jsonb_build_object(
    'id', saved_log.id,
    'allocation_id', saved_log.allocation_id,
    'reservation_id', saved_log.allocation_id,
    'status', saved_log.status,
    'called_by_profile_id', saved_log.called_by,
    'called_by_full_name', caller.full_name,
    'called_by_role', caller.role,
    'called_by_signature_name', caller.signature_name,
    'called_at', saved_log.called_at,
    'comment', saved_log.comment,
    'client_mutation_id', saved_log.client_mutation_id,
    'sync_status', saved_log.sync_status
  );
end;
$$;
