begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

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
    '78100000-4000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'cooldown-mayor@example.local',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '78100000-4000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'cooldown-consumer-recent@example.local',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '78100000-4000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'cooldown-consumer-old@example.local',
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
    '78200000-4000-4000-8000-000000000001',
    '78100000-4000-4000-8000-000000000001',
    'Cooldown Mayor',
    'mayor',
    true,
    'approved'
  ),
  (
    '78200000-4000-4000-8000-000000000002',
    '78100000-4000-4000-8000-000000000002',
    'Cooldown Consumer Recent',
    'consumer',
    true,
    'approved'
  ),
  (
    '78200000-4000-4000-8000-000000000003',
    '78100000-4000-4000-8000-000000000003',
    'Cooldown Consumer Old',
    'consumer',
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
  '78300000-4000-4000-8000-000000000001',
  'Cooldown Test Station',
  'Test address',
  true,
  994001
)
on conflict (id) do update
set name = excluded.name,
    address = excluded.address,
    is_active = excluded.is_active,
    allocation_order = excluded.allocation_order;

insert into public.vehicles (id, plate_number, normalized_plate_number)
values
  ('78400000-4000-4000-8000-000000000001', 'C401AA777', 'C401AA777'),
  ('78400000-4000-4000-8000-000000000002', 'C402AA777', 'C402AA777'),
  ('78400000-4000-4000-8000-000000000003', 'C403AA777', 'C403AA777'),
  ('78400000-4000-4000-8000-000000000004', 'C404AA777', 'C404AA777')
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values
  ('78500000-4000-4000-8000-000000000001', 'Cooldown Driver Recent Staff', '+78004000001'),
  ('78500000-4000-4000-8000-000000000002', 'Cooldown Driver Old Staff', '+78004000002'),
  ('78500000-4000-4000-8000-000000000003', 'Cooldown Driver Recent Consumer', '+78004000003'),
  ('78500000-4000-4000-8000-000000000004', 'Cooldown Driver Old Consumer', '+78004000004')
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

insert into public.profile_vehicles (id, profile_id, vehicle_id, status)
values
  (
    '78600000-4000-4000-8000-000000000001',
    '78200000-4000-4000-8000-000000000002',
    '78400000-4000-4000-8000-000000000003',
    'ACTIVE'
  ),
  (
    '78600000-4000-4000-8000-000000000002',
    '78200000-4000-4000-8000-000000000003',
    '78400000-4000-4000-8000-000000000004',
    'ACTIVE'
  )
on conflict (profile_id, vehicle_id) do update
set status = excluded.status;

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
  ('78700000-4000-4000-8000-000000000001', 994001, '78400000-4000-4000-8000-000000000001', '78500000-4000-4000-8000-000000000001', 'AI_95', 'EXACT', 20, 'FUELED', '78200000-4000-4000-8000-000000000001', '78800000-4000-4000-8000-000000000001', 'SYNCED'),
  ('78700000-4000-4000-8000-000000000002', 994002, '78400000-4000-4000-8000-000000000002', '78500000-4000-4000-8000-000000000002', 'AI_95', 'EXACT', 20, 'FUELED', '78200000-4000-4000-8000-000000000001', '78800000-4000-4000-8000-000000000002', 'SYNCED'),
  ('78700000-4000-4000-8000-000000000003', 994003, '78400000-4000-4000-8000-000000000003', '78500000-4000-4000-8000-000000000003', 'AI_95', 'EXACT', 20, 'FUELED', '78200000-4000-4000-8000-000000000002', '78800000-4000-4000-8000-000000000003', 'SYNCED'),
  ('78700000-4000-4000-8000-000000000004', 994004, '78400000-4000-4000-8000-000000000004', '78500000-4000-4000-8000-000000000004', 'AI_95', 'EXACT', 20, 'FUELED', '78200000-4000-4000-8000-000000000003', '78800000-4000-4000-8000-000000000004', 'SYNCED')
on conflict (id) do update
set status = excluded.status,
    operator_id = excluded.operator_id;

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
  ('78900000-4000-4000-8000-000000000001', (now() at time zone 'Europe/Moscow')::date - 1, '78700000-4000-4000-8000-000000000001', '78300000-4000-4000-8000-000000000001', 'AI_95', 20, 994001, 994001, 994001, now() - interval '1 day', 'FUELED', 'CONTACTED'),
  ('78900000-4000-4000-8000-000000000002', (now() at time zone 'Europe/Moscow')::date - 2, '78700000-4000-4000-8000-000000000002', '78300000-4000-4000-8000-000000000001', 'AI_95', 20, 994002, 994002, 994002, now() - interval '2 days', 'FUELED', 'CONTACTED'),
  ('78900000-4000-4000-8000-000000000003', (now() at time zone 'Europe/Moscow')::date - 1, '78700000-4000-4000-8000-000000000003', '78300000-4000-4000-8000-000000000001', 'AI_95', 20, 994003, 994003, 994003, now() - interval '1 day', 'FUELED', 'CONTACTED'),
  ('78900000-4000-4000-8000-000000000004', (now() at time zone 'Europe/Moscow')::date - 2, '78700000-4000-4000-8000-000000000004', '78300000-4000-4000-8000-000000000001', 'AI_95', 20, 994004, 994004, 994004, now() - interval '2 days', 'FUELED', 'CONTACTED')
