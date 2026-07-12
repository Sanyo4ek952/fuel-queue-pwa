CREATE OR REPLACE FUNCTION public.get_my_queue_status() RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  current_profile_id uuid := public.get_current_profile_id();
begin
  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  return (
    with raw_base as (
      select
        fqe.*,
        dqa.id as allocation_id,
        dqa.allocation_date,
        dqa.station_id as allocation_station_id,
        dqa.assigned_fuel_type,
        dqa.daily_position,
        dqa.station_position,
        dqa.station_fuel_position,
        dqa.arrival_at,
        dqa.status as allocation_status,
        dqa.call_status,
        s.name as station_name,
        s.address as station_address,
        v.normalized_plate_number,
        d.full_name as driver_full_name,
        d.phone as driver_phone,
        public.get_fuel_queue_category(coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type)) as effective_fuel_category
      from public.fuel_queue_entries fqe
      join public.vehicles v on v.id = fqe.vehicle_id
      left join public.drivers d on d.id = fqe.driver_id
      left join public.daily_queue_allocations dqa
        on dqa.queue_entry_id = fqe.id
       and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
       and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED')
      left join public.stations s on s.id = dqa.station_id
      where fqe.status = 'WAITING'
        and not exists (
          select 1
          from public.fueling_records fr
          where fr.vehicle_id = fqe.vehicle_id
            and fr.date = (now() at time zone 'Europe/Moscow')::date
            and coalesce(fr.is_manual_override, false) = false
            and fr.preferential_queue_entry_id is null
        )
    ),
    positioned as (
      select
        raw_base.*,
        row_number() over (
          partition by raw_base.effective_fuel_category
          order by raw_base.permanent_number, raw_base.id
        )::integer as fuel_queue_position
      from raw_base
    )
    select public.queue_entry_to_json(fqe_json) || jsonb_build_object(
      'normalized_plate_number', positioned.normalized_plate_number,
      'driver_full_name', positioned.driver_full_name,
      'driver_phone', positioned.driver_phone,
      'fuel_queue_position', positioned.fuel_queue_position,
      'allocation', case when positioned.allocation_id is null then null else jsonb_build_object(
        'id', positioned.allocation_id,
        'date', positioned.allocation_date,
        'station_id', positioned.allocation_station_id,
        'station_name', positioned.station_name,
        'station_address', positioned.station_address,
        'assigned_fuel_type', positioned.assigned_fuel_type,
        'daily_position', positioned.daily_position,
        'station_position', positioned.station_position,
        'station_fuel_position', positioned.station_fuel_position,
        'arrival_at', positioned.arrival_at,
        'status', positioned.allocation_status,
        'call_status', positioned.call_status
      ) end,
      'date', positioned.allocation_date,
      'station_id', positioned.allocation_station_id,
      'station_name', positioned.station_name,
      'station_address', positioned.station_address,
      'current_position', positioned.daily_position,
      'people_ahead', case when positioned.daily_position is null then null else greatest(positioned.daily_position - 1, 0) end,
      'matched_fuel_type', positioned.assigned_fuel_type,
      'is_within_today_limit', positioned.allocation_status = 'ACTIVE',
      'is_callable_now', positioned.allocation_status = 'ACTIVE',
      'is_fuel_preference_update_locked', positioned.allocation_id is not null and positioned.allocation_status in ('ACTIVE', 'PAUSED_BY_LIMIT')
    )
    from positioned
    join public.fuel_queue_entries fqe_json on fqe_json.id = positioned.id
    join public.profile_vehicles pv
      on pv.vehicle_id = positioned.vehicle_id
     and pv.profile_id = current_profile_id
    where positioned.operator_id = current_profile_id
       or pv.created_at <= positioned.created_at
    order by positioned.permanent_number
    limit 1
  );
end;
$$;

ALTER FUNCTION public.get_my_queue_status() OWNER TO postgres;
GRANT ALL ON FUNCTION public.get_my_queue_status() TO authenticated;

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
      'fuel_queue_position', null,
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
      'fuel_queue_position', null,
      'is_within_today_limit', null,
      'is_callable_now', null,
      'remaining_attempts', (ip_limit ->> 'remaining_attempts')::integer,
      'retry_after_seconds', 0
    );
  end if;

  with matched_base as (
    select
      fqe.*,
      dqa.id as allocation_id,
      dqa.daily_position,
      dqa.station_position,
      dqa.station_fuel_position,
      dqa.arrival_at,
      dqa.status as allocation_status,
      dqa.assigned_fuel_type,
      dqa.call_status,
      v.normalized_plate_number,
      d.phone as driver_phone,
      public.get_fuel_queue_category(coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type)) as effective_fuel_category
    from public.fuel_queue_entries fqe
    join public.vehicles v on v.id = fqe.vehicle_id
    left join public.drivers d on d.id = fqe.driver_id
    left join public.daily_queue_allocations dqa
      on dqa.queue_entry_id = fqe.id
     and dqa.allocation_date = (now() at time zone 'Europe/Moscow')::date
     and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED')
  ),
  position_base as (
    select matched_base.*
    from matched_base
    where matched_base.status = 'WAITING'
      and not exists (
        select 1
        from public.fueling_records fr
        where fr.vehicle_id = matched_base.vehicle_id
          and fr.date = (now() at time zone 'Europe/Moscow')::date
          and coalesce(fr.is_manual_override, false) = false
          and fr.preferential_queue_entry_id is null
      )
  ),
  positions as (
    select
      position_base.id,
      row_number() over (
        partition by position_base.effective_fuel_category
        order by position_base.permanent_number, position_base.id
      )::integer as fuel_queue_position
    from position_base
  ),
  positioned as (
    select matched_base.*, positions.fuel_queue_position
    from matched_base
    left join positions on positions.id = matched_base.id
  )
  select *
  into matched
  from positioned
  where normalized_plate_number = normalized_plate
    and right(regexp_replace(coalesce(driver_phone, ''), '\D', '', 'g'), 4) = normalized_phone_last4
  order by permanent_number desc
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
        'fuel_queue_position', null,
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
      'fuel_queue_position', null,
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
      'fuel_queue_position', null,
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
    'fuel_queue_position', matched.fuel_queue_position,
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
