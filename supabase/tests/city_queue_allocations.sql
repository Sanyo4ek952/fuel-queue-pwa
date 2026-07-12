begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

select has_table('public', 'fuel_queue_entries', 'persistent queue entries exist');
select has_table('public', 'daily_queue_allocations', 'daily allocations exist');
select has_table('public', 'daily_queue_allocation_call_logs', 'allocation call history exists');
select hasnt_table('public', 'fuel_reservations', 'legacy dated reservations table is absent');
select hasnt_table('public', 'queue_entries', 'legacy queue_entries table is absent');
select hasnt_table('public', 'reservation_call_logs', 'legacy reservation call logs table is absent');
select has_column('public', 'fuel_queue_entries', 'permanent_number', 'permanent number is stored');
select hasnt_column('public', 'fuel_queue_entries', 'date', 'persistent entry has no date');
select hasnt_column('public', 'fuel_queue_entries', 'station_id', 'persistent entry has no station');
select has_column('public', 'daily_queue_allocations', 'arrival_at', 'ETA is stored');
select has_column('public', 'daily_queue_allocations', 'allocation_date', 'allocation stores date');
select has_column('public', 'daily_queue_allocations', 'station_id', 'allocation stores station');
select has_column('public', 'daily_queue_allocations', 'assigned_fuel_type', 'allocation stores matched fuel');
select has_column('public', 'daily_queue_allocations', 'station_fuel_position', 'schedule position is stored');
select has_column('public', 'daily_fueling_schedules', 'station_id', 'schedule is station-specific');
select has_function(
  'public', 'create_reservation',
  array['text', 'text', 'text', 'text', 'numeric', 'text', 'text', 'uuid'],
  'create_reservation uses permanent queue arguments'
);
select hasnt_function(
  'public', 'create_reservation',
  array['date', 'uuid', 'text', 'text', 'text', 'text', 'numeric', 'text', 'uuid'],
  'legacy create_reservation(date, station) is absent'
);
select has_function(
  'public', 'create_consumer_reservation',
  array['uuid', 'text', 'text', 'text', 'numeric', 'text', 'text', 'uuid'],
  'consumer reservation creates a permanent queue entry'
);
select has_function(
  'public', 'create_fueling_record_for_allocation',
  array['uuid', 'numeric', 'timestamp with time zone', 'text', 'uuid'],
  'fueling uses a saved allocation'
);
select hasnt_function(
  'public', 'create_fueling_record',
  array['uuid', 'text', 'numeric', 'text', 'date', 'timestamp with time zone', 'text', 'uuid'],
  'legacy fueling without allocation is absent'
);
select function_privs_are(
  'public', 'allocate_daily_queue', array['date'], 'authenticated', array[]::text[],
  'allocator is not callable by authenticated clients'
);
select function_privs_are(
  'public', 'finalize_daily_queue', array['date'], 'authenticated', array[]::text[],
  'finalizer is service-role-only'
);
select is(
  public.get_compatible_fuel_types('AI_95', 'EXACT'),
  array['AI_95']::text[],
  'EXACT never substitutes fuel'
);
select is(
  public.get_compatible_fuel_types('AI_95', 'ANY_GASOLINE'),
  array['AI_95', 'AI_92', 'AI_100']::text[],
  'ANY_GASOLINE preserves the preferred brand first'
);
select col_is_unique('public', 'daily_queue_allocations', array['allocation_date', 'queue_entry_id'], 'one allocation per entry and date');