on conflict (allocation_date, queue_entry_id) do update
set status = excluded.status,
    call_status = excluded.call_status;

insert into public.fueling_records (
  id,
  date,
  station_id,
  vehicle_id,
  driver_id,
  queue_entry_id,
  allocation_id,
  fuel_type,
  liters,
  cashier_id,
  is_manual_override,
  client_mutation_id,
  sync_status,
  fueled_at
)
values
  ('78a00000-4000-4000-8000-000000000001', (now() at time zone 'Europe/Moscow')::date - 1, '78300000-4000-4000-8000-000000000001', '78400000-4000-4000-8000-000000000001', '78500000-4000-4000-8000-000000000001', '78700000-4000-4000-8000-000000000001', '78900000-4000-4000-8000-000000000001', 'AI_95', 20, '78200000-4000-4000-8000-000000000001', false, '78b00000-4000-4000-8000-000000000001', 'SYNCED', now() - interval '1 day'),
  ('78a00000-4000-4000-8000-000000000002', (now() at time zone 'Europe/Moscow')::date - 2, '78300000-4000-4000-8000-000000000001', '78400000-4000-4000-8000-000000000002', '78500000-4000-4000-8000-000000000002', '78700000-4000-4000-8000-000000000002', '78900000-4000-4000-8000-000000000002', 'AI_95', 20, '78200000-4000-4000-8000-000000000001', false, '78b00000-4000-4000-8000-000000000002', 'SYNCED', now() - interval '2 days'),
  ('78a00000-4000-4000-8000-000000000003', (now() at time zone 'Europe/Moscow')::date - 1, '78300000-4000-4000-8000-000000000001', '78400000-4000-4000-8000-000000000003', '78500000-4000-4000-8000-000000000003', '78700000-4000-4000-8000-000000000003', '78900000-4000-4000-8000-000000000003', 'AI_95', 20, '78200000-4000-4000-8000-000000000001', false, '78b00000-4000-4000-8000-000000000003', 'SYNCED', now() - interval '1 day'),
  ('78a00000-4000-4000-8000-000000000004', (now() at time zone 'Europe/Moscow')::date - 2, '78300000-4000-4000-8000-000000000001', '78400000-4000-4000-8000-000000000004', '78500000-4000-4000-8000-000000000004', '78700000-4000-4000-8000-000000000004', '78900000-4000-4000-8000-000000000004', 'AI_95', 20, '78200000-4000-4000-8000-000000000001', false, '78b00000-4000-4000-8000-000000000004', 'SYNCED', now() - interval '2 days')
on conflict (id) do update
set date = excluded.date,
    fueled_at = excluded.fueled_at;

select set_config('request.jwt.claim.sub', '78100000-4000-4000-8000-000000000001', true);

select is(
  (public.set_reservation_refuel_cooldown(2, '78c00000-4000-4000-8000-000000000001')->>'days')::integer,
  2,
  'mayor can configure a two-day refuel cooldown'
);

select throws_ok(
  $$select public.create_reservation('C401AA777', 'Cooldown Driver', '+78004990001', 'AI_95', 20, 'EXACT', null, '78c00000-4000-4000-8000-000000000002')$$,
  'P0001',
  'REFUEL_COOLDOWN_ACTIVE',
  'staff reservation is blocked while the refuel cooldown is active'
);

select lives_ok(
  $$select public.create_reservation('C402AA777', 'Cooldown Driver', '+78004990002', 'AI_95', 20, 'EXACT', null, '78c00000-4000-4000-8000-000000000003')$$,
  'staff reservation is allowed after the refuel cooldown expires'
);

select set_config('request.jwt.claim.sub', '78100000-4000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.create_consumer_reservation('78400000-4000-4000-8000-000000000003', 'Cooldown Driver', '+78004990003', 'AI_95', 20, 'EXACT', null, '78c00000-4000-4000-8000-000000000004')$$,
  'P0001',
  'REFUEL_COOLDOWN_ACTIVE',
  'consumer reservation is blocked while the refuel cooldown is active'
);

select set_config('request.jwt.claim.sub', '78100000-4000-4000-8000-000000000003', true);

select lives_ok(
  $$select public.create_consumer_reservation('78400000-4000-4000-8000-000000000004', 'Cooldown Driver', '+78004990004', 'AI_95', 20, 'EXACT', null, '78c00000-4000-4000-8000-000000000005')$$,
  'consumer reservation is allowed after the refuel cooldown expires'
);

select * from finish();
rollback;
