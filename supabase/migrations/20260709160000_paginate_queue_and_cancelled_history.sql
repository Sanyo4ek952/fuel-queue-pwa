set check_function_bodies = off;
set search_path = public, extensions;

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_reservations_cancelled_cursor
on public.fuel_reservations (cancelled_at desc, id desc)
where status = 'CANCELLED' and cancelled_at is not null;

create index if not exists idx_reservations_active_queue_cursor
on public.fuel_reservations (queue_number asc, id asc)
where status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING');

create index if not exists idx_reservations_active_author_queue_cursor
on public.fuel_reservations (operator_id, queue_number asc, id asc)
where status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING');

create index if not exists idx_vehicles_normalized_plate_number_trgm
on public.vehicles using gin (normalized_plate_number extensions.gin_trgm_ops);

drop function if exists public.get_cancelled_reservations(date, date);

create or replace function public.get_cancelled_reservations(
  page_size integer default 25,
  cursor_cancelled_at timestamptz default null,
  cursor_id uuid default null,
  plate_search text default null,
  date_from date default null,
  date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  current_profile_id uuid;
  actor_user_role text;
  normalized_plate_search text := public.normalize_plate_number(plate_search);
  effective_page_size integer := least(greatest(coalesce(page_size, 25), 1), 100);
begin
  current_profile_id := public.get_current_profile_id();
  actor_user_role := public.get_current_user_role();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if actor_user_role not in ('mayor', 'station_manager', 'mayor_assistant') then
    raise exception 'FORBIDDEN';
  end if;

  if date_from is not null and date_to is not null and date_from > date_to then
    raise exception 'INVALID_DATE_RANGE';
  end if;

  return (
    with matched as (
      select
        fr.*,
        v.normalized_plate_number,
        d.full_name as driver_full_name,
        d.phone as driver_phone,
        op.full_name as created_by_full_name,
        op.role as created_by_role,
        op.signature_name as created_by_signature_name,
        cp.full_name as cancelled_by_full_name,
        cp.role as cancelled_by_role,
        cp.signature_name as cancelled_by_signature_name
      from public.fuel_reservations fr
      join public.vehicles v on v.id = fr.vehicle_id
      left join public.drivers d on d.id = fr.driver_id
      left join public.profiles op on op.id = fr.operator_id
      left join public.profiles cp on cp.id = fr.cancelled_by
      where fr.status = 'CANCELLED'
        and fr.cancelled_at is not null
        and (date_from is null or fr.date >= date_from)
        and (date_to is null or fr.date <= date_to)
        and (
          normalized_plate_search = ''
          or v.normalized_plate_number ilike '%' || normalized_plate_search || '%'
        )
        and (
          cursor_cancelled_at is null
          or cursor_id is null
          or (fr.cancelled_at, fr.id) < (cursor_cancelled_at, cursor_id)
        )
        and public.can_access_station(fr.station_id)
      order by fr.cancelled_at desc, fr.id desc
      limit effective_page_size + 1
    ),
    numbered as (
      select
        matched.*,
        row_number() over (order by matched.cancelled_at desc, matched.id desc) as page_row_number
      from matched
    ),
    visible as (
      select *
      from numbered
      where page_row_number <= effective_page_size
    ),
    next_row as (
      select cancelled_at, id
      from visible
      order by cancelled_at desc, id desc
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
            'fuel_type', visible.fuel_type,
            'requested_liters', visible.requested_liters,
            'queue_number', visible.queue_number,
            'status', visible.status,
            'comment', visible.comment,
            'cancelled_by', visible.cancelled_by,
            'cancelled_at', visible.cancelled_at,
            'cancel_reason', visible.cancel_reason,
            'cancel_comment', visible.cancel_comment,
            'created_at', visible.created_at,
            'updated_at', visible.updated_at,
            'normalized_plate_number', visible.normalized_plate_number,
            'driver_full_name', visible.driver_full_name,
            'driver_phone', visible.driver_phone,
            'created_by_full_name', visible.created_by_full_name,
            'created_by_role', visible.created_by_role,
            'created_by_signature_name', visible.created_by_signature_name,
            'cancelled_by_full_name', visible.cancelled_by_full_name,
            'cancelled_by_role', visible.cancelled_by_role,
            'cancelled_by_signature_name', visible.cancelled_by_signature_name
          )
          order by visible.cancelled_at desc, visible.id desc
        )
        from visible
      ), '[]'::jsonb),
      'next_cursor',
      case
        when (select count(*) from numbered) > effective_page_size then (
          select jsonb_build_object(
            'cancelled_at', next_row.cancelled_at,
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

drop function if exists public.get_today_call_list(date);

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

  if effective_call_filter not in ('all', 'call', 'contacted', 'no_answer', 'call_later') then
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
            and lc.status in ('NO_ANSWER', 'WRONG_NUMBER')
          )
          or (
            effective_call_filter = 'call_later'
            and lc.status = 'CALL_LATER'
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

  if effective_call_filter not in ('all', 'call', 'contacted', 'no_answer', 'call_later') then
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
            and lc.status in ('NO_ANSWER', 'WRONG_NUMBER')
          )
          or (
            effective_call_filter = 'call_later'
            and lc.status = 'CALL_LATER'
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

grant execute on function public.get_cancelled_reservations(integer, timestamptz, uuid, text, date, date) to authenticated;
grant execute on function public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text) to authenticated;
grant execute on function public.get_today_queue_authors(date, text, text, text) to authenticated;
