CREATE OR REPLACE FUNCTION "public"."export_queue_backup"("target_date" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'queue_entry_id', fqe.id,
    'permanent_number', fqe.permanent_number,
    'queue_number', fqe.permanent_number,
    'ticket_number', fqe.permanent_number,
    'normalized_plate_number', v.normalized_plate_number,
    'driver_full_name', d.full_name,
    'driver_phone', d.phone,
    'preferred_fuel_type', fqe.preferred_fuel_type,
    'fuel_preference_mode', fqe.fuel_preference_mode,
    'requested_liters', fqe.requested_liters,
    'queue_status', fqe.status,
    'allocation_id', dqa.id,
    'date', dqa.allocation_date,
    'station_id', dqa.station_id,
    'station_name', s.name,
    'assigned_fuel_type', dqa.assigned_fuel_type,
    'matched_fuel_type', coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type),
    'fuel_category', public.get_fuel_queue_category(coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type)),
    'daily_position', dqa.daily_position,
    'station_position', dqa.station_position,
    'station_fuel_position', dqa.station_fuel_position,
    'arrival_at', dqa.arrival_at,
    'allocation_status', dqa.status,
    'latest_call_status', dqa.call_status,
    'is_within_today_limit', dqa.status = 'ACTIVE',
    'is_callable_now', dqa.status = 'ACTIVE',
    'created_at', fqe.created_at,
    'updated_at', greatest(fqe.updated_at, dqa.updated_at)
  ) order by
    case public.get_fuel_queue_category(coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type))
      when 'GASOLINE' then 1
      when 'GAS' then 2
      when 'DIESEL' then 3
      else 99
    end,
    case coalesce(dqa.assigned_fuel_type, fqe.preferred_fuel_type)
      when 'AI_92' then 1
      when 'AI_95' then 2
      when 'AI_100' then 3
      when 'GAS' then 4
      when 'DIESEL' then 5
      else 99
    end,
    fqe.permanent_number), '[]'::jsonb)
  from public.fuel_queue_entries fqe
  join public.vehicles v on v.id = fqe.vehicle_id
  left join public.drivers d on d.id = fqe.driver_id
  left join lateral (
    select *
    from public.daily_queue_allocations allocation
    where allocation.queue_entry_id = fqe.id
      and allocation.status in ('ACTIVE', 'PAUSED_BY_LIMIT')
    order by
      case when target_date is not null and allocation.allocation_date = target_date then 0 else 1 end,
      allocation.allocation_date desc,
      allocation.updated_at desc
    limit 1
  ) dqa on true
  left join public.stations s on s.id = dqa.station_id
  where fqe.status = 'WAITING';
$$;

ALTER FUNCTION "public"."export_queue_backup"("target_date" "date") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."export_queue_backup"("target_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."export_queue_backup"("target_date" "date") TO "service_role";
GRANT ALL ON FUNCTION "public"."export_queue_backup"("target_date" "date") TO "authenticated";
