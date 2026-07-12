begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into public.stations (id, name, address, is_active, allocation_order)
values
  ('77000000-3000-4000-8000-000000000001', 'Mutation access station A', 'Test address A', true, 993001),
  ('77000000-3000-4000-8000-000000000002', 'Mutation access station B', 'Test address B', true, 993002)
on conflict (id) do update
set name = excluded.name,
    address = excluded.address,
    is_active = excluded.is_active,
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
values
  (
    '77100000-3000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'reservation-owner@example.local',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '77100000-3000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'reservation-other@example.local',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '77100000-3000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'reservation-staff-allowed@example.local',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '77100000-3000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'reservation-staff-denied@example.local',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '77100000-3000-4000-8000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'reservation-cashier@example.local',
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
values
  (
    '77200000-3000-4000-8000-000000000001',
    '77100000-3000-4000-8000-000000000001',
    'Reservation Owner',
    'consumer',
    true,
    'approved'
  ),
  (
    '77200000-3000-4000-8000-000000000002',
    '77100000-3000-4000-8000-000000000002',
    'Reservation Other Consumer',
    'consumer',
    true,
    'approved'
  ),
  (
    '77200000-3000-4000-8000-000000000003',
    '77100000-3000-4000-8000-000000000003',
    'Reservation Staff Allowed',
    'station_manager',
    true,
    'approved'
  ),
  (
    '77200000-3000-4000-8000-000000000004',
    '77100000-3000-4000-8000-000000000004',
    'Reservation Staff Denied',
    'station_manager',
    true,
    'approved'
  ),
  (
    '77200000-3000-4000-8000-000000000005',
    '77100000-3000-4000-8000-000000000005',
    'Reservation Cashier',
    'cashier',
    true,
    'approved'
  )
on conflict (auth_user_id) do update
set id = excluded.id,
    full_name = excluded.full_name,
    role = excluded.role,
    is_active = excluded.is_active,
    approval_status = excluded.approval_status;

insert into public.user_stations (id, user_id, station_id)
values (
  '77300000-3000-4000-8000-000000000001',
  '77200000-3000-4000-8000-000000000003',
  '77000000-3000-4000-8000-000000000001'
)
on conflict (user_id, station_id) do update
set station_id = excluded.station_id;

insert into public.vehicles (id, plate_number, normalized_plate_number)
values
  ('77400000-3000-4000-8000-000000000001', 'A331AA777', 'A331AA777'),
  ('77400000-3000-4000-8000-000000000002', 'A332AA777', 'A332AA777'),
  ('77400000-3000-4000-8000-000000000003', 'A333AA777', 'A333AA777'),
  ('77400000-3000-4000-8000-000000000004', 'A334AA777', 'A334AA777'),
  ('77400000-3000-4000-8000-000000000005', 'A335AA777', 'A335AA777'),
  ('77400000-3000-4000-8000-000000000006', 'A336AA777', 'A336AA777'),
  ('77400000-3000-4000-8000-000000000007', 'A337AA777', 'A337AA777'),
  ('77400000-3000-4000-8000-000000000008', 'A338AA777', 'A338AA777')
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values
  ('77500000-3000-4000-8000-000000000001', 'Reservation Driver 1', '+77003000001'),
  ('77500000-3000-4000-8000-000000000002', 'Reservation Driver 2', '+77003000002'),
  ('77500000-3000-4000-8000-000000000003', 'Reservation Driver 3', '+77003000003'),
  ('77500000-3000-4000-8000-000000000004', 'Reservation Driver 4', '+77003000004'),
  ('77500000-3000-4000-8000-000000000005', 'Reservation Driver 5', '+77003000005'),
  ('77500000-3000-4000-8000-000000000006', 'Reservation Driver 6', '+77003000006'),
  ('77500000-3000-4000-8000-000000000007', 'Reservation Driver 7', '+77003000007'),
  ('77500000-3000-4000-8000-000000000008', 'Reservation Driver 8', '+77003000008')
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

insert into public.profile_vehicles (id, profile_id, vehicle_id, status, created_at, updated_at)
values
  (
    '77600000-3000-4000-8000-000000000001',
    '77200000-3000-4000-8000-000000000001',
    '77400000-3000-4000-8000-000000000001',
    'ACTIVE',
    timestamp with time zone '2026-07-01 09:00:00+03',
    timestamp with time zone '2026-07-01 09:00:00+03'
  ),
  (
    '77600000-3000-4000-8000-000000000002',
    '77200000-3000-4000-8000-000000000001',
    '77400000-3000-4000-8000-000000000002',
    'ACTIVE',
    timestamp with time zone '2026-07-01 09:00:00+03',
    timestamp with time zone '2026-07-01 09:00:00+03'
  ),
  (
    '77600000-3000-4000-8000-000000000003',
    '77200000-3000-4000-8000-000000000001',
    '77400000-3000-4000-8000-000000000003',
    'ACTIVE',
    timestamp with time zone '2026-07-01 09:00:00+03',
    timestamp with time zone '2026-07-01 09:00:00+03'
  ),
  (
    '77600000-3000-4000-8000-000000000004',
    '77200000-3000-4000-8000-000000000001',
    '77400000-3000-4000-8000-000000000007',
    'ACTIVE',
    timestamp with time zone '2026-07-01 09:00:00+03',
    timestamp with time zone '2026-07-01 09:00:00+03'
  ),
  (
    '77600000-3000-4000-8000-000000000005',
    '77200000-3000-4000-8000-000000000002',
    '77400000-3000-4000-8000-000000000006',
    'ACTIVE',
    timestamp with time zone '2026-07-01 09:00:00+03',
    timestamp with time zone '2026-07-01 09:00:00+03'
  )
on conflict (profile_id, vehicle_id) do update
set status = excluded.status,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

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
  sync_status,
  created_at,
  updated_at
)
values
  (
    '77700000-3000-4000-8000-000000000001',
    993001,
    '77400000-3000-4000-8000-000000000001',
    '77500000-3000-4000-8000-000000000001',
    'AI_95',
    'EXACT',
    20,
    'WAITING',
    '77200000-3000-4000-8000-000000000001',
    '77800000-3000-4000-8000-000000000001',
    'SYNCED',
    timestamp with time zone '2026-07-02 09:00:00+03',
    timestamp with time zone '2026-07-02 09:00:00+03'
  ),
  (
    '77700000-3000-4000-8000-000000000002',
    993002,
    '77400000-3000-4000-8000-000000000002',
    '77500000-3000-4000-8000-000000000002',
    'AI_95',
    'EXACT',
    20,
    'WAITING',
    '77200000-3000-4000-8000-000000000001',
    '77800000-3000-4000-8000-000000000002',
    'SYNCED',
    timestamp with time zone '2026-07-02 09:10:00+03',
    timestamp with time zone '2026-07-02 09:10:00+03'
  ),
  (
    '77700000-3000-4000-8000-000000000003',
    993003,
    '77400000-3000-4000-8000-000000000003',
    '77500000-3000-4000-8000-000000000003',
    'AI_95',
    'EXACT',
    20,
    'WAITING',
    '77200000-3000-4000-8000-000000000001',
    '77800000-3000-4000-8000-000000000003',
    'SYNCED',
    timestamp with time zone '2026-07-02 09:20:00+03',
    timestamp with time zone '2026-07-02 09:20:00+03'
  ),
  (
    '77700000-3000-4000-8000-000000000004',
    993004,
    '77400000-3000-4000-8000-000000000004',
    '77500000-3000-4000-8000-000000000004',
    'AI_95',
    'EXACT',
    20,
    'WAITING',
    '77200000-3000-4000-8000-000000000003',
    '77800000-3000-4000-8000-000000000004',
    'SYNCED',
    timestamp with time zone '2026-07-02 09:30:00+03',
    timestamp with time zone '2026-07-02 09:30:00+03'
  ),
  (
    '77700000-3000-4000-8000-000000000005',
    993005,
    '77400000-3000-4000-8000-000000000005',
    '77500000-3000-4000-8000-000000000005',
    'AI_95',
    'EXACT',
    20,
    'WAITING',
    '77200000-3000-4000-8000-000000000003',
    '77800000-3000-4000-8000-000000000005',
    'SYNCED',
    timestamp with time zone '2026-07-02 09:40:00+03',
    timestamp with time zone '2026-07-02 09:40:00+03'
  ),
  (
    '77700000-3000-4000-8000-000000000006',
    993006,
    '77400000-3000-4000-8000-000000000006',
    '77500000-3000-4000-8000-000000000006',
    'AI_95',
    'EXACT',
    20,
    'WAITING',
    '77200000-3000-4000-8000-000000000002',
    '77800000-3000-4000-8000-000000000006',
    'SYNCED',
    timestamp with time zone '2026-07-02 09:50:00+03',
    timestamp with time zone '2026-07-02 09:50:00+03'
  ),
  (
    '77700000-3000-4000-8000-000000000007',
    993007,
    '77400000-3000-4000-8000-000000000007',
    '77500000-3000-4000-8000-000000000007',
    'AI_95',
    'EXACT',
    20,
    'CANCELLED',
    '77200000-3000-4000-8000-000000000001',
    '77800000-3000-4000-8000-000000000007',
    'SYNCED',
    timestamp with time zone '2026-07-02 10:00:00+03',
    timestamp with time zone '2026-07-02 10:00:00+03'
  ),
  (
    '77700000-3000-4000-8000-000000000008',
    993008,
    '77400000-3000-4000-8000-000000000008',
    '77500000-3000-4000-8000-000000000008',
    'AI_95',
    'EXACT',
    20,
    'WAITING',
    '77200000-3000-4000-8000-000000000003',
    '77800000-3000-4000-8000-000000000008',
    'SYNCED',
    timestamp with time zone '2026-07-02 10:10:00+03',
    timestamp with time zone '2026-07-02 10:10:00+03'
  )
