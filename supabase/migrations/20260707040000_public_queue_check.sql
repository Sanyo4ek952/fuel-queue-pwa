set check_function_bodies = off;
set search_path = public, extensions;

create table if not exists public.public_queue_check_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_date date not null,
  ip_key text not null,
  lookup_key text not null,
  created_at timestamptz not null default now()
);

alter table public.public_queue_check_attempts enable row level security;

create index if not exists idx_public_queue_check_attempts_date_ip
on public.public_queue_check_attempts (attempt_date, ip_key);

create index if not exists idx_public_queue_check_attempts_date_lookup
on public.public_queue_check_attempts (attempt_date, lookup_key);

revoke all on public.public_queue_check_attempts from anon, authenticated;

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
  active_statuses text[] := array['RESERVED', 'ARRIVED', 'APPROVED', 'FUELING'];
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
  matched_queue_number integer;
  matched_is_within_today_limit boolean;
begin
  normalized_plate := public.normalize_plate_number(plate_number);
  normalized_phone_last4 := regexp_replace(coalesce(phone_last4, ''), '\D', '', 'g');

  if normalized_plate !~ '^[АВЕКМНОРСТУХ][0-9]{3}[АВЕКМНОРСТУХ]{2}[0-9]{2,3}$'
    or normalized_phone_last4 !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'status', 'INVALID_INPUT',
      'queue_number', null,
      'is_within_today_limit', null,
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
      'is_within_today_limit', null,
      'remaining_attempts', 0
    );
  end if;

  insert into public.public_queue_check_attempts (
    attempt_date,
    ip_key,
    lookup_key
  )
  values (
    current_attempt_date,
    current_ip_key,
    current_lookup_key
  );

  used_attempt_count := greatest(ip_attempt_count + 1, lookup_attempt_count + 1);
  remaining_attempts := greatest(max_attempts - used_attempt_count, 0);

  with daily_limit as (
    select *
    from public.daily_limits dl
    where dl.date = current_attempt_date
      and dl.station_id is null
      and dl.status = 'OPEN'
    limit 1
  ),
  active_reservations as (
    select
      fr.id,
      fr.vehicle_id,
      fr.driver_id,
      fr.fuel_type,
      public.get_fuel_queue_category(fr.fuel_type) as fuel_category,
      coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
      fr.queue_number
    from public.fuel_reservations fr
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = current_attempt_date
    where fr.status = any(active_statuses)
      and public.get_fuel_queue_category(fr.fuel_type) in ('GASOLINE', 'DIESEL', 'GAS')
  ),
  ranked as (
    select
      ar.*,
      row_number() over (partition by ar.fuel_category order by ar.queue_number asc, ar.id asc)::integer as category_position,
      sum(ar.effective_liters) over (partition by ar.fuel_category order by ar.queue_number asc, ar.id asc)::numeric as category_liters
    from active_reservations ar
  ),
  projected as (
    select
      r.*,
      (
        dl.id is not null
        and (
          (dftl.limit_mode = 'vehicle_count' and r.category_position <= dftl.vehicle_limit)
          or (dftl.limit_mode = 'fuel_liters' and r.category_liters <= coalesce(dftl.liters_limit, 0))
        )
      ) as is_within_today_limit
    from ranked r
    left join daily_limit dl on true
    left join public.daily_fuel_type_limits dftl
      on dftl.daily_limit_id = dl.id
     and dftl.fuel_category = r.fuel_category
  )
  select p.queue_number, p.is_within_today_limit
  into matched_queue_number, matched_is_within_today_limit
  from projected p
  join public.vehicles v on v.id = p.vehicle_id
  join public.drivers d on d.id = p.driver_id
  where v.normalized_plate_number = normalized_plate
    and right(regexp_replace(coalesce(d.phone, ''), '\D', '', 'g'), 4) = normalized_phone_last4
  order by p.queue_number asc, p.id asc
  limit 1;

  if matched_queue_number is null then
    return jsonb_build_object(
      'status', 'NOT_FOUND',
      'queue_number', null,
      'is_within_today_limit', null,
      'remaining_attempts', remaining_attempts
    );
  end if;

  return jsonb_build_object(
    'status', 'FOUND',
    'queue_number', matched_queue_number,
    'is_within_today_limit', coalesce(matched_is_within_today_limit, false),
    'remaining_attempts', remaining_attempts
  );
end;
$$;

revoke execute on function public.check_public_queue_position(text, text) from public;
grant execute on function public.check_public_queue_position(text, text) to anon;
grant execute on function public.check_public_queue_position(text, text) to authenticated;
