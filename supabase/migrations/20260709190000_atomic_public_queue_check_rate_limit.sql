set check_function_bodies = off;
set search_path = public, extensions;

drop index if exists public.idx_public_queue_check_attempts_date_ip;
drop index if exists public.idx_public_queue_check_attempts_date_lookup;

delete from public.public_queue_check_attempts;

alter table public.public_queue_check_attempts
  drop constraint if exists public_queue_check_attempts_pkey,
  drop constraint if exists public_queue_check_attempts_scope_check,
  drop constraint if exists public_queue_check_attempts_attempt_count_check,
  drop constraint if exists public_queue_check_attempts_scope_key_unique,
  drop column if exists id,
  drop column if exists ip_key,
  drop column if exists lookup_key,
  add column if not exists scope text,
  add column if not exists attempt_key text,
  add column if not exists attempt_count integer,
  add column if not exists updated_at timestamptz;

alter table public.public_queue_check_attempts
  alter column scope set not null,
  alter column attempt_key set not null,
  alter column attempt_count set default 0,
  alter column attempt_count set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.public_queue_check_attempts
  add constraint public_queue_check_attempts_scope_check
    check (scope in ('IP', 'LOOKUP')),
  add constraint public_queue_check_attempts_attempt_count_check
    check (attempt_count >= 0),
  add constraint public_queue_check_attempts_scope_key_unique
    unique (attempt_date, scope, attempt_key);

create index if not exists idx_public_queue_check_attempts_date
on public.public_queue_check_attempts (attempt_date);

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
  max_attempts integer := 20;
  normalized_plate text;
  normalized_phone_last4 text;
  request_headers_text text;
  request_headers jsonb := '{}'::jsonb;
  raw_ip text;
  current_ip_key text;
  current_lookup_key text;
  current_attempt_date date := (now() at time zone 'Europe/Moscow')::date;
  updated_scope_count integer;
  used_attempt_count integer;
  remaining_attempts integer;
  matched_record record;
begin
  delete from public.public_queue_check_attempts attempts
  where attempts.attempt_date < current_attempt_date;

  normalized_plate := public.normalize_plate_number(plate_number);
  normalized_phone_last4 := regexp_replace(coalesce(phone_last4, ''), '\D', '', 'g');

  if normalized_plate !~ '^[РђР’Р•РљРњРќРћР РЎРўРЈРҐ][0-9]{3}[РђР’Р•РљРњРќРћР РЎРўРЈРҐ]{2}[0-9]{2,3}$'
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

  begin
    with rate_limit_updates as (
      insert into public.public_queue_check_attempts (
        attempt_date,
        scope,
        attempt_key,
        attempt_count,
        updated_at
      )
      values
        (current_attempt_date, 'IP', current_ip_key, 1, now()),
        (current_attempt_date, 'LOOKUP', current_lookup_key, 1, now())
      on conflict (attempt_date, scope, attempt_key) do update
      set
        attempt_count = public.public_queue_check_attempts.attempt_count + 1,
        updated_at = now()
      where public.public_queue_check_attempts.attempt_count < max_attempts
      returning attempt_count
    )
    select count(*)::integer, max(attempt_count)::integer
    into updated_scope_count, used_attempt_count
    from rate_limit_updates;

    if updated_scope_count <> 2 then
      raise exception 'PUBLIC_QUEUE_RATE_LIMIT_EXCEEDED' using errcode = 'P0001';
    end if;
  exception
    when raise_exception then
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
  end;

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

grant execute on function public.check_public_queue_position(text, text) to anon, authenticated;
