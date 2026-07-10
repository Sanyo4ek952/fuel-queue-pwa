set check_function_bodies = off;
set search_path = public, extensions;

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
          effective_gasoline_fuel_filter = 'all'
          or public.get_fuel_queue_category(fr.fuel_type) <> 'GASOLINE'
          or coalesce(c.matched_fuel_type, fr.fuel_type) = effective_gasoline_fuel_filter
        )
    ),
    filtered_base as (
      select *
      from enriched
      where (
          effective_call_filter = 'all'
          or (
            effective_call_filter = 'call'
            and is_callable_now
            and coalesce(latest_call_status, 'NOT_CALLED') <> 'CONTACTED'
          )
          or (
            effective_call_filter = 'contacted'
            and latest_call_status = 'CONTACTED'
          )
          or (
            effective_call_filter = 'no_answer'
            and latest_call_status = 'NO_ANSWER'
          )
        )
    ),
    page_candidates as (
      select *
      from filtered_base
      where (
          cursor_queue_number is null
          or cursor_id is null
          or (queue_number, id) > (cursor_queue_number, cursor_id)
        )
      order by queue_number asc, id asc
      limit effective_page_size + 1
    ),
    numbered as (
      select
        page_candidates.*,
        row_number() over (order by page_candidates.queue_number asc, page_candidates.id asc) as page_row_number
      from page_candidates
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
    ),
    summary as (
      select jsonb_build_object(
        'total_count', (select count(*)::integer from filtered_base),
        'callable_count', coalesce((
          select count(*)::integer
          from enriched
          where is_callable_now
            and coalesce(latest_call_status, 'NOT_CALLED') <> 'CONTACTED'
        ), 0),
        'contacted_count', coalesce((
          select count(*)::integer
          from enriched
          where latest_call_status = 'CONTACTED'
        ), 0),
        'no_answer_count', coalesce((
          select count(*)::integer
          from enriched
          where latest_call_status = 'NO_ANSWER'
        ), 0),
        'category_counts', jsonb_build_object(
          'GASOLINE', coalesce((
            select count(*)::integer
            from filtered_base
            where public.get_fuel_queue_category(fuel_type) = 'GASOLINE'
          ), 0),
          'DIESEL', coalesce((
            select count(*)::integer
            from filtered_base
            where public.get_fuel_queue_category(fuel_type) = 'DIESEL'
          ), 0),
          'GAS', coalesce((
            select count(*)::integer
            from filtered_base
            where public.get_fuel_queue_category(fuel_type) = 'GAS'
          ), 0)
        ),
        'callable_category_counts', jsonb_build_object(
          'GASOLINE', coalesce((
            select count(*)::integer
            from enriched
            where is_callable_now
              and public.get_fuel_queue_category(fuel_type) = 'GASOLINE'
          ), 0),
          'DIESEL', coalesce((
            select count(*)::integer
            from enriched
            where is_callable_now
              and public.get_fuel_queue_category(fuel_type) = 'DIESEL'
          ), 0),
          'GAS', coalesce((
            select count(*)::integer
            from enriched
            where is_callable_now
              and public.get_fuel_queue_category(fuel_type) = 'GAS'
          ), 0)
        )
      ) as value
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
      end,
      'summary',
      (select value from summary)
    )
  );
end;
$$;

grant execute on function public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text) to authenticated;
