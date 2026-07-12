CREATE TABLE IF NOT EXISTS public.public_queue_check_rate_limits (
  scope text NOT NULL,
  scope_key text NOT NULL,
  window_started_at timestamp with time zone DEFAULT now() NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  blocked_until timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT public_queue_check_rate_limits_pkey PRIMARY KEY (scope, scope_key),
  CONSTRAINT public_queue_check_rate_limits_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT public_queue_check_rate_limits_scope_check CHECK (
    scope = ANY (ARRAY['IP_REQUEST'::text, 'PLATE_FAILURE'::text, 'PLATE_SUCCESS'::text])
  ),
  CONSTRAINT public_queue_check_rate_limits_scope_key_check CHECK (length(trim(scope_key)) > 0)
);

ALTER TABLE public.public_queue_check_rate_limits OWNER TO postgres;
ALTER TABLE public.public_queue_check_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_public_queue_check_rate_limits_blocked_until
  ON public.public_queue_check_rate_limits USING btree (blocked_until);

REVOKE ALL ON TABLE public.public_queue_check_rate_limits FROM PUBLIC;
GRANT REFERENCES, TRIGGER, TRUNCATE, MAINTAIN ON TABLE public.public_queue_check_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.apply_public_queue_rate_limit(
  limit_scope text,
  limit_key text,
  max_attempts integer,
  window_duration interval,
  block_duration interval
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
declare
  limit_row public.public_queue_check_rate_limits%rowtype;
  checked_at timestamptz := now();
  next_attempt_count integer;
  retry_after_seconds integer := 0;
begin
  if limit_scope not in ('IP_REQUEST', 'PLATE_FAILURE', 'PLATE_SUCCESS') then
    raise exception 'INVALID_RATE_LIMIT_SCOPE';
  end if;

  if trim(coalesce(limit_key, '')) = '' then
    raise exception 'INVALID_RATE_LIMIT_KEY';
  end if;

  if max_attempts <= 0 or window_duration <= interval '0 seconds' or block_duration <= interval '0 seconds' then
    raise exception 'INVALID_RATE_LIMIT_CONFIG';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('public_queue_check_rate_limit:' || limit_scope || ':' || limit_key, 0)
  );

  select *
  into limit_row
  from public.public_queue_check_rate_limits
  where scope = limit_scope
    and scope_key = limit_key
  for update;

  if limit_row.scope is null then
    insert into public.public_queue_check_rate_limits (
      scope,
      scope_key,
      window_started_at,
      attempt_count,
      blocked_until,
      updated_at
    )
    values (
      limit_scope,
      limit_key,
      checked_at,
      1,
      null,
      checked_at
    )
    returning * into limit_row;

    return jsonb_build_object(
      'allowed', true,
      'remaining_attempts', greatest(max_attempts - 1, 0),
      'retry_after_seconds', 0
    );
  end if;

  if limit_row.blocked_until is not null and limit_row.blocked_until > checked_at then
    retry_after_seconds := ceil(extract(epoch from (limit_row.blocked_until - checked_at)))::integer;

    return jsonb_build_object(
      'allowed', false,
      'remaining_attempts', 0,
      'retry_after_seconds', greatest(retry_after_seconds, 1)
    );
  end if;

  if
    (limit_row.blocked_until is not null and limit_row.blocked_until <= checked_at)
    or limit_row.window_started_at <= checked_at - window_duration
  then
    update public.public_queue_check_rate_limits
    set window_started_at = checked_at,
        attempt_count = 0,
        blocked_until = null,
        updated_at = checked_at
    where scope = limit_scope
      and scope_key = limit_key
    returning * into limit_row;
  end if;

  if limit_row.attempt_count >= max_attempts then
    update public.public_queue_check_rate_limits
    set attempt_count = attempt_count + 1,
        blocked_until = checked_at + block_duration,
        updated_at = checked_at
    where scope = limit_scope
      and scope_key = limit_key
    returning * into limit_row;

    return jsonb_build_object(
      'allowed', false,
      'remaining_attempts', 0,
      'retry_after_seconds', ceil(extract(epoch from block_duration))::integer
    );
  end if;

  next_attempt_count := limit_row.attempt_count + 1;

  update public.public_queue_check_rate_limits
  set attempt_count = next_attempt_count,
      updated_at = checked_at
  where scope = limit_scope
    and scope_key = limit_key
  returning * into limit_row;

  return jsonb_build_object(
    'allowed', true,
    'remaining_attempts', greatest(max_attempts - next_attempt_count, 0),
    'retry_after_seconds', 0
  );
end;
$$;

ALTER FUNCTION public.apply_public_queue_rate_limit(text, text, integer, interval, interval) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_public_queue_rate_limit(text, text, integer, interval, interval) FROM PUBLIC;

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
      5,
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

REVOKE ALL ON FUNCTION public.check_public_queue_position(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_public_queue_position(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.check_public_queue_position(text, text) FROM authenticated;
GRANT ALL ON FUNCTION public.check_public_queue_position(text, text) TO service_role;
