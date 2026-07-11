set search_path = public, extensions;

drop policy if exists fuel_queue_entries_select_accessible on public.fuel_queue_entries;
create policy fuel_queue_entries_select_accessible
on public.fuel_queue_entries for select to authenticated
using (
  public.has_role(array['mayor', 'mayor_assistant'])
  or exists (
    select 1 from public.profile_vehicles pv
    where pv.profile_id = public.get_current_profile_id()
      and pv.vehicle_id = fuel_queue_entries.vehicle_id
  )
  or exists (
    select 1 from public.daily_queue_allocations dqa
    where dqa.queue_entry_id = fuel_queue_entries.id
      and public.can_access_station(dqa.station_id)
  )
);

drop policy if exists daily_queue_allocations_select_accessible on public.daily_queue_allocations;
create policy daily_queue_allocations_select_accessible
on public.daily_queue_allocations for select to authenticated
using (
  public.can_access_station(station_id)
  or exists (
    select 1
    from public.fuel_queue_entries fqe
    join public.profile_vehicles pv on pv.vehicle_id = fqe.vehicle_id
    where fqe.id = daily_queue_allocations.queue_entry_id
      and pv.profile_id = public.get_current_profile_id()
  )
);

drop policy if exists daily_queue_call_logs_select_accessible on public.daily_queue_allocation_call_logs;
create policy daily_queue_call_logs_select_accessible
on public.daily_queue_allocation_call_logs for select to authenticated
using (
  exists (
    select 1 from public.daily_queue_allocations dqa
    where dqa.id = daily_queue_allocation_call_logs.allocation_id
      and public.can_access_station(dqa.station_id)
  )
);

revoke all on public.fuel_queue_entries from anon, authenticated;
revoke all on public.daily_queue_allocations from anon, authenticated;
revoke all on public.daily_queue_allocation_call_logs from anon, authenticated;
grant select on public.fuel_queue_entries to authenticated;
grant select on public.daily_queue_allocations to authenticated;
grant select on public.daily_queue_allocation_call_logs to authenticated;

revoke all on function public.allocate_daily_queue(date) from public, anon, authenticated;
revoke all on function public.finalize_daily_queue(date) from public, anon, authenticated;
revoke all on function public.apply_reservation_no_show_policy(date) from public, anon, authenticated;
grant execute on function public.allocate_daily_queue(date) to service_role;
grant execute on function public.finalize_daily_queue(date) to service_role;

grant execute on function public.create_daily_limit(date, jsonb, uuid, uuid) to authenticated;
grant execute on function public.get_daily_fueling_schedule(date, uuid) to authenticated;
grant execute on function public.set_daily_fueling_schedule(date, uuid, jsonb, uuid) to authenticated;
grant execute on function public.create_reservation(text, text, text, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.create_consumer_reservation(uuid, text, text, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.get_today_call_list(date, integer, integer, uuid, text, uuid, text, text, text) to authenticated;
grant execute on function public.get_today_queue_authors(date, text, text, text) to authenticated;
grant execute on function public.create_reservation_call_log(uuid, text, text, uuid) to authenticated;
grant execute on function public.check_vehicle_access(text, uuid, date) to authenticated;
grant execute on function public.create_fueling_record_for_allocation(uuid, numeric, timestamptz, text, uuid) to authenticated;
grant execute on function public.get_my_queue_status() to authenticated;
grant execute on function public.check_public_queue_position(text, text) to anon, authenticated;
grant execute on function public.sync_offline_mutation(uuid, text, jsonb) to authenticated;
grant execute on function public.update_reservation_fuel_preference(uuid, text, text, uuid) to authenticated;
grant execute on function public.cancel_reservation(uuid, text, text, uuid) to authenticated;
grant execute on function public.cancel_my_reservation(uuid, uuid) to authenticated;
grant execute on function public.get_daily_limit_overview(date) to authenticated;
grant execute on function public.export_queue_backup(date) to authenticated;
