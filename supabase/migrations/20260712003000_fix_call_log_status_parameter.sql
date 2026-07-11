CREATE OR REPLACE FUNCTION "public"."create_reservation_call_log"("reservation_id" "uuid", "status" "text", "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT "gen_random_uuid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  saved_log public.daily_queue_allocation_call_logs%rowtype;
  caller public.profiles%rowtype;
begin
  if current_profile_id is null then raise exception 'FORBIDDEN'; end if;
  if create_reservation_call_log.status not in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER') then raise exception 'INVALID_CALL_STATUS'; end if;
  if not exists (
    select 1 from public.daily_queue_allocations
    where id = create_reservation_call_log.reservation_id
      and daily_queue_allocations.status = 'ACTIVE'
      and public.can_access_station(station_id)
  ) then raise exception 'ALLOCATION_NOT_ACTIVE'; end if;

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

CREATE OR REPLACE FUNCTION "public"."cancel_reservation"("reservation_id" "uuid", "reason" "text", "comment" "text" DEFAULT NULL::"text", "client_mutation_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
  saved_entry public.fuel_queue_entries%rowtype;
begin
  if current_profile_id is null then raise exception 'FORBIDDEN'; end if;
  update public.fuel_queue_entries
  set status = 'CANCELLED',
      cancelled_by = current_profile_id,
      cancelled_at = now(),
      cancel_reason = cancel_reservation.reason,
      cancel_comment = nullif(trim(coalesce(cancel_reservation.comment, '')), '')
  where id = cancel_reservation.reservation_id
    and fuel_queue_entries.status = 'WAITING'
  returning * into saved_entry;
  if saved_entry.id is null then raise exception 'QUEUE_ENTRY_NOT_WAITING'; end if;
  update public.daily_queue_allocations
  set status = 'EXPIRED', finalized_at = now()
  where queue_entry_id = saved_entry.id
    and daily_queue_allocations.status in ('ACTIVE', 'PAUSED_BY_LIMIT');
  perform public.allocate_daily_queue((now() at time zone 'Europe/Moscow')::date);
  return public.queue_entry_to_json(saved_entry) || jsonb_build_object(
    'cancelled_by', saved_entry.cancelled_by,
    'cancelled_at', saved_entry.cancelled_at,
    'cancel_reason', saved_entry.cancel_reason,
    'cancel_comment', saved_entry.cancel_comment
  );
end;
$$;