on conflict (id) do update
set preferred_fuel_type = excluded.preferred_fuel_type,
    fuel_preference_mode = excluded.fuel_preference_mode,
    status = excluded.status,
    operator_id = excluded.operator_id,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

insert into public.daily_queue_allocations (
  id,
  allocation_date,
  queue_entry_id,
  station_id,
  assigned_fuel_type,
  allocated_liters,
  daily_position,
  station_position,
  station_fuel_position,
  arrival_at,
  status,
  call_status
)
values
  (
    '77900000-3000-4000-8000-000000000001',
    date '2026-07-20',
    '77700000-3000-4000-8000-000000000004',
    '77000000-3000-4000-8000-000000000001',
    'AI_95',
    20,
    1,
    1,
    1,
    timestamp with time zone '2026-07-20 09:00:00+03',
    'ACTIVE',
    'NOT_CALLED'
  ),
  (
    '77900000-3000-4000-8000-000000000002',
    date '2026-07-20',
    '77700000-3000-4000-8000-000000000005',
    '77000000-3000-4000-8000-000000000001',
    'AI_95',
    20,
    2,
    2,
    2,
    timestamp with time zone '2026-07-20 09:10:00+03',
    'EXPIRED',
    'NOT_CALLED'
  ),
  (
    '77900000-3000-4000-8000-000000000003',
    date '2026-07-20',
    '77700000-3000-4000-8000-000000000006',
    '77000000-3000-4000-8000-000000000002',
    'AI_95',
    20,
    3,
    1,
    1,
    timestamp with time zone '2026-07-20 09:20:00+03',
    'ACTIVE',
    'NOT_CALLED'
  ),
  (
    '77900000-3000-4000-8000-000000000004',
    date '2026-07-20',
    '77700000-3000-4000-8000-000000000008',
    '77000000-3000-4000-8000-000000000001',
    'AI_95',
    20,
    4,
    2,
    2,
    timestamp with time zone '2026-07-20 09:30:00+03',
    'PAUSED_BY_LIMIT',
    'NOT_CALLED'
  )
