CREATE OR REPLACE FUNCTION public.check_public_queue_position(
  plate_number text,
  phone_last4 text,
  client_ip_hash text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  normalized_plate text := public.normalize_plate_number(plate_number);
  normalized_phone_last4 text := regexp_replace(coalesce(phone_last4, ''), '\D', '', 'g');
  matched record;
  ip_limit jsonb;
  plate_limit jsonb;
  search_result jsonb;
  response_remaining_attempts integer;
begin
  if trim(coalesce(client_ip_hash, '')) = '' then
    raise exception 'CLIENT_IP_HASH_REQUIRED';
  end if;

  ip_limit := public.apply_public_queue_rate_limit(
    'IP_REQUEST',
    client_ip_hash,
    10,
    interval '15 minutes',
    interval '30 minutes'
  );

  if not coalesce((ip_limit ->> 'allowed')::boolean, false) then
    return jsonb_build_object(
      'status', 'LIMIT_EXCEEDED',
      'public_status', 'LIMIT_EXCEEDED',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'remaining_attempts', 0,
      'retry_after_seconds', (ip_limit ->> 'retry_after_seconds')::integer,
      'error_code', 'PUBLIC_QUEUE_IP_RATE_LIMITED'
    );
  end if;

  if normalized_phone_last4 !~ '^[0-9]{4}$' or normalized_plate = '' then
    return jsonb_build_object(
      'status', 'INVALID_INPUT',
      'public_status', 'INVALID_INPUT',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'remaining_attempts', (ip_limit ->> 'remaining_attempts')::integer,
      'retry_after_seconds', 0
    );
  end if;

  select fqe.*, dqa.id as allocation_id, dqa.daily_position, dqa.station_position,
    dqa.arrival_at, dqa.status as allocation_status, dqa.assigned_fuel_type, dqa.call_status
  into matched
  from public.fuel_queue_entries fqe
  join public.vehicles v on v.id = fqe.vehicle_id
  left join public.drivers d on d.id = fqe.driver_id
  left join public.daily_queue_allocations dqa
    on dqa.queue_entry_id = fqe.id
   and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
  where v.normalized_plate_number = normalized_plate
    and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 4) = normalized_phone_last4
  order by fqe.permanent_number desc
  limit 1;

  if matched.id is null then
    plate_limit := public.apply_public_queue_rate_limit(
      'PLATE_FAILURE',
      normalized_plate,
      10,
      interval '1 hour',
      interval '30 minutes'
    );

    if not coalesce((plate_limit ->> 'allowed')::boolean, false) then
      return jsonb_build_object(
        'status', 'LIMIT_EXCEEDED',
        'public_status', 'LIMIT_EXCEEDED',
        'queue_number', null,
        'ticket_number', null,
        'current_position', null,
        'people_ahead', null,
        'is_within_today_limit', null,
        'is_callable_now', null,
        'remaining_attempts', 0,
        'retry_after_seconds', (plate_limit ->> 'retry_after_seconds')::integer,
        'error_code', 'PUBLIC_QUEUE_PLATE_FAILURE_RATE_LIMITED'
      );
    end if;

    response_remaining_attempts := least(
      (ip_limit ->> 'remaining_attempts')::integer,
      (plate_limit ->> 'remaining_attempts')::integer
    );

    return jsonb_build_object(
      'status', 'NOT_FOUND',
      'public_status', 'NOT_FOUND',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'remaining_attempts', response_remaining_attempts,
      'retry_after_seconds', 0
    );
  end if;

  plate_limit := public.apply_public_queue_rate_limit(
    'PLATE_SUCCESS',
    normalized_plate,
    30,
    interval '1 hour',
    interval '30 minutes'
  );

  if not coalesce((plate_limit ->> 'allowed')::boolean, false) then
    return jsonb_build_object(
      'status', 'LIMIT_EXCEEDED',
      'public_status', 'LIMIT_EXCEEDED',
      'queue_number', null,
      'ticket_number', null,
      'current_position', null,
      'people_ahead', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'remaining_attempts', 0,
      'retry_after_seconds', (plate_limit ->> 'retry_after_seconds')::integer,
      'error_code', 'PUBLIC_QUEUE_PLATE_SUCCESS_RATE_LIMITED'
    );
  end if;

  response_remaining_attempts := least(
    (ip_limit ->> 'remaining_attempts')::integer,
    (plate_limit ->> 'remaining_attempts')::integer
  );

  search_result := jsonb_build_object(
    'status', 'FOUND',
    'queue_number', matched.permanent_number,
    'ticket_number', matched.permanent_number,
    'permanent_number', matched.permanent_number,
    'current_position', matched.daily_position,
    'people_ahead', case when matched.daily_position is null then null else greatest(matched.daily_position - 1, 0) end,
    'preferred_fuel_type', matched.preferred_fuel_type,
    'fuel_preference_mode', matched.fuel_preference_mode,
    'allocation_status', matched.allocation_status,
    'arrival_at', matched.arrival_at,
    'public_status', case
      when matched.status <> 'WAITING' then 'COMPLETED_OR_CANCELLED'
      when matched.allocation_id is null then 'QUEUE_NOT_READY'
      when matched.allocation_status = 'PAUSED_BY_LIMIT' then 'PAUSED_BY_LIMIT'
      when matched.allocation_status = 'ACTIVE' then 'IN_CALL_LIST'
      else 'QUEUE_NOT_READY'
    end,
    'is_within_today_limit', matched.allocation_status = 'ACTIVE',
    'is_callable_now', matched.allocation_status = 'ACTIVE',
    'matched_fuel_type', matched.assigned_fuel_type,
    'remaining_attempts', response_remaining_attempts,
    'retry_after_seconds', 0
  );

  return search_result;
end;
$$;

ALTER FUNCTION public.check_public_queue_position(text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_public_queue_position(text, text, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_public_queue_position(text, text, text) TO service_role;
