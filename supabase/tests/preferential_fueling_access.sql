begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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
  '81000000-2000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'preferential-fueling-mayor@example.local',
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

insert into public.profiles (id, auth_user_id, full_name, role, is_active, approval_status)
values (
  '80000000-2000-4000-8000-000000000001',
  '81000000-2000-4000-8000-000000000001',
  'Preferential Fueling Mayor',
  'mayor',
  true,
  'approved'
)
on conflict (auth_user_id) do update
set id = excluded.id,
    full_name = excluded.full_name,
    role = excluded.role,
    is_active = excluded.is_active,
    approval_status = excluded.approval_status;

insert into public.stations (id, name, address, is_active, allocation_order)
values (
  '82000000-2000-4000-8000-000000000001',
  'Preferential Station',
  'Test address',
  true,
  920001
)
on conflict (id) do update
set is_active = excluded.is_active,
    allocation_order = excluded.allocation_order;

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
  '83000000-2000-4000-8000-000000000001',
  date '2026-07-12',
  '82000000-2000-4000-8000-000000000001',
  0,
  10,
  'OPEN',
  '80000000-2000-4000-8000-000000000001',
  '84000000-2000-4000-8000-000000000001'
)
on conflict (date, station_id) where station_id is not null do update
set total_vehicle_limit = excluded.total_vehicle_limit,
    max_liters_per_vehicle = excluded.max_liters_per_vehicle,
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
  '83000000-2000-4000-8000-000000000001',
  'AI_95',
  'GASOLINE',
  'fuel_liters',
  'OPEN',
  0,
  10
)
on conflict (daily_limit_id, fuel_type) do update
set limit_mode = excluded.limit_mode,
    status = excluded.status,
    vehicle_limit = excluded.vehicle_limit,
    liters_limit = excluded.liters_limit;

insert into public.vehicles (id, plate_number, normalized_plate_number)
values (
  '85000000-2000-4000-8000-000000000001',
  'A901AA777',
  'A901AA777'
)
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values (
  '86000000-2000-4000-8000-000000000001',
  'Preferential Driver',
  '+70000000901'
)
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

insert into public.preferential_queues (
  id,
  name,
  status,
  created_by,
  client_mutation_id
)
values (
  '87000000-2000-4000-8000-000000000001',
  'Preferential Fueling Test',
  'ACTIVE',
  '80000000-2000-4000-8000-000000000001',
  '88000000-2000-4000-8000-000000000001'
)
on conflict (id) do update
set name = excluded.name,
    status = excluded.status;

insert into public.preferential_queue_entries (
  id,
  queue_id,
  vehicle_id,
  driver_id,
  fuel_type,
  requested_liters,
  status,
  created_by,
  client_mutation_id
)
values (
  '89000000-2000-4000-8000-000000000001',
  '87000000-2000-4000-8000-000000000001',
  '85000000-2000-4000-8000-000000000001',
  '86000000-2000-4000-8000-000000000001',
  'AI_95',
  50,
  'ACTIVE',
  '80000000-2000-4000-8000-000000000001',
  '8a000000-2000-4000-8000-000000000001'
)
on conflict (id) do update
set requested_liters = excluded.requested_liters,
    status = excluded.status;

select set_config('request.jwt.claim.sub', '81000000-2000-4000-8000-000000000001', true);

select has_function(
  'public',
  'create_fueling_record_for_preferential_entry',
  array['uuid', 'uuid', 'numeric', 'timestamp with time zone', 'text', 'uuid'],
  'preferential fueling RPC exists'
);

select is(
  public.check_vehicle_access(
    'A901AA777',
    '82000000-2000-4000-8000-000000000001',
    date '2026-07-12'
  )->>'reason',
  'PREFERENTIAL_QUEUE_ACTIVE',
  'active preferential entry allows access without daily allocation'
);

select lives_ok(
  $test$
    select public.create_fueling_record_for_preferential_entry(
      '89000000-2000-4000-8000-000000000001',
      '82000000-2000-4000-8000-000000000001',
      20,
      '2026-07-12 10:00:00+03'::timestamptz,
      null,
      '8b000000-2000-4000-8000-000000000001'
    )
  $test$,
  'preferential fueling ignores normal daily liters limit'
);

select is(
  (
    select status || ':' || requested_liters::text
    from public.preferential_queue_entries
    where id = '89000000-2000-4000-8000-000000000001'
  ),
  'ACTIVE:30.00',
  'partial preferential fueling subtracts liters and keeps entry active'
);

select is(
  (public.check_vehicle_access(
    'A901AA777',
    '82000000-2000-4000-8000-000000000001',
    date '2026-07-12'
  )->>'requested_liters')::numeric,
  30::numeric,
  'active preferential entry is still allowed after same-day preferential fueling'
);

select throws_ok(
  $test$
    select public.create_fueling_record_for_preferential_entry(
      '89000000-2000-4000-8000-000000000001',
      '82000000-2000-4000-8000-000000000001',
      31,
      '2026-07-12 11:00:00+03'::timestamptz,
      null,
      '8b000000-2000-4000-8000-000000000002'
    )
  $test$,
  'P0001',
  'LITERS_LIMIT_EXCEEDED',
  'preferential fueling cannot exceed remaining liters'
);

select lives_ok(
  $test$
    select public.create_fueling_record_for_preferential_entry(
      '89000000-2000-4000-8000-000000000001',
      '82000000-2000-4000-8000-000000000001',
      30,
      '2026-07-12 12:00:00+03'::timestamptz,
      null,
      '8b000000-2000-4000-8000-000000000003'
    )
  $test$,
  'final preferential fueling succeeds with exact remaining liters'
);

select is(
  (
    select status || ':' || requested_liters::text
    from public.preferential_queue_entries
    where id = '89000000-2000-4000-8000-000000000001'
  ),
  'FUELED:0.00',
  'final preferential fueling closes the entry when remaining liters reach zero'
);

select * from finish();
rollback;
