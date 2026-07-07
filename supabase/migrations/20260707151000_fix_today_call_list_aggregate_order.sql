create or replace function public.get_today_call_list(target_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null then
    raise exception 'FORBIDDEN';
  end if;

  if target_date is null then
    raise exception 'INVALID_DATE';
  end if;

  return coalesce((
    with callable as (
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
    )
    select jsonb_agg(
      jsonb_build_object(
        'id', fr.id,
        'date', fr.date,
        'station_id', fr.station_id,
        'vehicle_id', fr.vehicle_id,
        'driver_id', fr.driver_id,
        'operator_id', fr.operator_id,
        'fuel_type', fr.fuel_type,
        'preferred_fuel_type', fr.fuel_type,
        'fuel_preference_mode', fr.fuel_preference_mode,
        'fuel_category', public.get_fuel_queue_category(fr.fuel_type),
        'requested_liters', fr.requested_liters,
        'effective_liters', coalesce(pvll.liters, fr.requested_liters, 20),
        'queue_number', fr.queue_number,
        'status', fr.status,
        'comment', fr.comment,
        'client_mutation_id', fr.client_mutation_id,
        'sync_status', fr.sync_status,
        'created_at', fr.created_at,
        'updated_at', fr.updated_at,
        'is_within_today_limit', coalesce(c.is_within_today_limit, false),
        'is_callable_now', coalesce(c.is_callable_now, false),
        'call_unavailable_reason', c.call_unavailable_reason,
        'matched_fuel_type', c.matched_fuel_type,
        'normalized_plate_number', v.normalized_plate_number,
        'driver_full_name', d.full_name,
        'driver_phone', d.phone,
        'created_by_full_name', op.full_name,
        'created_by_role', op.role,
        'created_by_signature_name', op.signature_name,
        'latest_call_status', lc.status,
        'latest_called_by_profile_id', lc.called_by,
        'latest_called_by_full_name', cp.full_name,
        'latest_called_by_role', cp.role,
        'latest_called_by_signature_name', cp.signature_name,
        'latest_called_at', lc.called_at,
        'latest_call_comment', lc.comment,
        'latest_call_client_mutation_id', lc.client_mutation_id,
        'latest_call_sync_status', lc.sync_status
      )
      order by fr.queue_number asc, fr.id asc
    )
    from public.fuel_reservations fr
    join public.vehicles v on v.id = fr.vehicle_id
    left join public.drivers d on d.id = fr.driver_id
    left join public.profiles op on op.id = fr.operator_id
    left join public.personal_vehicle_liter_limits pvll
      on pvll.vehicle_id = fr.vehicle_id
     and pvll.date = target_date
    left join callable c on c.reservation_id = fr.id
    left join latest_calls lc on lc.reservation_id = fr.id
    left join public.profiles cp on cp.id = lc.called_by
    where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.get_today_call_list(date) to authenticated;