insert into public.stations (id, name, address, is_active, allocation_order)
values ('10000000-1000-4000-8000-000000000001', 'Liter limit test station', 'Test address', true, 900001)
on conflict (id) do update
set is_active = excluded.is_active,
    allocation_order = excluded.allocation_order;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '31000000-1000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'liter-limit-mayor@example.local',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
)
on conflict (id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

update public.profiles
set id = '30000000-1000-4000-8000-000000000001',
    full_name = 'Liter Limit Mayor',
    role = 'mayor',
    is_active = true,
    approval_status = 'approved'
where auth_user_id = '31000000-1000-4000-8000-000000000001';

insert into public.profiles (id, auth_user_id, full_name, role, is_active, approval_status)
select
  '30000000-1000-4000-8000-000000000001',
  '31000000-1000-4000-8000-000000000001',
  'Liter Limit Mayor',
  'mayor',
  true,
  'approved'
where not exists (
  select 1
  from public.profiles
  where auth_user_id = '31000000-1000-4000-8000-000000000001'
);

insert into public.daily_fueling_schedules (
  id,
  date,
  station_id,
  fuel_category,
  start_time,
  interval_minutes,
  vehicles_per_interval,
  updated_by,
  client_mutation_id
)
values (
  '32000000-1000-4000-8000-000000000001',
  date '2026-07-05',
  '10000000-1000-4000-8000-000000000001',
  'GASOLINE',
  time '09:00',
  10,
  1,
  '30000000-1000-4000-8000-000000000001',
  '33000000-1000-4000-8000-000000000001'
)
on conflict (date, station_id, fuel_category) do update
set start_time = excluded.start_time,
    interval_minutes = excluded.interval_minutes,
    vehicles_per_interval = excluded.vehicles_per_interval;

insert into public.daily_limits (
  id,
  date,
  station_id,
  total_vehicle_limit,
  max_liters_per_vehicle,
  status,
  created_by,
  client_mutation_id
)
values (
  '34000000-1000-4000-8000-000000000001',
  date '2026-07-05',
  '10000000-1000-4000-8000-000000000001',
  0,
  20,
  'OPEN',
  '30000000-1000-4000-8000-000000000001',
  '35000000-1000-4000-8000-000000000001'
)
on conflict (date, station_id) where station_id is not null do update
set total_vehicle_limit = excluded.total_vehicle_limit,
    status = excluded.status;

insert into public.daily_fuel_type_limits (
  daily_limit_id,
  fuel_type,
  fuel_category,
  limit_mode,
  status,
  vehicle_limit,
  liters_limit
)
values (
  '34000000-1000-4000-8000-000000000001',
  'AI_95',
  'GASOLINE',
  'fuel_liters',
  'OPEN',
  0,
  100
)
on conflict (daily_limit_id, fuel_type) do update
set limit_mode = excluded.limit_mode,
    status = excluded.status,
    vehicle_limit = excluded.vehicle_limit,
    liters_limit = excluded.liters_limit;

insert into public.vehicles (id, plate_number, normalized_plate_number)
values
  ('40000000-1000-4000-8000-000000000001', 'A001AA777', 'A001AA777'),
  ('40000000-1000-4000-8000-000000000002', 'A002AA777', 'A002AA777'),
  ('40000000-1000-4000-8000-000000000003', 'A003AA777', 'A003AA777')
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values
  ('50000000-1000-4000-8000-000000000001', 'Driver One', '+70000000001'),
  ('50000000-1000-4000-8000-000000000002', 'Driver Two', '+70000000002'),
  ('50000000-1000-4000-8000-000000000003', 'Driver Three', '+70000000003')
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

delete from public.daily_queue_allocations
where allocation_date = date '2026-07-05';

update public.fuel_queue_entries
set status = 'CANCELLED'
where status = 'WAITING'
  and id not in (
    '60000000-1000-4000-8000-000000000001',
    '60000000-1000-4000-8000-000000000002',
    '60000000-1000-4000-8000-000000000003'
  );

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
  client_mutation_id,
  sync_status
)
values
  ('60000000-1000-4000-8000-000000000001', 900001, '40000000-1000-4000-8000-000000000001', '50000000-1000-4000-8000-000000000001', 'AI_95', 'EXACT', 40, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000001', 'SYNCED'),
  ('60000000-1000-4000-8000-000000000002', 900002, '40000000-1000-4000-8000-000000000002', '50000000-1000-4000-8000-000000000002', 'AI_95', 'EXACT', 50, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000002', 'SYNCED'),
  ('60000000-1000-4000-8000-000000000003', 900003, '40000000-1000-4000-8000-000000000003', '50000000-1000-4000-8000-000000000003', 'AI_95', 'EXACT', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000003', 'SYNCED')
on conflict (id) do update
set permanent_number = excluded.permanent_number,
    requested_liters = excluded.requested_liters,
    status = excluded.status;

select lives_ok(
  $$select public.allocate_daily_queue(date '2026-07-05')$$,
  'allocator runs with a liters-only daily fuel type limit'
);

select is(
  (
    select count(*)::integer
    from public.daily_queue_allocations
    where allocation_date = date '2026-07-05'
      and status = 'ACTIVE'
      and queue_entry_id in (
        '60000000-1000-4000-8000-000000000001',
        '60000000-1000-4000-8000-000000000002',
        '60000000-1000-4000-8000-000000000003'
      )
  ),
  2,
  'liter limit activates only queue entries whose requested liters fit'
);

select is(
  (
    select count(*)::integer
    from public.daily_queue_allocations
    where allocation_date = date '2026-07-05'
      and status = 'ACTIVE'
      and queue_entry_id = '60000000-1000-4000-8000-000000000003'
  ),
  0,
  'liter limit leaves the first entry beyond remaining liters outside active call list'
);

delete from public.daily_queue_allocations
where allocation_date in (date '2026-07-06', date '2026-07-07', date '2026-07-08');

delete from public.daily_fueling_schedules
where date in (date '2026-07-06', date '2026-07-08')
  and station_id = '10000000-1000-4000-8000-000000000001';

delete from public.daily_limits
where date in (date '2026-07-06', date '2026-07-07', date '2026-07-08')
  and station_id = '10000000-1000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '31000000-1000-4000-8000-000000000001', true);

select lives_ok(
  $test$
    select public.create_daily_limit(
      date '2026-07-06',
      '[{"fuel_type":"AI_95","status":"OPEN","liters_limit":100}]'::jsonb,
      '35000000-1000-4000-8000-000000000006',
      '10000000-1000-4000-8000-000000000001'
    )
  $test$,
  'create_daily_limit allocates queue even when schedule is missing'
);

select is(
  (
    select count(*)::integer
    from public.daily_queue_allocations
    where allocation_date = date '2026-07-06'
      and status = 'ACTIVE'
      and queue_entry_id in (
        '60000000-1000-4000-8000-000000000001',
        '60000000-1000-4000-8000-000000000002',
        '60000000-1000-4000-8000-000000000003'
      )
  ),
  2,
  'create_daily_limit fallback schedule lets liter-limited entries become active'
);

select is(
  (
    select jsonb_build_object(
      'start_time', to_char(start_time, 'HH24:MI'),
      'interval_minutes', interval_minutes,
      'vehicles_per_interval', vehicles_per_interval
    )
    from public.daily_fueling_schedules
    where date = date '2026-07-06'
      and station_id = '10000000-1000-4000-8000-000000000001'
      and fuel_category = 'GASOLINE'
  ),
  '{"start_time":"13:00","interval_minutes":5,"vehicles_per_interval":5}'::jsonb,
  'missing schedule uses the default fueling schedule'
);

insert into public.daily_fueling_schedules (
  date,
  station_id,
  fuel_category,
  start_time,
  interval_minutes,
  vehicles_per_interval,
  updated_by,
  client_mutation_id
)
values (
  date '2026-07-07',
  '10000000-1000-4000-8000-000000000001',
  'GASOLINE',
  time '09:30',
  12,
  2,
  '30000000-1000-4000-8000-000000000001',
  '33000000-1000-4000-8000-000000000007'
)
on conflict (date, station_id, fuel_category) do update
set start_time = excluded.start_time,
    interval_minutes = excluded.interval_minutes,
    vehicles_per_interval = excluded.vehicles_per_interval;

select lives_ok(
  $test$
    select public.create_daily_limit(
      date '2026-07-07',
      '[{"fuel_type":"AI_95","status":"OPEN","liters_limit":100}]'::jsonb,
      '35000000-1000-4000-8000-000000000007',
      '10000000-1000-4000-8000-000000000001'
    )
  $test$,
  'create_daily_limit runs with an existing schedule'
);

select is(
  (
    select jsonb_build_object(
      'start_time', to_char(start_time, 'HH24:MI'),
      'interval_minutes', interval_minutes,
      'vehicles_per_interval', vehicles_per_interval
    )
    from public.daily_fueling_schedules
    where date = date '2026-07-07'
      and station_id = '10000000-1000-4000-8000-000000000001'
      and fuel_category = 'GASOLINE'
  ),
  '{"start_time":"09:30","interval_minutes":12,"vehicles_per_interval":2}'::jsonb,
  'fallback schedule does not overwrite an existing schedule'
);

insert into public.vehicles (id, plate_number, normalized_plate_number)
values
  ('40000000-1000-4000-8000-000000000004', 'A004AA777', 'A004AA777'),
  ('40000000-1000-4000-8000-000000000005', 'A005AA777', 'A005AA777')
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values
  ('50000000-1000-4000-8000-000000000004', 'Driver Four', '+70000000004'),
  ('50000000-1000-4000-8000-000000000005', 'Driver Five', '+70000000005')
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

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
  client_mutation_id,
  sync_status
)
values
  ('60000000-1000-4000-8000-000000000004', 900004, '40000000-1000-4000-8000-000000000004', '50000000-1000-4000-8000-000000000004', 'AI_95', 'EXACT', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000004', 'SYNCED'),
  ('60000000-1000-4000-8000-000000000005', 900005, '40000000-1000-4000-8000-000000000005', '50000000-1000-4000-8000-000000000005', 'AI_95', 'ANY_GASOLINE', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000005', 'SYNCED')
on conflict (id) do update
set permanent_number = excluded.permanent_number,
    preferred_fuel_type = excluded.preferred_fuel_type,
    fuel_preference_mode = excluded.fuel_preference_mode,
    requested_liters = excluded.requested_liters,
    status = excluded.status;

select lives_ok(
  $test$
    select public.create_daily_limit(
      date '2026-07-08',
      '[{"fuel_type":"AI_92","status":"OPEN","liters_limit":40}]'::jsonb,
      '35000000-1000-4000-8000-000000000008',
      '10000000-1000-4000-8000-000000000001'
    )
  $test$,
  'create_daily_limit keeps exact fuel matching while allowing ANY_GASOLINE'
);

select is(
  (
    select count(*)::integer
    from public.daily_queue_allocations
    where allocation_date = date '2026-07-08'
      and status = 'ACTIVE'
      and queue_entry_id = '60000000-1000-4000-8000-000000000004'
  ),
  0,
  'AI_95 EXACT does not use an AI_92 limit'
);

select is(
  (
    select count(*)::integer
    from public.daily_queue_allocations
    where allocation_date = date '2026-07-08'
      and status = 'ACTIVE'
      and queue_entry_id = '60000000-1000-4000-8000-000000000005'
      and assigned_fuel_type = 'AI_92'
  ),
  1,
  'AI_95 ANY_GASOLINE can use an AI_92 limit'
);

delete from public.fueling_records
where queue_entry_id in (
  '60000000-1000-4000-8000-000000000006',
  '60000000-1000-4000-8000-000000000007',
  '60000000-1000-4000-8000-000000000008'
);

delete from public.daily_queue_allocations
where allocation_date = date '2026-07-09';

delete from public.daily_fueling_schedules
where date = date '2026-07-09'
  and station_id = '10000000-1000-4000-8000-000000000001';

delete from public.daily_limits
where date = date '2026-07-09'
  and station_id = '10000000-1000-4000-8000-000000000001';

insert into public.vehicles (id, plate_number, normalized_plate_number)
values
  ('40000000-1000-4000-8000-000000000006', 'A006AA777', 'A006AA777'),
  ('40000000-1000-4000-8000-000000000007', 'A007AA777', 'A007AA777'),
  ('40000000-1000-4000-8000-000000000008', 'A008AA777', 'A008AA777')
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values
  ('50000000-1000-4000-8000-000000000006', 'Driver Six', '+70000000006'),
  ('50000000-1000-4000-8000-000000000007', 'Driver Seven', '+70000000007'),
  ('50000000-1000-4000-8000-000000000008', 'Driver Eight', '+70000000008')
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

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
  client_mutation_id,
  sync_status
)
values
  ('60000000-1000-4000-8000-000000000006', 900006, '40000000-1000-4000-8000-000000000006', '50000000-1000-4000-8000-000000000006', 'AI_95', 'EXACT', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000006', 'SYNCED'),
  ('60000000-1000-4000-8000-000000000007', 900007, '40000000-1000-4000-8000-000000000007', '50000000-1000-4000-8000-000000000007', 'AI_95', 'EXACT', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000007', 'SYNCED'),
  ('60000000-1000-4000-8000-000000000008', 900008, '40000000-1000-4000-8000-000000000008', '50000000-1000-4000-8000-000000000008', 'AI_95', 'EXACT', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000008', 'SYNCED')
on conflict (id) do update
set permanent_number = excluded.permanent_number,
    requested_liters = excluded.requested_liters,
    status = excluded.status;

update public.fuel_queue_entries
set status = 'CANCELLED'
where status = 'WAITING'
  and id not in (
    '60000000-1000-4000-8000-000000000006',
    '60000000-1000-4000-8000-000000000007',
    '60000000-1000-4000-8000-000000000008'
  );

insert into public.daily_fueling_schedules (
  date,
  station_id,
  fuel_category,
  start_time,
  interval_minutes,
  vehicles_per_interval,
  updated_by,
  client_mutation_id
)
values (
  date '2026-07-09',
  '10000000-1000-4000-8000-000000000001',
  'GASOLINE',
  time '09:00',
  10,
  1,
  '30000000-1000-4000-8000-000000000001',
  '33000000-1000-4000-8000-000000000009'
)
on conflict (date, station_id, fuel_category) do update
set start_time = excluded.start_time,
    interval_minutes = excluded.interval_minutes,
    vehicles_per_interval = excluded.vehicles_per_interval;

select lives_ok(
  $test$
    select public.create_daily_limit(
      date '2026-07-09',
      '[{"fuel_type":"AI_95","status":"OPEN","liters_limit":60}]'::jsonb,
      '35000000-1000-4000-8000-000000000009',
      '10000000-1000-4000-8000-000000000001'
    )
  $test$,
  'create_daily_limit allocates reset ETA scenario entries'
);

select lives_ok(
  $test$
    select public.create_fueling_record_for_allocation(
      (
        select id
        from public.daily_queue_allocations
        where allocation_date = date '2026-07-09'
          and queue_entry_id = '60000000-1000-4000-8000-000000000006'
      ),
      20,
      timestamp with time zone '2026-07-09 09:05:00+03',
      null,
      '62000000-1000-4000-8000-000000000009'
    )
  $test$,
  'fueling one entry keeps normal allocator behavior available'
);

select is(
  (
    select array_agg(to_char(dqa.arrival_at at time zone 'Europe/Moscow', 'HH24:MI') order by fqe.permanent_number)
    from public.daily_queue_allocations dqa
    join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
    where dqa.allocation_date = date '2026-07-09'
      and dqa.status = 'ACTIVE'
      and dqa.queue_entry_id in (
        '60000000-1000-4000-8000-000000000007',
        '60000000-1000-4000-8000-000000000008'
      )
  ),
  array['09:10', '09:20']::text[],
  'normal fueling reallocation keeps fueled entries in the ETA schedule'
);

select lives_ok(
  $test$
    do $do$
    begin
      perform public.create_daily_limit(
        date '2026-07-09',
        '[{"fuel_type":"AI_95","status":"PAUSED","liters_limit":null}]'::jsonb,
        '35000000-1000-4000-8000-000000000010',
        '10000000-1000-4000-8000-000000000001'
      );

      perform public.set_daily_fueling_schedule(
        date '2026-07-09',
        '10000000-1000-4000-8000-000000000001',
        '[{"fuel_category":"GASOLINE","start_time":"13:00","interval_minutes":10,"vehicles_per_interval":1}]'::jsonb,
        '33000000-1000-4000-8000-000000000010'
      );

      perform public.create_daily_limit(
        date '2026-07-09',
        '[{"fuel_type":"AI_95","status":"OPEN","liters_limit":60}]'::jsonb,
        '35000000-1000-4000-8000-000000000011',
        '10000000-1000-4000-8000-000000000001'
      );
    end
    $do$;
  $test$,
  'reopening a paused limit recalculates queue with the updated schedule'
);

select is(
  (
    select array_agg(to_char(dqa.arrival_at at time zone 'Europe/Moscow', 'HH24:MI') order by fqe.permanent_number)
    from public.daily_queue_allocations dqa
    join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
    where dqa.allocation_date = date '2026-07-09'
      and dqa.status = 'ACTIVE'
      and dqa.queue_entry_id in (
        '60000000-1000-4000-8000-000000000007',
        '60000000-1000-4000-8000-000000000008'
      )
  ),
  array['13:00', '13:10']::text[],
  'reopened paused limit starts active ETA from the configured start time'
);

delete from public.daily_queue_allocations
where allocation_date = date '2026-07-10';

delete from public.daily_fueling_schedules
where date = date '2026-07-10'
  and station_id = '10000000-1000-4000-8000-000000000001';

delete from public.daily_limits
where date = date '2026-07-10'
  and station_id = '10000000-1000-4000-8000-000000000001';

insert into public.vehicles (id, plate_number, normalized_plate_number)
values
  ('40000000-1000-4000-8000-000000000009', 'A009AA777', 'A009AA777'),
  ('40000000-1000-4000-8000-000000000010', 'A010AA777', 'A010AA777'),
  ('40000000-1000-4000-8000-000000000011', 'A011AA777', 'A011AA777'),
  ('40000000-1000-4000-8000-000000000012', 'A012AA777', 'A012AA777')
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values
  ('50000000-1000-4000-8000-000000000009', 'Driver Nine', '+70000000009'),
  ('50000000-1000-4000-8000-000000000010', 'Driver Ten', '+70000000010'),
  ('50000000-1000-4000-8000-000000000011', 'Driver Eleven', '+70000000011'),
  ('50000000-1000-4000-8000-000000000012', 'Driver Twelve', '+70000000012')
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

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
  client_mutation_id,
  sync_status
)
values
  ('60000000-1000-4000-8000-000000000009', 900009, '40000000-1000-4000-8000-000000000009', '50000000-1000-4000-8000-000000000009', 'AI_95', 'EXACT', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000009', 'SYNCED'),
  ('60000000-1000-4000-8000-000000000010', 900010, '40000000-1000-4000-8000-000000000010', '50000000-1000-4000-8000-000000000010', 'AI_95', 'EXACT', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000010', 'SYNCED'),
  ('60000000-1000-4000-8000-000000000011', 900011, '40000000-1000-4000-8000-000000000011', '50000000-1000-4000-8000-000000000011', 'AI_95', 'EXACT', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000011', 'SYNCED'),
  ('60000000-1000-4000-8000-000000000012', 900012, '40000000-1000-4000-8000-000000000012', '50000000-1000-4000-8000-000000000012', 'AI_95', 'EXACT', 20, 'WAITING', '30000000-1000-4000-8000-000000000001', '61000000-1000-4000-8000-000000000012', 'SYNCED')
on conflict (id) do update
set permanent_number = excluded.permanent_number,
    requested_liters = excluded.requested_liters,
    status = excluded.status;

update public.fuel_queue_entries
set status = 'CANCELLED'
where status = 'WAITING'
  and id not in (
    '60000000-1000-4000-8000-000000000009',
    '60000000-1000-4000-8000-000000000010',
    '60000000-1000-4000-8000-000000000011',
    '60000000-1000-4000-8000-000000000012'
  );

insert into public.daily_fueling_schedules (
  date,
  station_id,
  fuel_category,
  start_time,
  interval_minutes,
  vehicles_per_interval,
  updated_by,
  client_mutation_id
)
values (
  date '2026-07-10',
  '10000000-1000-4000-8000-000000000001',
  'GASOLINE',
  time '09:00',
  10,
  1,
  '30000000-1000-4000-8000-000000000001',
  '33000000-1000-4000-8000-000000000012'
)
on conflict (date, station_id, fuel_category) do update
set start_time = excluded.start_time,
    interval_minutes = excluded.interval_minutes,
    vehicles_per_interval = excluded.vehicles_per_interval;

select lives_ok(
  $test$
    select public.create_daily_limit(
      date '2026-07-10',
      '[{"fuel_type":"AI_95","status":"OPEN","liters_limit":80}]'::jsonb,
      '35000000-1000-4000-8000-000000000012',
      '10000000-1000-4000-8000-000000000001'
    );

    select public.create_daily_limit(
      date '2026-07-10',
      '[{"fuel_type":"AI_95","status":"OPEN","liters_limit":60}]'::jsonb,
      '35000000-1000-4000-8000-000000000013',
      '10000000-1000-4000-8000-000000000001'
    );
  $test$,
  'limit reduction leaves the fourth queued car paused with its stored ETA snapshot'
);

select is(
  (
    select to_char(arrival_at at time zone 'Europe/Moscow', 'HH24:MI')
    from public.daily_queue_allocations
    where allocation_date = date '2026-07-10'
      and queue_entry_id = '60000000-1000-4000-8000-000000000012'
      and status = 'PAUSED_BY_LIMIT'
  ),
  '09:30',
  'paused allocation keeps its stored ETA snapshot in the database'
);

select is(
  (
    select row_value ->> 'arrival_at'
    from jsonb_array_elements(public.get_today_call_list(date '2026-07-10', 100) -> 'rows') row_value
    where row_value ->> 'queue_entry_id' = '60000000-1000-4000-8000-000000000012'
  ),
  null,
  'today call list hides ETA for paused allocations'
);

select lives_ok(
  $test$
    select public.create_fueling_record_for_allocation(
      (
        select id
        from public.daily_queue_allocations
        where allocation_date = date '2026-07-10'
          and queue_entry_id = '60000000-1000-4000-8000-000000000009'
      ),
      20,
      timestamp with time zone '2026-07-10 09:05:00+03',
      null,
      '62000000-1000-4000-8000-000000000010'
    )
  $test$,
  'fueling preserves existing active ETA slots'
);

select is(
  (
    select (fr.allocation_id = dqa.id and fr.queue_entry_id = dqa.queue_entry_id)::text
    from public.fueling_records fr
    join public.daily_queue_allocations dqa on dqa.id = fr.allocation_id
    where fr.client_mutation_id = '62000000-1000-4000-8000-000000000010'
  ),
  'true',
  'fueling record stores allocation_id and queue_entry_id in the correct columns'
);

select is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'entry', dqa.queue_entry_id,
        'status', dqa.status,
        'eta', to_char(dqa.arrival_at at time zone 'Europe/Moscow', 'HH24:MI')
      )
      order by fqe.permanent_number
    )
    from public.daily_queue_allocations dqa
    join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
    where dqa.allocation_date = date '2026-07-10'
      and dqa.queue_entry_id in (
        '60000000-1000-4000-8000-000000000010',
        '60000000-1000-4000-8000-000000000011',
        '60000000-1000-4000-8000-000000000012'
      )
  ),
  jsonb_build_array(
    jsonb_build_object('entry', '60000000-1000-4000-8000-000000000010', 'status', 'ACTIVE', 'eta', '09:10'),
    jsonb_build_object('entry', '60000000-1000-4000-8000-000000000011', 'status', 'ACTIVE', 'eta', '09:20'),
    jsonb_build_object('entry', '60000000-1000-4000-8000-000000000012', 'status', 'PAUSED_BY_LIMIT', 'eta', '09:30')
  ),
  'fueling keeps active ETA slots stable and leaves the paused tail outside the used limit'
);

select throws_ok(
  $test$
    select public.create_fueling_record_for_allocation(
      (
        select id
        from public.daily_queue_allocations
        where allocation_date = date '2026-07-10'
          and queue_entry_id = '60000000-1000-4000-8000-000000000009'
      ),
      20,
      timestamp with time zone '2026-07-10 09:15:00+03',
      null,
      '62000000-1000-4000-8000-000000000011'
    )
  $test$,
  'P0001',
  'ALLOCATION_NOT_ACTIVE',
  'inactive allocation returns a domain error instead of a foreign key violation'
);

select is(
  (
    with before_allocation as (
      select id
      from public.daily_queue_allocations
      where allocation_date = date '2026-07-10'
        and queue_entry_id = '60000000-1000-4000-8000-000000000010'
    ),
    reallocated as (
      select public.allocate_daily_queue(date '2026-07-10')
    ),
    after_allocation as (
      select id
      from public.daily_queue_allocations
      where allocation_date = date '2026-07-10'
        and queue_entry_id = '60000000-1000-4000-8000-000000000010'
    )
    select (before_allocation.id = after_allocation.id)::text
    from before_allocation, reallocated, after_allocation
  ),
  'true',
  'allocation id stays stable across queue reallocation'
);

select lives_ok(
  $test$
    select public.create_fueling_record_for_allocation(
      (
        select id
        from public.daily_queue_allocations
        where allocation_date = date '2026-07-10'
          and queue_entry_id = '60000000-1000-4000-8000-000000000010'
      ),
      20,
      timestamp with time zone '2026-07-10 09:15:00+03',
      null,
      '62000000-1000-4000-8000-000000000012'
    );

    select public.create_daily_limit(
      date '2026-07-10',
      '[{"fuel_type":"AI_95","status":"PAUSED","liters_limit":null}]'::jsonb,
      '35000000-1000-4000-8000-000000000014',
      '10000000-1000-4000-8000-000000000001'
    );
  $test$,
  'limit reset after two fuelings recalculates the queue without ambiguous allocate_daily_queue overload'
);

select lives_ok(
  $test$
    select public.allocate_daily_queue(date '2026-07-10', true)
  $test$,
  'two-argument allocate_daily_queue remains callable without a default argument'
);

delete from public.daily_queue_allocations
where allocation_date = date '2026-07-11';

delete from public.daily_fueling_schedules
where date = date '2026-07-11'
  and station_id = '10000000-1000-4000-8000-000000000001';

delete from public.daily_limits
where date = date '2026-07-11'
  and station_id = '10000000-1000-4000-8000-000000000001';

insert into public.vehicles (id, plate_number, normalized_plate_number)
values
  ('40000000-1000-4000-8000-000000000013', 'A013AA777', 'A013AA777'),
  ('40000000-1000-4000-8000-000000000014', 'A014AA777', 'A014AA777'),
  ('40000000-1000-4000-8000-000000000015', 'A015AA777', 'A015AA777')
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values
  ('50000000-1000-4000-8000-000000000013', 'Driver Thirteen', '+70000000013'),
  ('50000000-1000-4000-8000-000000000014', 'Driver Fourteen', '+70000000014'),
  ('50000000-1000-4000-8000-000000000015', 'Driver Fifteen', '+70000000015')
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

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
  client_mutation_id,
  sync_status
)
values (
  '60000000-1000-4000-8000-000000000013',
  900013,
  '40000000-1000-4000-8000-000000000013',
  '50000000-1000-4000-8000-000000000013',
  'AI_95',
  'EXACT',
  400,
  'WAITING',
  '30000000-1000-4000-8000-000000000001',
  '61000000-1000-4000-8000-000000000013',
  'SYNCED'
),
(
  '60000000-1000-4000-8000-000000000014',
  900014,
  '40000000-1000-4000-8000-000000000014',
  '50000000-1000-4000-8000-000000000014',
  'AI_95',
  'EXACT',
  60,
  'CANCELLED',
  '30000000-1000-4000-8000-000000000001',
  '61000000-1000-4000-8000-000000000014',
  'SYNCED'
),
(
  '60000000-1000-4000-8000-000000000015',
  900015,
  '40000000-1000-4000-8000-000000000015',
  '50000000-1000-4000-8000-000000000015',
  'AI_95',
  'EXACT',
  60,
  'CANCELLED',
  '30000000-1000-4000-8000-000000000001',
  '61000000-1000-4000-8000-000000000015',
  'SYNCED'
)
on conflict (id) do update
set permanent_number = excluded.permanent_number,
    requested_liters = excluded.requested_liters,
    status = excluded.status;

update public.fuel_queue_entries
set status = 'CANCELLED'
where status = 'WAITING'
  and id <> '60000000-1000-4000-8000-000000000013';

select lives_ok(
  $test$
    select public.create_daily_limit(
      date '2026-07-11',
      '[{"fuel_type":"AI_95","status":"OPEN","liters_limit":400}]'::jsonb,
      '35000000-1000-4000-8000-000000000015',
      '10000000-1000-4000-8000-000000000001'
    );

    select public.create_fueling_record_for_allocation(
      (
        select id
        from public.daily_queue_allocations
        where allocation_date = date '2026-07-11'
          and queue_entry_id = '60000000-1000-4000-8000-000000000013'
      ),
      400,
      timestamp with time zone '2026-07-11 09:05:00+03',
      null,
      '62000000-1000-4000-8000-000000000013'
    );

    select public.create_daily_limit(
      date '2026-07-11',
      '[{"fuel_type":"AI_95","status":"PAUSED","liters_limit":null}]'::jsonb,
      '35000000-1000-4000-8000-000000000016',
      '10000000-1000-4000-8000-000000000001'
    );

    select public.create_daily_limit(
      date '2026-07-11',
      '[{"fuel_type":"AI_95","status":"OPEN","liters_limit":100}]'::jsonb,
      '35000000-1000-4000-8000-000000000017',
      '10000000-1000-4000-8000-000000000001'
    );
  $test$,
  'reopening a paused fuel limit starts a new liters session'
);

select is(
  (
    select dftl.liters_limit
    from public.daily_limits dl
    join public.daily_fuel_type_limits dftl on dftl.daily_limit_id = dl.id
    where dl.date = date '2026-07-11'
      and dl.station_id = '10000000-1000-4000-8000-000000000001'
      and dftl.fuel_type = 'AI_95'
  ),
  100::numeric,
  'reopened paused fuel limit stores entered liters as the new capacity'
);

select is(
  (
    select dftl.liters_used_baseline
    from public.daily_limits dl
    join public.daily_fuel_type_limits dftl on dftl.daily_limit_id = dl.id
    where dl.date = date '2026-07-11'
      and dl.station_id = '10000000-1000-4000-8000-000000000001'
      and dftl.fuel_type = 'AI_95'
  ),
  400::numeric,
  'reopened paused fuel limit stores already fueled liters as the session baseline'
);

select is(
  (
    select (category_value ->> 'remaining_liters')::numeric
    from jsonb_array_elements(public.get_daily_limit_overview(date '2026-07-11') -> 'station_overviews') station_value
    cross join jsonb_array_elements(station_value -> 'category_overviews') category_value
    where station_value ->> 'station_id' = '10000000-1000-4000-8000-000000000001'
      and category_value ->> 'fuel_type' = 'AI_95'
  ),
  100::numeric,
  'daily limit overview ignores pre-baseline liters before new queue allocation'
);

select lives_ok(
  $test$
    update public.fuel_queue_entries
    set status = 'WAITING'
    where id in (
      '60000000-1000-4000-8000-000000000014',
      '60000000-1000-4000-8000-000000000015'
    );

    select public.allocate_daily_queue(date '2026-07-11');
  $test$,
  'allocator uses only the reopened fuel limit capacity after the baseline'
);

select is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'entry', dqa.queue_entry_id,
        'status', dqa.status
      )
      order by fqe.permanent_number
    )
    from public.daily_queue_allocations dqa
    join public.fuel_queue_entries fqe on fqe.id = dqa.queue_entry_id
    where dqa.allocation_date = date '2026-07-11'
      and dqa.queue_entry_id in (
        '60000000-1000-4000-8000-000000000014',
        '60000000-1000-4000-8000-000000000015'
      )
  ),
  jsonb_build_array(
    jsonb_build_object('entry', '60000000-1000-4000-8000-000000000014', 'status', 'ACTIVE'),
    jsonb_build_object('entry', '60000000-1000-4000-8000-000000000015', 'status', 'PAUSED_BY_LIMIT')
  ),
  'allocator does not expand the reopened 100 liter limit to the previously fueled 400 liters'
);

select lives_ok(
  $test$
    select public.create_fueling_record_for_allocation(
      (
        select id
        from public.daily_queue_allocations
        where allocation_date = date '2026-07-11'
          and queue_entry_id = '60000000-1000-4000-8000-000000000014'
      ),
      60,
      timestamp with time zone '2026-07-11 10:05:00+03',
      null,
      '62000000-1000-4000-8000-000000000014'
    )
  $test$,
  'fueling after reopen checks liters against the post-baseline session capacity'
);

select is(
  (
    select (category_value ->> 'remaining_liters')::numeric
    from jsonb_array_elements(public.get_daily_limit_overview(date '2026-07-11') -> 'station_overviews') station_value
    cross join jsonb_array_elements(station_value -> 'category_overviews') category_value
    where station_value ->> 'station_id' = '10000000-1000-4000-8000-000000000001'
      and category_value ->> 'fuel_type' = 'AI_95'
  ),
  40::numeric,
  'daily limit overview shows remaining liters in the current reopened session'
);

select * from finish();
rollback;
