set check_function_bodies = off;
set search_path = public, extensions;

create or replace function public.cancel_reservation(
  reservation_id uuid,
  reason text,
  comment text default null,
  client_mutation_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  current_profile_id uuid;
  actor_user_role text;
  reservation_row public.fuel_reservations%rowtype;
  saved_reservation_row public.fuel_reservations%rowtype;
  normalized_comment text := nullif(trim(coalesce(cancel_reservation.comment, '')), '');
begin
  current_profile_id := public.get_current_profile_id();
  actor_user_role := public.get_current_user_role();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if actor_user_role not in ('mayor', 'station_manager', 'mayor_assistant') then
    raise exception 'FORBIDDEN';
  end if;

  if cancel_reservation.reason not in ('OWNER_CANCELLED', 'OTHER') then
    raise exception 'INVALID_CANCEL_REASON';
  end if;

  if cancel_reservation.reason = 'OTHER' and normalized_comment is null then
    raise exception 'CANCEL_COMMENT_REQUIRED';
  end if;

  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.id = cancel_reservation.reservation_id
  for update;

  if reservation_row.id is null then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;

  if not public.can_access_station(reservation_row.station_id) then
    raise exception 'STATION_ACCESS_DENIED';
  end if;

  if reservation_row.status not in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING') then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  update public.fuel_reservations fr
  set
    status = 'CANCELLED',
    cancelled_by = current_profile_id,
    cancelled_at = now(),
    cancel_reason = cancel_reservation.reason,
    cancel_comment = case
      when cancel_reservation.reason = 'OTHER' then normalized_comment
      else null
    end,
    sync_status = 'SYNCED'
  where fr.id = reservation_row.id
  returning *
  into saved_reservation_row;

  return jsonb_build_object(
    'id', saved_reservation_row.id,
    'date', saved_reservation_row.date,
    'station_id', saved_reservation_row.station_id,
    'vehicle_id', saved_reservation_row.vehicle_id,
    'queue_number', saved_reservation_row.queue_number,
    'status', saved_reservation_row.status,
    'sync_status', saved_reservation_row.sync_status,
    'cancelled_by', saved_reservation_row.cancelled_by,
    'cancelled_at', saved_reservation_row.cancelled_at,
    'cancel_reason', saved_reservation_row.cancel_reason,
    'cancel_comment', saved_reservation_row.cancel_comment,
    'updated_at', saved_reservation_row.updated_at
  );
end;
$$;

grant execute on function public.cancel_reservation(uuid, text, text, uuid) to authenticated;
