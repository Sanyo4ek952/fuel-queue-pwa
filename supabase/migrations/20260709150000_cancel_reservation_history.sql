set check_function_bodies = off;
set search_path = public, extensions;

alter table public.fuel_reservations
  add column if not exists cancelled_by uuid references public.profiles(id),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancel_comment text;

alter table public.fuel_reservations
  drop constraint if exists fuel_reservations_cancel_reason_check;

alter table public.fuel_reservations
  add constraint fuel_reservations_cancel_reason_check
  check (cancel_reason is null or cancel_reason in ('OWNER_CANCELLED', 'OTHER'));

create index if not exists idx_reservations_cancelled_at
on public.fuel_reservations (cancelled_at desc)
where status = 'CANCELLED';

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
  current_role text;
  reservation_row public.fuel_reservations%rowtype;
  saved_reservation_row public.fuel_reservations%rowtype;
  normalized_comment text := nullif(trim(coalesce(cancel_reservation.comment, '')), '');
begin
  current_profile_id := public.get_current_profile_id();
  current_role := public.get_current_user_role();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if current_role not in ('mayor', 'station_manager', 'mayor_assistant') then
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

  perform public.add_audit_log(
    'cancel_reservation',
    'fuel_reservations',
    saved_reservation_row.id,
    to_jsonb(reservation_row),
    jsonb_build_object(
      'id', saved_reservation_row.id,
      'status', saved_reservation_row.status,
      'cancelled_by', saved_reservation_row.cancelled_by,
      'cancelled_at', saved_reservation_row.cancelled_at,
      'cancel_reason', saved_reservation_row.cancel_reason,
      'cancel_comment', saved_reservation_row.cancel_comment,
      'client_mutation_id', cancel_reservation.client_mutation_id
    )
  );

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

create or replace function public.get_cancelled_reservations(
  date_from date default null,
  date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  current_role text;
  effective_date_from date := coalesce(get_cancelled_reservations.date_from, current_date - 30);
  effective_date_to date := coalesce(get_cancelled_reservations.date_to, current_date);
begin
  current_profile_id := public.get_current_profile_id();
  current_role := public.get_current_user_role();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if current_role not in ('mayor', 'station_manager', 'mayor_assistant') then
    raise exception 'FORBIDDEN';
  end if;

  if effective_date_from > effective_date_to then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', fr.id,
        'date', fr.date,
        'station_id', fr.station_id,
        'vehicle_id', fr.vehicle_id,
        'driver_id', fr.driver_id,
        'fuel_type', fr.fuel_type,
        'requested_liters', fr.requested_liters,
        'queue_number', fr.queue_number,
        'status', fr.status,
        'comment', fr.comment,
        'cancelled_by', fr.cancelled_by,
        'cancelled_at', fr.cancelled_at,
        'cancel_reason', fr.cancel_reason,
        'cancel_comment', fr.cancel_comment,
        'created_at', fr.created_at,
        'updated_at', fr.updated_at,
        'normalized_plate_number', v.normalized_plate_number,
        'driver_full_name', d.full_name,
        'driver_phone', d.phone,
        'created_by_full_name', op.full_name,
        'created_by_role', op.role,
        'created_by_signature_name', op.signature_name,
        'cancelled_by_full_name', cp.full_name,
        'cancelled_by_role', cp.role,
        'cancelled_by_signature_name', cp.signature_name
      )
      order by fr.cancelled_at desc, fr.updated_at desc, fr.id desc
    )
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.drivers d on d.id = fr.driver_id
    left join public.profiles op on op.id = fr.operator_id
    left join public.profiles cp on cp.id = fr.cancelled_by
    where fr.status = 'CANCELLED'
      and fr.cancelled_at is not null
      and fr.date between effective_date_from and effective_date_to
      and public.can_access_station(fr.station_id)
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.cancel_reservation(uuid, text, text, uuid) to authenticated;
grant execute on function public.get_cancelled_reservations(date, date) to authenticated;
