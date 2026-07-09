set check_function_bodies = off;
set search_path = public, extensions;

update public.reservation_call_logs
set status = 'NO_ANSWER'
where status in ('CALL_LATER', 'WRONG_NUMBER');

alter table public.reservation_call_logs
  drop constraint if exists reservation_call_logs_status_check,
  add constraint reservation_call_logs_status_check
    check (status in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER'));

create or replace function public.create_reservation_call_log(
  reservation_id uuid,
  status text,
  comment text default null,
  client_mutation_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  effective_client_mutation_id uuid := coalesce(create_reservation_call_log.client_mutation_id, gen_random_uuid());
  existing_call_row public.reservation_call_logs%rowtype;
  reservation_row public.fuel_reservations%rowtype;
  callable_row record;
  latest_call_row public.reservation_call_logs%rowtype;
  saved_call_row public.reservation_call_logs%rowtype;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if create_reservation_call_log.status not in ('NOT_CALLED', 'CONTACTED', 'NO_ANSWER') then
    raise exception 'INVALID_CALL_STATUS';
  end if;

  select *
  into existing_call_row
  from public.reservation_call_logs rcl
  where rcl.client_mutation_id = effective_client_mutation_id
  limit 1;

  if existing_call_row.id is not null then
    return public.reservation_call_log_to_json(existing_call_row);
  end if;

  select *
  into reservation_row
  from public.fuel_reservations fr
  where fr.id = create_reservation_call_log.reservation_id
    and fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  limit 1;

  if reservation_row.id is null then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  select *
  into callable_row
  from public.get_callable_reservations(current_date) cr
  where cr.reservation_id = create_reservation_call_log.reservation_id
  limit 1;

  select *
  into latest_call_row
  from public.reservation_call_logs rcl
  where rcl.reservation_id = create_reservation_call_log.reservation_id
  order by rcl.called_at desc, rcl.created_at desc
  limit 1;

  if callable_row.reservation_id is null or callable_row.is_callable_now is not true then
    if not (
      create_reservation_call_log.status = 'NOT_CALLED'
      and latest_call_row.status = 'CONTACTED'
    ) then
      raise exception 'RESERVATION_NOT_CALLABLE';
    end if;
  end if;

  insert into public.reservation_call_logs (
    reservation_id,
    status,
    called_by,
    comment,
    client_mutation_id,
    sync_status
  )
  values (
    create_reservation_call_log.reservation_id,
    create_reservation_call_log.status,
    current_profile_id,
    nullif(trim(coalesce(create_reservation_call_log.comment, '')), ''),
    effective_client_mutation_id,
    'SYNCED'
  )
  returning * into saved_call_row;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, new_value)
  values (
    current_profile_id,
    'CREATE_RESERVATION_CALL_LOG',
    'reservation_call_log',
    saved_call_row.id,
    public.reservation_call_log_to_json(saved_call_row)
  );

  return public.reservation_call_log_to_json(saved_call_row);
end;
$$;

create or replace function public.get_today_call_list(
  target_date date default current_date,
  page_size integer default 25,
  cursor_queue_number integer default null,
  cursor_id uuid default null,
  plate_search text default null,
  created_by_profile_id uuid default null,
  call_filter text default 'all',
  gasoline_fuel_filter text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  current_profile_id uuid;
  normalized_plate_search text := public.normalize_plate_number(plate_search);
  effective_page_size integer := least(greatest(coalesce(page_size, 25), 1), 100);
  effective_call_filter text := coalesce(call_filter, 'all');
  effective_gasoline_fuel_filter text := coalesce(gasoline_fuel_filter, 'all');
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if effective_call_filter not in ('all', 'call', 'contacted', 'no_answer') then
    raise exception 'INVALID_CALL_FILTER';
  end if;

  if effective_gasoline_fuel_filter not in ('all', 'AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_GASOLINE_FUEL_FILTER';
  end if;

  return (
    with active_reservations as (
      select
        fr.*,
        row_number() over (order by fr.queue_number asc, fr.id asc)::integer as current_position
      from public.fuel_reservations fr
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
        and public.can_access_station(fr.station_id)
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
    ),
    enriched as (
      select
        fr.*,
        coalesce(c.is_within_today_limit, false) as is_within_today_limit,
        coalesce(c.is_callable_now, false) as is_callable_now,
        c.call_unavailable_reason,
        c.matched_fuel_type,
        v.normalized_plate_number,
        d.full_name as driver_full_name,
        d.phone as driver_phone,
        op.full_name as created_by_full_name,
        op.role as created_by_role,
        op.signature_name as created_by_signature_name,
        lc.status as latest_call_status,
        lc.called_by as latest_called_by_profile_id,
        lc.called_at as latest_called_at,
        lc.comment as latest_call_comment,
        lc.client_mutation_id as latest_call_client_mutation_id,
        lc.sync_status as latest_call_sync_status,
        cp.full_name as latest_called_by_full_name,
        cp.role as latest_called_by_role,
        cp.signature_name as latest_called_by_signature_name,
        coalesce(pvll.liters, fr.requested_liters, 20) as effective_liters
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
      where (
          normalized_plate_search = ''
          or v.normalized_plate_number ilike '%' || normalized_plate_search || '%'
        )
        and (
          created_by_profile_id is null
          or fr.operator_id = created_by_profile_id
        )
        and (
          effective_call_filter = 'all'
          or (
            effective_call_filter = 'call'
            and coalesce(c.is_callable_now, false)
            and coalesce(lc.status, 'NOT_CALLED') <> 'CONTACTED'
          )
          or (
            effective_call_filter = 'contacted'
            and lc.status = 'CONTACTED'
          )
          or (
            effective_call_filter = 'no_answer'
            and lc.status = 'NO_ANSWER'
          )
        )
        and (
          effective_gasoline_fuel_filter = 'all'
          or public.get_fuel_queue_category(fr.fuel_type) <> 'GASOLINE'
          or coalesce(c.matched_fuel_type, fr.fuel_type) = effective_gasoline_fuel_filter
        )
        and (
          cursor_queue_number is null
          or cursor_id is null
          or (fr.queue_number, fr.id) > (cursor_queue_number, cursor_id)
        )
      order by fr.queue_number asc, fr.id asc
      limit effective_page_size + 1
    ),
    numbered as (
      select
        enriched.*,
        row_number() over (order by enriched.queue_number asc, enriched.id asc) as page_row_number
      from enriched
    ),
    visible as (
      select *
      from numbered
      where page_row_number <= effective_page_size
    ),
    next_row as (
      select queue_number, id
      from visible
      order by queue_number asc, id asc
      offset greatest(effective_page_size - 1, 0)
      limit 1
    )
    select jsonb_build_object(
      'rows',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', visible.id,
            'date', visible.date,
            'station_id', visible.station_id,
            'vehicle_id', visible.vehicle_id,
            'driver_id', visible.driver_id,
            'operator_id', visible.operator_id,
            'fuel_type', visible.fuel_type,
            'preferred_fuel_type', visible.fuel_type,
            'fuel_preference_mode', visible.fuel_preference_mode,
            'fuel_category', public.get_fuel_queue_category(visible.fuel_type),
            'requested_liters', visible.requested_liters,
            'effective_liters', visible.effective_liters,
            'queue_number', visible.queue_number,
            'ticket_number', visible.queue_number,
            'current_position', visible.current_position,
            'people_ahead', greatest(visible.current_position - 1, 0),
            'status', visible.status,
            'comment', visible.comment,
            'client_mutation_id', visible.client_mutation_id,
            'sync_status', visible.sync_status,
            'created_at', visible.created_at,
            'updated_at', visible.updated_at,
            'is_within_today_limit', visible.is_within_today_limit,
            'is_callable_now', visible.is_callable_now,
            'call_unavailable_reason', visible.call_unavailable_reason,
            'matched_fuel_type', visible.matched_fuel_type,
            'normalized_plate_number', visible.normalized_plate_number,
            'driver_full_name', visible.driver_full_name,
            'driver_phone', visible.driver_phone,
            'created_by_full_name', visible.created_by_full_name,
            'created_by_role', visible.created_by_role,
            'created_by_signature_name', visible.created_by_signature_name,
            'latest_call_status', visible.latest_call_status,
            'latest_called_by_profile_id', visible.latest_called_by_profile_id,
            'latest_called_by_full_name', visible.latest_called_by_full_name,
            'latest_called_by_role', visible.latest_called_by_role,
            'latest_called_by_signature_name', visible.latest_called_by_signature_name,
            'latest_called_at', visible.latest_called_at,
            'latest_call_comment', visible.latest_call_comment,
            'latest_call_client_mutation_id', visible.latest_call_client_mutation_id,
            'latest_call_sync_status', visible.latest_call_sync_status
          )
          order by visible.queue_number asc, visible.id asc
        )
        from visible
      ), '[]'::jsonb),
      'next_cursor',
      case
        when (select count(*) from numbered) > effective_page_size then (
          select jsonb_build_object(
            'queue_number', next_row.queue_number,
            'id', next_row.id
          )
          from next_row
        )
        else null
      end
    )
  );