on conflict (allocation_date, queue_entry_id) do update
set station_id = excluded.station_id,
    assigned_fuel_type = excluded.assigned_fuel_type,
    allocated_liters = excluded.allocated_liters,
    daily_position = excluded.daily_position,
    station_position = excluded.station_position,
    station_fuel_position = excluded.station_fuel_position,
    arrival_at = excluded.arrival_at,
    status = excluded.status,
    call_status = excluded.call_status;

select set_config('request.jwt.claim.sub', '77100000-3000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.cancel_my_reservation('77700000-3000-4000-8000-000000000001', '77800000-3000-4000-8000-000000000101')$$,
  'owner consumer can cancel own active reservation'
);

select is(
  (select status from public.fuel_queue_entries where id = '77700000-3000-4000-8000-000000000001'),
  'CANCELLED',
  'owner cancellation marks only the owner reservation cancelled'
);

select lives_ok(
  $$select public.update_reservation_fuel_preference('77700000-3000-4000-8000-000000000002', 'AI_92', 'ANY_GASOLINE', '77800000-3000-4000-8000-000000000102')$$,
  'owner consumer can update own active reservation fuel preference'
);

select is(
  (select preferred_fuel_type || ':' || fuel_preference_mode from public.fuel_queue_entries where id = '77700000-3000-4000-8000-000000000002'),
  'AI_92:ANY_GASOLINE',
  'owner fuel preference update is saved'
);

