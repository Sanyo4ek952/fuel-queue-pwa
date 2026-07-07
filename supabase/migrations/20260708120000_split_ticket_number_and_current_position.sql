set check_function_bodies = off;
set search_path = public, extensions;

create or replace function public.get_today_call_list(target_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  return coalesce((
    with active_reservations as (
      select
        fr.*,
        row_number() over (order by fr.queue_number asc, fr.id asc)::integer as current_position
      from public.fuel_reservations fr
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    ),
    callable as (
      select *
      from public.get_callable_reservations(target_date)
    ),
    latest_calls as (
      select distinct on (rcl.reservation_id)
        rcl.reservation_id,
        rcl.status,
        rcl.called_by,
        rcl.called_at,
        rcl.comment,
        rcl.client_mutation_id,
        rcl.sync_status
      from public.reservation_call_logs rcl
      order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
    )
    select jsonb_agg(
      jsonb_build_object(
        'id', fr.id,
        'date', fr.date,
        'station_id', fr.station_id,
        'vehicle_id', fr.vehicle_id,
        'driver_id', fr.driver_id,
        'operator_id', fr.operator_id,
        'fuel_type', fr.fuel_type,
        'preferred_fuel_type', fr.fuel_type,
        'fuel_preference_mode', fr.fuel_preference_mode,
        'fuel_category', public.get_fuel_queue_category(fr.fuel_type),
        'requested_liters', fr.requested_liters,
        'effective_liters', coalesce(pvll.liters, fr.requested_liters, 20),
        'queue_number', fr.queue_number,
        'ticket_number', fr.queue_number,
        'current_position', fr.current_position,
        'people_ahead', greatest(fr.current_position - 1, 0),
        'status', fr.status,
        'comment', fr.comment,
        'client_mutation_id', fr.client_mutation_id,
        'sync_status', fr.sync_status,
        'created_at', fr.created_at,
        'updated_at', fr.updated_at,
        'is_within_today_limit', coalesce(c.is_within_today_limit, false),
        'is_callable_now', coalesce(c.is_callable_now, false),
        'call_unavailable_reason', c.call_unavailable_reason,
        'matched_fuel_type', c.matched_fuel_type,
        'normalized_plate_number', v.normalized_plate_number,
        'driver_full_name', d.full_name,
        'driver_phone', d.phone,
        'created_by_full_name', op.full_name,
        'created_by_role', op.role,
        'created_by_signature_name', op.signature_name,
        'latest_call_status', lc.status,
        'latest_called_by_profile_id', lc.called_by,
        'latest_called_by_full_name', cp.full_name,
        'latest_called_by_role', cp.role,
        'latest_called_by_signature_name', cp.signature_name,
        'latest_called_at', lc.called_at,
        'latest_call_comment', lc.comment,
        'latest_call_client_mutation_id', lc.client_mutation_id,
        'latest_call_sync_status', lc.sync_status
      )
      order by fr.queue_number asc, fr.id asc
    )
    from active_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.drivers d on d.id = fr.driver_id
    left join public.profiles op on op.id = fr.operator_id
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = target_date
    left join callable c on c.reservation_id = fr.id
    left join latest_calls lc on lc.reservation_id = fr.id
    left join public.profiles cp on cp.id = lc.called_by
  ), '[]'::jsonb);
end;
$$;

create or replace function public.check_public_queue_position(
  plate_number text,
  phone_last4 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  max_attempts integer := 5;
  normalized_plate text;
  normalized_phone_last4 text;
  request_headers_text text;
  request_headers jsonb := '{}'::jsonb;
  raw_ip text;
  current_ip_key text;
  current_lookup_key text;
  current_attempt_date date := (now() at time zone 'Europe/Moscow')::date;
  ip_attempt_count integer;
  lookup_attempt_count integer;
  used_attempt_count integer;
  remaining_attempts integer;
  matched_record record;
begin
  normalized_plate := public.normalize_plate_number(plate_number);
  normalized_phone_last4 := regexp_replace(coalesce(phone_last4, ''), '\D', '', 'g');

  if normalized_plate !~ '^[АВЕКМНОРСТУХ][0-9]{3}[АВЕКМНОРСТУХ]{2}[0-9]{2,3}$'
    or normalized_phone_last4 !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'status', 'INVALID_INPUT',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'preferred_fuel_type', null,
      'fuel_preference_mode', null,
      'public_status', 'INVALID_INPUT',
      'is_within_today_limit', null,
      'is_callable_now', null,
      'matched_fuel_type', null,
      'remaining_attempts', 0
    );
  end if;

  request_headers_text := current_setting('request.headers', true);

  if coalesce(request_headers_text, '') <> '' then
    request_headers := request_headers_text::jsonb;
  end if;

  raw_ip := coalesce(
    nullif(trim(split_part(coalesce(request_headers->>'x-forwarded-for', ''), ',', 1)), ''),
    nullif(trim(coalesce(request_headers->>'cf-connecting-ip', '')), ''),
    nullif(trim(coalesce(request_headers->>'x-real-ip', '')), ''),
    'unknown'
  );
  current_ip_key := encode(digest(raw_ip, 'sha256'), 'hex');
  current_lookup_key := encode(digest(normalized_plate || ':' || normalized_phone_last4, 'sha256'), 'hex');

  select count(*)::integer
  into ip_attempt_count
  from public.public_queue_check_attempts attempts
  where attempts.attempt_date = current_attempt_date
    and attempts.ip_key = current_ip_key;

  select count(*)::integer
  into lookup_attempt_count
  from public.public_queue_check_attempts attempts
  where attempts.attempt_date = current_attempt_date
    and attempts.lookup_key = current_lookup_key;

  if ip_attempt_count >= max_attempts or lookup_attempt_count >= max_attempts then
    return jsonb_build_object(
      'status', 'LIMIT_EXCEEDED',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'preferred_fuel_type', null,
      'fuel_preference_mode', null,
      'public_status', 'LIMIT_EXCEEDED',
      'is_within_today_limit', null,
      'is_callable_now', null,
      'matched_fuel_type', null,
      'remaining_attempts', 0
    );
  end if;

  insert into public.public_queue_check_attempts (attempt_date, ip_key, lookup_key)
  values (current_attempt_date, current_ip_key, current_lookup_key);

  used_attempt_count := greatest(ip_attempt_count + 1, lookup_attempt_count + 1);
  remaining_attempts := greatest(max_attempts - used_attempt_count, 0);

  with active_positions as (
    select
      fr.id,
      row_number() over (order by fr.queue_number asc, fr.id asc)::integer as current_position
    from public.fuel_reservations fr
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ),
  latest_calls as (
    select distinct on (rcl.reservation_id)
      rcl.reservation_id,
      rcl.status
    from public.reservation_call_logs rcl
    order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
  )
  select
    fr.queue_number,
    ap.current_position,
    case
      when ap.current_position is null then null
      else greatest(ap.current_position - 1, 0)
    end as people_ahead,
    fr.fuel_type as preferred_fuel_type,
    fr.fuel_preference_mode,
    coalesce(c.is_within_today_limit, false) as is_within_today_limit,
    coalesce(c.is_callable_now, false) as is_callable_now,
    c.call_unavailable_reason,
    c.matched_fuel_type,
    lc.status as latest_call_status,
    fr.status as reservation_status
  into matched_record
  from public.fuel_reservations fr
  join public.vehicles v on v.id = fr.vehicle_id
  join public.drivers d on d.id = fr.driver_id
  left join active_positions ap on ap.id = fr.id
  left join public.get_callable_reservations(current_attempt_date) c on c.reservation_id = fr.id
  left join latest_calls lc on lc.reservation_id = fr.id
  where v.normalized_plate_number = normalized_plate
    and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 4) = normalized_phone_last4
  order by
    case when fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING') then 0 else 1 end,
    fr.queue_number asc,
    fr.id asc
  limit 1;

  if matched_record.queue_number is null then
    return jsonb_build_object(
      'status', 'NOT_FOUND',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'preferred_fuel_type', null,
      'fuel_preference_mode', null,
      'public_status', 'NOT_FOUND',
      'is_within_today_limit', null,
      'is_callable_now', null,
      'matched_fuel_type', null,
      'remaining_attempts', remaining_attempts
    );
  end if;

  return jsonb_build_object(
    'status', 'FOUND',
    'queue_number', matched_record.queue_number,
    'ticket_number', matched_record.queue_number,
    'current_position', matched_record.current_position,
    'people_ahead', matched_record.people_ahead,
    'preferred_fuel_type', matched_record.preferred_fuel_type,
    'fuel_preference_mode', matched_record.fuel_preference_mode,
    'public_status', case
      when matched_record.reservation_status in ('FUELED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'REJECTED') then 'COMPLETED_OR_CANCELLED'
      when matched_record.latest_call_status = 'CONTACTED' then 'INVITED_BY_OPERATOR'
      when matched_record.is_callable_now then 'IN_CALL_LIST'
      when matched_record.call_unavailable_reason = 'NO_COMPATIBLE_FUEL' then 'WAITING_FOR_PREFERRED_FUEL'
      when matched_record.is_within_today_limit then 'WAIT_FOR_CALL'
      else 'QUEUE_NOT_READY'
    end,
    'is_within_today_limit', matched_record.is_within_today_limit,
    'is_callable_now', matched_record.is_callable_now,
    'matched_fuel_type', matched_record.matched_fuel_type,
    'remaining_attempts', remaining_attempts
  );
end;
$$;

grant execute on function public.get_today_call_list(date) to authenticated;
grant execute on function public.check_public_queue_position(text, text) to anon, authenticated;
