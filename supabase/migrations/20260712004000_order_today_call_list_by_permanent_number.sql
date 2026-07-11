CREATE OR REPLACE FUNCTION "public"."get_today_call_list"("target_date" "date" DEFAULT CURRENT_DATE, "page_size" integer DEFAULT 25, "cursor_queue_number" integer DEFAULT NULL::integer, "cursor_id" "uuid" DEFAULT NULL::"uuid", "plate_search" "text" DEFAULT NULL::"text", "created_by_profile_id" "uuid" DEFAULT NULL::"uuid", "call_filter" "text" DEFAULT 'all'::"text", "gasoline_fuel_filter" "text" DEFAULT 'all'::"text", "fuel_category_filter" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  normalized_search text := public.normalize_plate_number(plate_search);
  effective_size integer := least(greatest(coalesce(page_size, 25), 1), 100);
begin
  if public.get_current_profile_id() is null then raise exception 'FORBIDDEN'; end if;

  return (
    with base as (
      select
        coalesce(dqa.id, fqe.id) as id,
        dqa.id as allocation_id,
        fqe.id as queue_entry_id,
        fqe.permanent_number,
        fqe.permanent_number as queue_number,
        fqe.permanent_number as ticket_number,
        dqa.allocation_date as date,
        dqa.station_id,
        s.name as station_name,
        s.address as station_address,
        fqe.vehicle_id,
        fqe.driver_id,
        fqe.operator_id,
        fqe.preferred_fuel_type as fuel_type,
        fqe.preferred_fuel_type,
        fqe.fuel_preference_mode,
        fqe.requested_liters,
        dqa.assigned_fuel_type,
        dqa.assigned_fuel_type as matched_fuel_type,
        coalesce(dqa.daily_position, fqe.permanent_number) as daily_position,
        coalesce(dqa.daily_position, fqe.permanent_number) as current_position,
        greatest(coalesce(dqa.daily_position, fqe.permanent_number) - 1, 0) as people_ahead,
        dqa.station_position,
        dqa.station_fuel_position,
        dqa.arrival_at,
        coalesce(dqa.status, 'PAUSED_BY_LIMIT') as allocation_status,
        fqe.status,
        fqe.sync_status,
        fqe.comment,
        fqe.client_mutation_id,
        dqa.status = 'ACTIVE' as is_within_today_limit,
        dqa.status = 'ACTIVE' as is_callable_now,
        case
          when dqa.status = 'PAUSED_BY_LIMIT' then 'PAUSED_BY_LIMIT'
          when dqa.id is null then 'OUTSIDE_TODAY_LIMIT'
          else null
        end as call_unavailable_reason,
        dqa.call_status as latest_call_status,
        v.normalized_plate_number,
        d.full_name as driver_full_name,
        d.phone as driver_phone,
        op.full_name as created_by_full_name,
        op.role as created_by_role,
        op.signature_name as created_by_signature_name,
        greatest(fqe.updated_at, coalesce(dqa.updated_at, fqe.updated_at)) as updated_at,
        public.get_fuel_queue_category(coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type)) as effective_fuel_category,
        coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type) as effective_fuel_type
      from public.fuel_queue_entries fqe
      join public.vehicles v on v.id = fqe.vehicle_id
      left join public.drivers d on d.id = fqe.driver_id
      left join public.profiles op on op.id = fqe.operator_id
      left join public.daily_queue_allocations dqa
        on dqa.queue_entry_id = fqe.id
       and dqa.allocation_date = target_date
       and dqa.status in ('ACTIVE', 'PAUSED_BY_LIMIT', 'FUELED')
      left join public.stations s on s.id = dqa.station_id
      where fqe.status = 'WAITING'
        and (
          dqa.id is null
          or dqa.station_id is null
          or public.can_access_station(dqa.station_id)
        )
        and not exists (
          select 1
          from public.fueling_records fr
          where fr.vehicle_id = fqe.vehicle_id
            and fr.date = target_date
            and coalesce(fr.is_manual_override, false) = false
        )
    ),
    filtered as (
      select * from base
      where (normalized_search = '' or normalized_plate_number ilike '%' || normalized_search || '%')
        and (created_by_profile_id is null or operator_id = created_by_profile_id)
        and (gasoline_fuel_filter = 'all' or effective_fuel_type = gasoline_fuel_filter)
        and (fuel_category_filter is null or effective_fuel_category = fuel_category_filter)
        and (
          call_filter = 'all'
          or (call_filter = 'call' and allocation_status = 'ACTIVE' and latest_call_status <> 'CONTACTED')
          or (call_filter = 'contacted' and latest_call_status = 'CONTACTED')
          or (call_filter = 'no_answer' and latest_call_status = 'NO_ANSWER')
        )
        and (
          cursor_queue_number is null or cursor_id is null
          or (permanent_number, id) > (cursor_queue_number, cursor_id)
        )
      order by permanent_number, id
      limit effective_size + 1
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(row_value) order by permanent_number, id)
        from (select * from filtered limit effective_size) row_value), '[]'::jsonb),
      'next_cursor', case when (select count(*) from filtered) > effective_size then (
        select jsonb_build_object('queue_number', permanent_number, 'id', id)
        from filtered order by permanent_number, id offset effective_size - 1 limit 1
      ) else null end,
      'summary', jsonb_build_object(
        'total_count', (select count(*) from base),
        'callable_count', (select count(*) from base where allocation_status = 'ACTIVE' and latest_call_status <> 'CONTACTED'),
        'contacted_count', (select count(*) from base where latest_call_status = 'CONTACTED'),
        'no_answer_count', (select count(*) from base where latest_call_status = 'NO_ANSWER'),
        'category_counts', jsonb_build_object(
          'GASOLINE', (select count(*) from base where effective_fuel_category = 'GASOLINE'),
          'DIESEL', (select count(*) from base where effective_fuel_category = 'DIESEL'),
          'GAS', (select count(*) from base where effective_fuel_category = 'GAS')
        ),
        'callable_category_counts', jsonb_build_object(
          'GASOLINE', (select count(*) from base where allocation_status = 'ACTIVE' and effective_fuel_category = 'GASOLINE'),
          'DIESEL', (select count(*) from base where allocation_status = 'ACTIVE' and effective_fuel_category = 'DIESEL'),
          'GAS', (select count(*) from base where allocation_status = 'ACTIVE' and effective_fuel_category = 'GAS')
        )
      )
    )
  );
end;
$$;