select throws_ok(
  $$select public.cancel_reservation('77700000-3000-4000-8000-000000000007', 'CONSUMER_CANCELLED', null, '77800000-3000-4000-8000-000000000103')$$,
  'P0001',
  'QUEUE_ENTRY_NOT_WAITING',
  'authorized owner direct cancel of a non-waiting reservation keeps QUEUE_ENTRY_NOT_WAITING'
);

select throws_ok(
  $$select public.update_reservation_fuel_preference('77700000-3000-4000-8000-000000000007', 'DIESEL', 'EXACT', '77800000-3000-4000-8000-000000000104')$$,
  'P0001',
  'QUEUE_ENTRY_NOT_WAITING',
  'authorized owner update of a non-waiting reservation keeps QUEUE_ENTRY_NOT_WAITING'
);

select throws_ok(
  $$select public.cancel_reservation('77700000-3000-4000-8000-000000000002', 'OWNER_CANCELLED', null, '77800000-3000-4000-8000-000000000105')$$,
  'P0001',
  'FORBIDDEN',
  'consumer cannot use staff cancel reason through direct cancel_reservation'
);

select set_config('request.jwt.claim.sub', '77100000-3000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.cancel_my_reservation('77700000-3000-4000-8000-000000000003', '77800000-3000-4000-8000-000000000201')$$,
  'P0001',
  'FORBIDDEN',
  'another consumer cannot cancel a foreign reservation through cancel_my_reservation'
);

select throws_ok(
  $$select public.cancel_reservation('77700000-3000-4000-8000-000000000003', 'CONSUMER_CANCELLED', null, '77800000-3000-4000-8000-000000000202')$$,
  'P0001',
  'FORBIDDEN',
  'another consumer cannot cancel a foreign reservation through direct cancel_reservation'
);

select throws_ok(
  $$select public.update_reservation_fuel_preference('77700000-3000-4000-8000-000000000003', 'DIESEL', 'EXACT', '77800000-3000-4000-8000-000000000203')$$,
  'P0001',
  'FORBIDDEN',
  'another consumer cannot update a foreign reservation fuel preference'
);

select is(
  (select status || ':' || preferred_fuel_type || ':' || fuel_preference_mode from public.fuel_queue_entries where id = '77700000-3000-4000-8000-000000000003'),
  'WAITING:AI_95:EXACT',
  'foreign reservation stays unchanged after forbidden consumer attempts'
);

select set_config('request.jwt.claim.sub', '77100000-3000-4000-8000-000000000003', true);

select lives_ok(
  $$select public.cancel_reservation('77700000-3000-4000-8000-000000000004', 'OWNER_CANCELLED', 'staff cancel', '77800000-3000-4000-8000-000000000301')$$,
  'staff with role and station access can cancel an active allocated reservation'
);