end;
$$;

create or replace function public.get_today_queue_authors(
  target_date date default current_date,
  plate_search text default null,
  call_filter text default 'all',
  gasoline_fuel_filter text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  current_profile_id uuid;
  normalized_plate_search text := public.normalize_plate_number(plate_search);
  effective_call_filter text := coalesce(call_filter, 'all');
  effective_gasoline_fuel_filter text := coalesce(gasoline_fuel_filter, 'all');
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  if effective_call_filter not in ('all', 'call', 'contacted', 'no_answer') then
    raise exception 'INVALID_CALL_FILTER';
  end if;

  if effective_gasoline_fuel_filter not in ('all', 'AI_92', 'AI_95', 'AI_100') then
    raise exception 'INVALID_GASOLINE_FUEL_FILTER';
  end if;

  return coalesce((
    with callable as (
      select *
      from public.get_callable_reservations(target_date)
    ),
    latest_calls as (
      select distinct on (rcl.reservation_id)
        rcl.reservation_id,
        rcl.status
      from public.reservation_call_logs rcl
      order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
    ),
    matched as (
      select distinct
        fr.operator_id as user_id,
        op.full_name,
        op.role,
        op.signature_name
      from public.fuel_reservations fr
      join public.vehicles v on v.id = fr.vehicle_id
      left join public.profiles op on op.id = fr.operator_id
      left join callable c on c.reservation_id = fr.id
      left join latest_calls lc on lc.reservation_id = fr.id
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
        and fr.operator_id is not null
        and public.can_access_station(fr.station_id)
        and (
          normalized_plate_search = ''
          or v.normalized_plate_number ilike '%' || normalized_plate_search || '%'
        )
        and (
          effective_call_filter = 'all'
          or (
            effective_call_filter = 'call'
            and coalesce(c.is_callable_now, false)
            and coalesce(lc.status, 'NOT_CALLED') <> 'CONTACTED'
          )
          or (
            effective_call_filter = 'contacted'
            and lc.status = 'CONTACTED'
          )
          or (
            effective_call_filter = 'no_answer'
            and lc.status = 'NO_ANSWER'
          )
        )
        and (
          effective_gasoline_fuel_filter = 'all'
          or public.get_fuel_queue_category(fr.fuel_type) <> 'GASOLINE'
          or coalesce(c.matched_fuel_type, fr.fuel_type) = effective_gasoline_fuel_filter
        )
    )
    select jsonb_agg(
      jsonb_build_object(
        'user_id', matched.user_id,
        'display_name', coalesce(nullif(matched.signature_name, ''), nullif(matched.full_name, ''), 'Автор не указан'),
        'role', matched.role,
        'signature_name', matched.signature_name
      )
      order by coalesce(nullif(matched.signature_name, ''), nullif(matched.full_name, ''), 'Автор не указан')
    )
    from matched
  ), '[]'::jsonb);
end;
$$;

create or replace function public.apply_reservation_no_show_policy(
  target_date date default current_date - 1
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  grace_days integer;
  first_process_date date;
  process_date date;
  updated_count integer := 0;
  marked_count integer := 0;
  process_updated_count integer;
  process_marked_count integer;
  marked_row public.fuel_reservations%rowtype;
begin
  if target_date is null or target_date >= current_date then
    target_date := current_date - 1;
  end if;

  grace_days := public.get_reservation_no_show_grace_days();

  if grace_days <= 0 then
    return jsonb_build_object(
      'status', 'SKIPPED',
      'reason', 'NO_SHOW_GRACE_DISABLED',
      'target_date', target_date,
      'updated_count', 0,
      'marked_count', 0
    );
  end if;

  select min(greatest(fr.created_at::date, coalesce(fr.last_missed_fueling_date + 1, fr.created_at::date)))
  into first_process_date
  from public.fuel_reservations fr
  where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
    and fr.created_at::date <= target_date
    and (
      fr.last_missed_fueling_date is null
      or fr.last_missed_fueling_date < target_date
    );

  if first_process_date is null then
    return jsonb_build_object('status', 'SYNCED', 'target_date', target_date, 'updated_count', 0, 'marked_count', 0);
  end if;

  create temporary table if not exists reservation_no_show_marked_ids (
    id uuid primary key
  ) on commit drop;

  for process_date in
    select generate_series(first_process_date, target_date, interval '1 day')::date
  loop
    truncate table reservation_no_show_marked_ids;

    with confirmed_misses as (
      select fr.id
      from public.fuel_reservations fr
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
        and fr.created_at::date <= process_date
        and (
          fr.last_missed_fueling_date is null
          or fr.last_missed_fueling_date < process_date
        )
        and not exists (
          select 1
          from public.fueling_records fueling
          where fueling.reservation_id = fr.id
            and fueling.date = process_date
        )
        and exists (
          select 1
          from public.reservation_call_logs rcl
          where rcl.reservation_id = fr.id
            and rcl.status in ('CONTACTED', 'NO_ANSWER')
            and rcl.called_at::date <= process_date
        )
        and public.is_reservation_callable_on_date(fr.id, process_date)
    ),
    updated as (
      update public.fuel_reservations fr
      set missed_fueling_days = fr.missed_fueling_days + 1,
          last_missed_fueling_date = process_date
      from confirmed_misses cm
      where fr.id = cm.id
      returning fr.*
    ),
    marked as (
      update public.fuel_reservations fr
      set status = 'NO_SHOW',
          sync_status = 'SYNCED'
      from updated u
      where fr.id = u.id
        and u.missed_fueling_days >= grace_days
      returning fr.*
    ),
    marked_ids as (
      insert into reservation_no_show_marked_ids (id)
      select marked.id
      from marked
      on conflict (id) do nothing
      returning id
    )
    select
      (select count(*) from updated)::integer,
      (select count(*) from marked_ids)::integer
    into process_updated_count, process_marked_count;

    updated_count := updated_count + process_updated_count;
    marked_count := marked_count + process_marked_count;

    for marked_row in
      select fr.*
      from public.fuel_reservations fr
      inner join reservation_no_show_marked_ids marked_ids on marked_ids.id = fr.id
    loop
      perform public.audit_action('AUTO_MARK_RESERVATION_NO_SHOW', 'fuel_reservation', marked_row.id, null, to_jsonb(marked_row));
    end loop;
  end loop;

  return jsonb_build_object(
    'status', 'SYNCED',
    'target_date', target_date,
    'updated_count', updated_count,
    'marked_count', marked_count
  );
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
      when matched_record.latest_call_status = 'NO_ANSWER' and matched_record.reservation_status = 'RESERVED' then 'INVITED_BY_OPERATOR'
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

grant execute on function public.create_reservation_call_log(uuid, text, text, uuid) to authenticated;
grant execute on function public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text) to authenticated;
grant execute on function public.get_today_queue_authors(date, text, text, text) to authenticated;
grant execute on function public.apply_reservation_no_show_policy(date) to authenticated;
grant execute on function public.check_public_queue_position(text, text) to anon, authenticated;
