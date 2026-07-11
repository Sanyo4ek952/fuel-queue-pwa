-- Local persistent city queue seed without daily limits or allocations.
-- Run after supabase/local-dev-users.sql.

do $$
declare
  seed_comment text := 'Local 250 city queue seed';
  operator_profile_id uuid;
  consumer_row record;
  driver_id_value uuid;
  queue_entry_id_value uuid;
  fuel_type_value text;
  preference_mode_value text;
  n integer := 0;
begin
  perform set_config('search_path', 'public, extensions', true);

  select id
  into operator_profile_id
  from public.profiles
  where role in ('mayor', 'mayor_assistant', 'station_manager')
    and is_active
    and approval_status = 'approved'
  order by case role when 'mayor' then 0 when 'station_manager' then 1 else 2 end, id
  limit 1;

  if operator_profile_id is null then
    raise exception 'Run local-dev-users.sql first.';
  end if;

  delete from public.daily_queue_allocation_call_logs call_log
  using public.daily_queue_allocations allocation
  join public.fuel_queue_entries queue_entry on queue_entry.id = allocation.queue_entry_id
  where call_log.allocation_id = allocation.id
    and queue_entry.comment = seed_comment;

  delete from public.fueling_records fueling_record
  using public.fuel_queue_entries queue_entry
  where fueling_record.queue_entry_id = queue_entry.id
    and queue_entry.comment = seed_comment;

  delete from public.refusal_records refusal_record
  using public.fuel_queue_entries queue_entry
  where refusal_record.queue_entry_id = queue_entry.id
    and queue_entry.comment = seed_comment;

  delete from public.daily_queue_allocations allocation
  using public.fuel_queue_entries queue_entry
  where allocation.queue_entry_id = queue_entry.id
    and queue_entry.comment = seed_comment;

  delete from public.fuel_queue_entries
  where comment = seed_comment;

  for consumer_row in
    select
      p.id as profile_id,
      p.full_name,
      p.phone,
      v.id as vehicle_id
    from public.profiles p
    join auth.users u on u.id = p.auth_user_id
    join public.profile_vehicles pv on pv.profile_id = p.id and pv.status = 'ACTIVE'
    join public.vehicles v on v.id = pv.vehicle_id
    where p.role = 'consumer'
      and p.is_active
      and p.approval_status = 'approved'
      and u.email like 'local-consumer-%@example.local'
    order by u.email
    limit 250
  loop
    n := n + 1;

    fuel_type_value := (array['AI_92', 'AI_95', 'AI_100', 'DIESEL', 'GAS'])[((n - 1) % 5) + 1];
    preference_mode_value := case
      when fuel_type_value in ('AI_92', 'AI_95', 'AI_100') and n % 7 = 0 then 'ANY_GASOLINE'
      else 'EXACT'
    end;
    driver_id_value := (
      substr(md5('local-queue-250-driver-' || n::text), 1, 8) || '-' ||
      substr(md5('local-queue-250-driver-' || n::text), 9, 4) || '-' ||
      substr(md5('local-queue-250-driver-' || n::text), 13, 4) || '-' ||
      substr(md5('local-queue-250-driver-' || n::text), 17, 4) || '-' ||
      substr(md5('local-queue-250-driver-' || n::text), 21, 12)
    )::uuid;
    queue_entry_id_value := (
      substr(md5('local-queue-250-entry-' || n::text), 1, 8) || '-' ||
      substr(md5('local-queue-250-entry-' || n::text), 9, 4) || '-' ||
      substr(md5('local-queue-250-entry-' || n::text), 13, 4) || '-' ||
      substr(md5('local-queue-250-entry-' || n::text), 17, 4) || '-' ||
      substr(md5('local-queue-250-entry-' || n::text), 21, 12)
    )::uuid;

    insert into public.drivers (id, full_name, phone)
    values (
      driver_id_value,
      consumer_row.full_name,
      coalesce(consumer_row.phone, format('+7978000%04s', n))
    )
    on conflict (id) do update
    set
      full_name = excluded.full_name,
      phone = excluded.phone,
      updated_at = now();

    insert into public.fuel_queue_entries (
      id,
      permanent_number,
      vehicle_id,
      driver_id,
      preferred_fuel_type,
      fuel_preference_mode,
      requested_liters,
      status,
      operator_id,
      comment,
      client_mutation_id,
      sync_status
    )
    values (
      queue_entry_id_value,
      n,
      consumer_row.vehicle_id,
      driver_id_value,
      fuel_type_value,
      preference_mode_value,
      40,
      'WAITING',
      operator_profile_id,
      seed_comment,
      (
        substr(md5('local-queue-250-mutation-' || n::text), 1, 8) || '-' ||
        substr(md5('local-queue-250-mutation-' || n::text), 9, 4) || '-' ||
        substr(md5('local-queue-250-mutation-' || n::text), 13, 4) || '-' ||
        substr(md5('local-queue-250-mutation-' || n::text), 17, 4) || '-' ||
        substr(md5('local-queue-250-mutation-' || n::text), 21, 12)
      )::uuid,
      'SYNCED'
    )
    on conflict (id) do update
    set
      permanent_number = excluded.permanent_number,
      vehicle_id = excluded.vehicle_id,
      driver_id = excluded.driver_id,
      preferred_fuel_type = excluded.preferred_fuel_type,
      fuel_preference_mode = excluded.fuel_preference_mode,
      requested_liters = excluded.requested_liters,
      status = excluded.status,
      operator_id = excluded.operator_id,
      comment = excluded.comment,
      client_mutation_id = excluded.client_mutation_id,
      sync_status = excluded.sync_status,
      updated_at = now();
  end loop;

  if n <> 250 then
    raise exception 'Expected 250 local consumers for queue seed, got %.', n;
  end if;

  perform setval(
    'public.fuel_queue_permanent_number_seq',
    greatest((select coalesce(max(permanent_number), 0) from public.fuel_queue_entries), 1),
    true
  );

  raise notice 'local-queue-250-ready: waiting_seed_entries=%, daily_limits_created=0, daily_allocations_created=0', n;
end;
$$;