select is(
  (select status from public.fuel_queue_entries where id = '77700000-3000-4000-8000-000000000004'),
  'CANCELLED',
  'staff cancellation marks reservation cancelled'
);

select lives_ok(
  $$select public.update_reservation_fuel_preference('77700000-3000-4000-8000-000000000005', 'DIESEL', 'EXACT', '77800000-3000-4000-8000-000000000302')$$,
  'staff with role and station access can update fuel preference when allocation lock does not apply'
);

select is(
  (select preferred_fuel_type || ':' || fuel_preference_mode from public.fuel_queue_entries where id = '77700000-3000-4000-8000-000000000005'),
  'DIESEL:EXACT',
  'staff fuel preference update is saved'
);

select set_config('request.jwt.claim.sub', '77100000-3000-4000-8000-000000000004', true);

select throws_ok(
  $$select public.cancel_reservation('77700000-3000-4000-8000-000000000006', 'OWNER_CANCELLED', null, '77800000-3000-4000-8000-000000000401')$$,
  'P0001',
  'FORBIDDEN',
  'staff with role but without station access cannot cancel reservation'
);

select throws_ok(
  $$select public.update_reservation_fuel_preference('77700000-3000-4000-8000-000000000006', 'GAS', 'EXACT', '77800000-3000-4000-8000-000000000402')$$,
  'P0001',
  'FUEL_PREFERENCE_LOCKED_BY_ALLOCATION',
  'staff cannot update fuel preference while reservation is active in the daily limit'
);

update public.daily_queue_allocations
set call_status = 'CONTACTED'
where id = '77900000-3000-4000-8000-000000000004';

select lives_ok(
  $$select public.create_reservation_call_log('77900000-3000-4000-8000-000000000004', 'NOT_CALLED', null, '77800000-3000-4000-8000-000000000403')$$,
  'staff can reset a contacted paused allocation outside the daily limit'
);

select throws_ok(
  $$select public.create_reservation_call_log('77900000-3000-4000-8000-000000000004', 'CONTACTED', null, '77800000-3000-4000-8000-000000000404')$$,
  'P0001',
  'ALLOCATION_NOT_ACTIVE',
  'staff cannot add a new contacted mark to a paused allocation outside the daily limit'
);

select lives_ok(
  $$select public.update_reservation_fuel_preference('77700000-3000-4000-8000-000000000008', 'GAS', 'EXACT', '77800000-3000-4000-8000-000000000405')$$,
  'staff can update fuel preference for a waiting reservation paused outside the daily limit'
);

select is(
  (select preferred_fuel_type || ':' || fuel_preference_mode from public.fuel_queue_entries where id = '77700000-3000-4000-8000-000000000008'),
  'GAS:EXACT',
  'paused outside-limit fuel preference update is saved'
);

select set_config('request.jwt.claim.sub', '77100000-3000-4000-8000-000000000005', true);

select lives_ok(
  $$select public.create_reservation(
    'A339AA777',
    'Reservation Cashier Driver',
    '+77003000009',
    'AI_95',
    20,
    'EXACT',
    'cashier-created queue entry',
    '77800000-3000-4000-8000-000000000501'
  )$$,
  'cashier can create a city queue reservation'
);

select is(
  (
    select operator_id
    from public.fuel_queue_entries
    where client_mutation_id = '77800000-3000-4000-8000-000000000501'
  ),
  '77200000-3000-4000-8000-000000000005'::uuid,
  'cashier-created reservation stores cashier as operator'
);

select is(
  (select status || ':' || preferred_fuel_type || ':' || fuel_preference_mode from public.fuel_queue_entries where id = '77700000-3000-4000-8000-000000000006'),
  'WAITING:AI_95:EXACT',
  'reservation stays unchanged after forbidden staff attempts'
);

select is(
  (select status from public.daily_queue_allocations where queue_entry_id = '77700000-3000-4000-8000-000000000006'),
  'ACTIVE',
  'allocation stays active after forbidden staff attempts'
);

select * from finish();
rollback;
