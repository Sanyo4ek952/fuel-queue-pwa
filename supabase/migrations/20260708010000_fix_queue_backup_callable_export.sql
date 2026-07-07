set search_path = public, extensions;

create or replace function public.export_queue_backup(target_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'QUEUE_BACKUP_ACCESS_DENIED';
  end if;

  return coalesce((
    with active_reservations as (
      select
        fr.id,
        fr.date,
        fr.station_id,
        fr.vehicle_id,
        fr.driver_id,
        fr.operator_id,
        fr.fuel_type,
        coalesce(fr.fuel_preference_mode, 'EXACT') as fuel_preference_mode,
        public.get_compatible_fuel_types(
          fr.fuel_type,
          coalesce(fr.fuel_preference_mode, 'EXACT')
        ) as compatible_fuel_types,
        public.get_fuel_queue_category(fr.fuel_type) as fuel_category,
        fr.requested_liters,
        coalesce(pvll.liters, fr.requested_liters, 20)::numeric as effective_liters,
        fr.queue_number,
        fr.status,
        fr.comment,
        fr.client_mutation_id,
        fr.sync_status,
        fr.created_at,
        fr.updated_at
      from public.fuel_reservations fr
      left join public.personal_vehicle_liter_limits pvll
        on pvll.vehicle_id = fr.vehicle_id
       and pvll.date = coalesce(target_date, fr.date)
      where fr.status in ('RESERVED', 'ARRIVED', 'APPROVED', 'FUELING')
        and (
          target_date is null
          or fr.date is null
          or fr.date = target_date
        )
        and public.get_fuel_queue_category(fr.fuel_type) in ('GASOLINE', 'DIESEL', 'GAS')
    ),
    callable as (
      select
        cr.reservation_id,
        cr.is_within_today_limit,
        cr.is_callable_now,
        cr.call_unavailable_reason,
        cr.matched_fuel_type
      from public.get_callable_reservations(target_date) cr
      where target_date is not null
    ),
    latest_calls as (
      select distinct on (rcl.reservation_id)
        rcl.reservation_id,
        rcl.status,
        rcl.called_by,
        rcl.called_at,
        rcl.comment,
        rcl.sync_status
      from public.reservation_call_logs rcl
      order by rcl.reservation_id, rcl.called_at desc, rcl.created_at desc, rcl.id desc
    )
    select jsonb_agg(
      jsonb_build_object(
        'date', ar.date,
        'queue_number', ar.queue_number,
        'station_id', ar.station_id,
        'station_name', s.name,
        'normalized_plate_number', v.normalized_plate_number,
        'driver_full_name', d.full_name,
        'driver_phone', d.phone,
        'preferred_fuel_type', ar.fuel_type,
        'fuel_type', ar.fuel_type,
        'fuel_preference_mode', ar.fuel_preference_mode,
        'compatible_fuel_types', ar.compatible_fuel_types,
        'matched_fuel_type', c.matched_fuel_type,
        'concrete_supply', null,
        'fuel_category', ar.fuel_category,
        'requested_liters', ar.requested_liters,
        'effective_liters', ar.effective_liters,
        'status', ar.status,
        'sync_status', ar.sync_status,
        'is_within_today_limit', c.is_within_today_limit,
        'is_callable_now', c.is_callable_now,
        'call_unavailable_reason', c.call_unavailable_reason,
        'latest_call_status', coalesce(lc.status, 'NOT_CALLED'),
        'invitation_status', coalesce(lc.status, 'NOT_CALLED'),
        'latest_called_by', coalesce(cp.signature_name, cp.full_name),
        'latest_called_at', lc.called_at,
        'latest_call_comment', lc.comment,
        'latest_call_sync_status', lc.sync_status,
        'created_by', coalesce(op.signature_name, op.full_name),
        'created_by_role', op.role,
        'comment', ar.comment,
        'client_mutation_id', ar.client_mutation_id,
        'created_at', ar.created_at,
        'updated_at', ar.updated_at
      )
      order by ar.queue_number asc, ar.id asc
    )
    from active_reservations ar
    left join callable c on c.reservation_id = ar.id
    left join public.stations s on s.id = ar.station_id
    left join public.vehicles v on v.id = ar.vehicle_id
    left join public.drivers d on d.id = ar.driver_id
    left join public.profiles op on op.id = ar.operator_id
    left join latest_calls lc on lc.reservation_id = ar.id
    left join public.profiles cp on cp.id = lc.called_by
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.export_queue_backup(date) from public;
revoke execute on function public.export_queue_backup(date) from anon;
revoke execute on function public.export_queue_backup(date) from authenticated;
grant execute on function public.export_queue_backup(date) to service_role;
