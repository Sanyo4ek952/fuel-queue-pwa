-- Hosted Supabase test data for Fuel Queue PWA.
-- Run this in Supabase SQL Editor after all migrations are applied.
-- This seed file is data-only: do not change schema, constraints, roles,
-- policies, grants, or functions here. Put database changes in migrations.
-- The script is non-destructive for non-seed data: it aborts if current/tomorrow
-- business rows already exist for the test stations outside the fixed seed IDs.

set search_path = public, extensions;

do $$
declare
  target_dates date[] := array[current_date, current_date + 1];
  seed_station_ids uuid[] := array[
    '10000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid
  ];
  conflicting_rows integer;
begin
  if to_regclass('public.stations') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.daily_limits') is null
    or to_regclass('public.fuel_reservations') is null
    or to_regclass('public.fueling_records') is null
    or to_regclass('auth.users') is null then
    raise exception 'Run Supabase migrations before hosted-test-data.sql.';
  end if;

  if exists (
    select 1
    from auth.users
    where email in (
      'mayor@example.local',
      'station-manager@example.local',
      'station-manager-2@example.local',
      'cashier@example.local',
      'cashier-2@example.local',
      'mayor-assistant@example.local',
      'pending-cashier@example.local',
      'rejected-cashier@example.local'
    )
      and id not in (
        '20000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000007',
        '20000000-0000-0000-0000-000000000008'
      )
  ) then
    raise exception 'One of the dev emails already exists with a different auth.users.id.';
  end if;

  select count(*)
  into conflicting_rows
  from public.daily_limits
  where date = any(target_dates)
    and station_id = any(seed_station_ids)
    and id not in (
      '60000000-0000-0000-0000-000000000101',
      '60000000-0000-0000-0000-000000000102',
      '60000000-0000-0000-0000-000000000103',
      '60000000-0000-0000-0000-000000000201',
      '60000000-0000-0000-0000-000000000202',
      '60000000-0000-0000-0000-000000000203'
    );

  if conflicting_rows > 0 then
    raise exception 'Non-seed daily_limits already exist for current/tomorrow test dates.';
  end if;

  select count(*)
  into conflicting_rows
  from public.fuel_reservations
  where date = any(target_dates)
    and station_id = any(seed_station_ids)
    and id not in (
      '70000000-0000-0000-0000-000000000101',
      '70000000-0000-0000-0000-000000000102',
      '70000000-0000-0000-0000-000000000103',
      '70000000-0000-0000-0000-000000000104',
      '70000000-0000-0000-0000-000000000201',
      '70000000-0000-0000-0000-000000000202'
    );

  if conflicting_rows > 0 then
    raise exception 'Non-seed fuel_reservations already exist for current/tomorrow test dates.';
  end if;

  select count(*)
  into conflicting_rows
  from public.fueling_records
  where date = any(target_dates)
    and station_id = any(seed_station_ids)
    and id not in (
      '80000000-0000-0000-0000-000000000101'
    );

  if conflicting_rows > 0 then
    raise exception 'Non-seed fueling_records already exist for current/tomorrow test dates.';
  end if;
end $$;

insert into public.stations (id, name, address, is_active)
values
  ('10000000-0000-0000-0000-000000000001', 'AZS #1', 'Main station #1', true),
  ('10000000-0000-0000-0000-000000000002', 'AZS #2', 'Main station #2', true),
  ('10000000-0000-0000-0000-000000000003', 'AZS #3', 'Main station #3', true)
on conflict (id) do update
set
  name = excluded.name,
  address = excluded.address,
  is_active = excluded.is_active;

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
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mayor@example.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier@example.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'station-manager-2@example.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'station-manager@example.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mayor-assistant@example.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cashier-2@example.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pending-cashier@example.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"requested_station_id":"10000000-0000-0000-0000-000000000001"}'::jsonb, now(), now(), '', '', '', ''),
  ('20000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rejected-cashier@example.local', extensions.crypt('password123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"requested_station_id":"10000000-0000-0000-0000-000000000002"}'::jsonb, now(), now(), '', '', '', '')
on conflict (id) do update
set
  aud = excluded.aud,
  role = excluded.role,
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  u.id,
  u.id,
  u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.id in (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000006',
  '20000000-0000-0000-0000-000000000007',
  '20000000-0000-0000-0000-000000000008'
)
on conflict (provider_id, provider) do update
set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  updated_at = now();

do $$
begin
  if exists (
    select 1
    from public.profiles
    where id in (
      '30000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000003',
      '30000000-0000-0000-0000-000000000004',
      '30000000-0000-0000-0000-000000000005',
      '30000000-0000-0000-0000-000000000006',
      '30000000-0000-0000-0000-000000000007',
      '30000000-0000-0000-0000-000000000008'
    )
      and auth_user_id not in (
        '20000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000004',
        '20000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000007',
        '20000000-0000-0000-0000-000000000008'
      )
  ) then
    raise exception 'One of the fixed dev profile IDs is already used by another profile.';
  end if;

  update public.profiles
  set id = case auth_user_id
    when '20000000-0000-0000-0000-000000000001' then '30000000-0000-0000-0000-000000000001'::uuid
    when '20000000-0000-0000-0000-000000000002' then '30000000-0000-0000-0000-000000000002'::uuid
    when '20000000-0000-0000-0000-000000000003' then '30000000-0000-0000-0000-000000000003'::uuid
    when '20000000-0000-0000-0000-000000000004' then '30000000-0000-0000-0000-000000000004'::uuid
    when '20000000-0000-0000-0000-000000000005' then '30000000-0000-0000-0000-000000000005'::uuid
    when '20000000-0000-0000-0000-000000000006' then '30000000-0000-0000-0000-000000000006'::uuid
    when '20000000-0000-0000-0000-000000000007' then '30000000-0000-0000-0000-000000000007'::uuid
    when '20000000-0000-0000-0000-000000000008' then '30000000-0000-0000-0000-000000000008'::uuid
    else id
  end
  where auth_user_id in (
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000006',
    '20000000-0000-0000-0000-000000000007',
    '20000000-0000-0000-0000-000000000008'
  );
end $$;

insert into public.profiles (
  id,
  auth_user_id,
  full_name,
  first_name,
  last_name,
  position,
  signature_name,
  requested_station_id,
  role,
  is_active,
  approval_status,
  approved_by,
  approved_at,
  rejected_by,
  rejected_at,
  rejection_reason
)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Dev Mayor', 'Mayor', 'Dev', 'Mayor', 'Dev Mayor', null, 'mayor', true, 'approved', null, now(), null, null, null),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Dev Cashier', 'Cashier', 'Dev', 'Cashier', 'Dev Cashier', '10000000-0000-0000-0000-000000000001', 'cashier', true, 'approved', '30000000-0000-0000-0000-000000000004', now(), null, null, null),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'Dev Station Manager 2', 'Station Manager 2', 'Dev', 'Station Manager', 'Dev Station Manager 2', '10000000-0000-0000-0000-000000000002', 'station_manager', true, 'approved', '30000000-0000-0000-0000-000000000001', now(), null, null, null),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'Dev Station Manager', 'Station Manager', 'Dev', 'Station Manager', 'Dev Station Manager', null, 'station_manager', true, 'approved', '30000000-0000-0000-0000-000000000001', now(), null, null, null),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'Dev Mayor Assistant', 'Mayor Assistant', 'Dev', 'Mayor Assistant', 'Dev Mayor Assistant', null, 'mayor_assistant', true, 'approved', '30000000-0000-0000-0000-000000000001', now(), null, null, null),
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', 'Dev Cashier 2', 'Cashier 2', 'Dev', 'Cashier', 'Dev Cashier 2', '10000000-0000-0000-0000-000000000002', 'cashier', true, 'approved', '30000000-0000-0000-0000-000000000003', now(), null, null, null),
  ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', 'Pending Cashier', 'Pending', 'Cashier', 'Cashier', 'Pending Cashier', '10000000-0000-0000-0000-000000000001', 'cashier', false, 'pending', null, null, null, null, null),
  ('30000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000008', 'Rejected Cashier', 'Rejected', 'Cashier', 'Cashier', 'Rejected Cashier', '10000000-0000-0000-0000-000000000002', 'cashier', false, 'rejected', null, null, '30000000-0000-0000-0000-000000000001', now(), 'Seed rejected test user')
on conflict (auth_user_id) do update
set
  full_name = excluded.full_name,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  position = excluded.position,
  signature_name = excluded.signature_name,
  requested_station_id = excluded.requested_station_id,
  role = excluded.role,
  is_active = excluded.is_active,
  approval_status = excluded.approval_status,
  approved_by = excluded.approved_by,
  approved_at = excluded.approved_at,
  rejected_by = excluded.rejected_by,
  rejected_at = excluded.rejected_at,
  rejection_reason = excluded.rejection_reason;

insert into public.user_stations (user_id, station_id)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002')
on conflict (user_id, station_id) do nothing;

insert into public.vehicles (
  id,
  plate_number,
  normalized_plate_number,
  is_blocked,
  block_reason
)
values
  ('40000000-0000-0000-0000-000000000001', 'А111АА777', 'А111АА777', false, null),
  ('40000000-0000-0000-0000-000000000002', 'А222АА777', 'А222АА777', false, null),
  ('40000000-0000-0000-0000-000000000003', 'А333АА777', 'А333АА777', false, null),
  ('40000000-0000-0000-0000-000000000004', 'А444АА777', 'А444АА777', true, 'Seed blocked vehicle'),
  ('40000000-0000-0000-0000-000000000005', 'А555АА777', 'А555АА777', false, null),
  ('40000000-0000-0000-0000-000000000006', 'А666АА777', 'А666АА777', false, null),
  ('40000000-0000-0000-0000-000000000007', 'А777АА777', 'А777АА777', false, null),
  ('40000000-0000-0000-0000-000000000008', 'В111ВВ777', 'В111ВВ777', false, null),
  ('40000000-0000-0000-0000-000000000009', 'В222ВВ777', 'В222ВВ777', false, null)
on conflict (normalized_plate_number) do update
set
  plate_number = excluded.plate_number,
  is_blocked = excluded.is_blocked,
  block_reason = excluded.block_reason;

insert into public.drivers (id, full_name, phone)
values
  ('50000000-0000-0000-0000-000000000001', 'Driver Allowed One', '+70000000001'),
  ('50000000-0000-0000-0000-000000000002', 'Driver Other Station', '+70000000002'),
  ('50000000-0000-0000-0000-000000000003', 'Driver Fueled Today', '+70000000003'),
  ('50000000-0000-0000-0000-000000000004', 'Driver Blocked', '+70000000004'),
  ('50000000-0000-0000-0000-000000000005', 'Driver No Reservation', '+70000000005'),
  ('50000000-0000-0000-0000-000000000006', 'Driver Manual Override', '+70000000006'),
  ('50000000-0000-0000-0000-000000000007', 'Driver Liters Limit', '+70000000007'),
  ('50000000-0000-0000-0000-000000000008', 'Driver Tomorrow One', '+70000000008'),
  ('50000000-0000-0000-0000-000000000009', 'Driver Tomorrow Two', '+70000000009')
on conflict (id) do update
set
  full_name = excluded.full_name,
  phone = excluded.phone;

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
values
  ('60000000-0000-0000-0000-000000000101', current_date, '10000000-0000-0000-0000-000000000001', 12, 50, 'OPEN', '30000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000101'),
  ('60000000-0000-0000-0000-000000000102', current_date, '10000000-0000-0000-0000-000000000002', 12, 50, 'OPEN', '30000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000102'),
  ('60000000-0000-0000-0000-000000000103', current_date, '10000000-0000-0000-0000-000000000003', 8, 45, 'OPEN', '30000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000103'),
  ('60000000-0000-0000-0000-000000000201', current_date + 1, '10000000-0000-0000-0000-000000000001', 20, 50, 'OPEN', '30000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000201'),
  ('60000000-0000-0000-0000-000000000202', current_date + 1, '10000000-0000-0000-0000-000000000002', 20, 50, 'OPEN', '30000000-0000-0000-0000-000000000003', '61000000-0000-0000-0000-000000000202'),
  ('60000000-0000-0000-0000-000000000203', current_date + 1, '10000000-0000-0000-0000-000000000003', 15, 45, 'OPEN', '30000000-0000-0000-0000-000000000004', '61000000-0000-0000-0000-000000000203')
on conflict (id) do update
set
  date = excluded.date,
  station_id = excluded.station_id,
  total_vehicle_limit = excluded.total_vehicle_limit,
  max_liters_per_vehicle = excluded.max_liters_per_vehicle,
  status = excluded.status,
  created_by = excluded.created_by,
  client_mutation_id = excluded.client_mutation_id;

insert into public.daily_fuel_type_limits (
  daily_limit_id,
  fuel_type,
  vehicle_limit,
  liters_limit
)
values
  ('60000000-0000-0000-0000-000000000101', 'AI_92', 4, 200),
  ('60000000-0000-0000-0000-000000000101', 'AI_95', 5, 250),
  ('60000000-0000-0000-0000-000000000101', 'DIESEL', 3, 180),
  ('60000000-0000-0000-0000-000000000102', 'AI_92', 4, 200),
  ('60000000-0000-0000-0000-000000000102', 'AI_95', 5, 250),
  ('60000000-0000-0000-0000-000000000102', 'DIESEL', 3, 180),
  ('60000000-0000-0000-0000-000000000103', 'AI_95', 4, 180),
  ('60000000-0000-0000-0000-000000000103', 'DIESEL', 4, 180),
  ('60000000-0000-0000-0000-000000000201', 'AI_92', 6, 300),
  ('60000000-0000-0000-0000-000000000201', 'AI_95', 8, 400),
  ('60000000-0000-0000-0000-000000000201', 'DIESEL', 6, 300),
  ('60000000-0000-0000-0000-000000000202', 'AI_92', 6, 300),
  ('60000000-0000-0000-0000-000000000202', 'AI_95', 8, 400),
  ('60000000-0000-0000-0000-000000000202', 'DIESEL', 6, 300),
  ('60000000-0000-0000-0000-000000000203', 'AI_95', 8, 360),
  ('60000000-0000-0000-0000-000000000203', 'DIESEL', 7, 315)
on conflict (daily_limit_id, fuel_type) do update
set
  vehicle_limit = excluded.vehicle_limit,
  liters_limit = excluded.liters_limit;

insert into public.fuel_reservations (
  id,
  date,
  station_id,
  vehicle_id,
  driver_id,
  fuel_type,
  requested_liters,
  queue_number,
  status,
  operator_id,
  approved_by,
  comment,
  client_mutation_id,
  sync_status
)
values
  ('70000000-0000-0000-0000-000000000101', current_date, '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'AI_95', 40, 1, 'RESERVED', '30000000-0000-0000-0000-000000000004', null, 'Seed: allowed today on station 1', '71000000-0000-0000-0000-000000000101', 'SYNCED'),
  ('70000000-0000-0000-0000-000000000102', current_date, '10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'DIESEL', 45, 1, 'RESERVED', '30000000-0000-0000-0000-000000000003', null, 'Seed: reserved at station 2', '71000000-0000-0000-0000-000000000102', 'SYNCED'),
  ('70000000-0000-0000-0000-000000000103', current_date, '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 'AI_92', 35, 2, 'FUELED', '30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', 'Seed: already fueled today', '71000000-0000-0000-0000-000000000103', 'SYNCED'),
  ('70000000-0000-0000-0000-000000000104', current_date, '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000007', 'AI_95', 90, 3, 'RESERVED', '30000000-0000-0000-0000-000000000004', null, 'Seed: liters exceed max per vehicle', '71000000-0000-0000-0000-000000000104', 'SYNCED'),
  ('70000000-0000-0000-0000-000000000201', current_date + 1, '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000008', 'AI_95', 40, 1, 'RESERVED', '30000000-0000-0000-0000-000000000005', null, 'Seed: tomorrow station 1', '71000000-0000-0000-0000-000000000201', 'SYNCED'),
  ('70000000-0000-0000-0000-000000000202', current_date + 1, '10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-000000000009', 'DIESEL', 45, 1, 'RESERVED', '30000000-0000-0000-0000-000000000003', null, 'Seed: tomorrow station 2', '71000000-0000-0000-0000-000000000202', 'SYNCED')
on conflict (id) do update
set
  date = excluded.date,
  station_id = excluded.station_id,
  vehicle_id = excluded.vehicle_id,
  driver_id = excluded.driver_id,
  fuel_type = excluded.fuel_type,
  requested_liters = excluded.requested_liters,
  queue_number = excluded.queue_number,
  status = excluded.status,
  operator_id = excluded.operator_id,
  approved_by = excluded.approved_by,
  comment = excluded.comment,
  client_mutation_id = excluded.client_mutation_id,
  sync_status = excluded.sync_status;

insert into public.fueling_records (
  id,
  date,
  station_id,
  vehicle_id,
  driver_id,
  reservation_id,
  fuel_type,
  liters,
  cashier_id,
  is_manual_override,
  override_id,
  comment,
  client_mutation_id,
  sync_status,
  fueled_at
)
values
  ('80000000-0000-0000-0000-000000000101', current_date, '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000103', 'AI_92', 35, '30000000-0000-0000-0000-000000000002', false, null, 'Seed: already fueled today', '81000000-0000-0000-0000-000000000101', 'SYNCED', now() - interval '1 hour')
on conflict (id) do update
set
  date = excluded.date,
  station_id = excluded.station_id,
  vehicle_id = excluded.vehicle_id,
  driver_id = excluded.driver_id,
  reservation_id = excluded.reservation_id,
  fuel_type = excluded.fuel_type,
  liters = excluded.liters,
  cashier_id = excluded.cashier_id,
  is_manual_override = excluded.is_manual_override,
  override_id = excluded.override_id,
  comment = excluded.comment,
  client_mutation_id = excluded.client_mutation_id,
  sync_status = excluded.sync_status,
  fueled_at = excluded.fueled_at;

insert into public.manual_overrides (
  id,
  date,
  station_id,
  vehicle_id,
  reason,
  approved_by,
  expires_at,
  used_at,
  client_mutation_id,
  sync_status
)
values
  ('90000000-0000-0000-0000-000000000101', current_date, '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000006', 'Seed manual override without reservation', '30000000-0000-0000-0000-000000000004', now() + interval '8 hours', null, '91000000-0000-0000-0000-000000000101', 'SYNCED')
on conflict (id) do update
set
  date = excluded.date,
  station_id = excluded.station_id,
  vehicle_id = excluded.vehicle_id,
  reason = excluded.reason,
  approved_by = excluded.approved_by,
  expires_at = excluded.expires_at,
  used_at = excluded.used_at,
  client_mutation_id = excluded.client_mutation_id,
  sync_status = excluded.sync_status;

insert into public.refusal_records (
  id,
  date,
  station_id,
  vehicle_id,
  driver_id,
  reservation_id,
  reason,
  comment,
  user_id,
  client_mutation_id,
  sync_status
)
values
  ('a0000000-0000-0000-0000-000000000101', current_date, '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000004', null, 'VEHICLE_BLOCKED', 'Seed refusal for blocked vehicle', '30000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000101', 'SYNCED')
on conflict (id) do update
set
  date = excluded.date,
  station_id = excluded.station_id,
  vehicle_id = excluded.vehicle_id,
  driver_id = excluded.driver_id,
  reservation_id = excluded.reservation_id,
  reason = excluded.reason,
  comment = excluded.comment,
  user_id = excluded.user_id,
  client_mutation_id = excluded.client_mutation_id,
  sync_status = excluded.sync_status;

insert into public.audit_logs (
  id,
  user_id,
  action,
  entity_type,
  entity_id,
  old_value,
  new_value
)
values
  ('b0000000-0000-0000-0000-000000000101', '30000000-0000-0000-0000-000000000004', 'SEED_TEST_DATA', 'seed', null, null, jsonb_build_object('script', 'hosted-test-data.sql', 'date', current_date))
on conflict (id) do update
set
  user_id = excluded.user_id,
  action = excluded.action,
  entity_type = excluded.entity_type,
  entity_id = excluded.entity_id,
  old_value = excluded.old_value,
  new_value = excluded.new_value;

select
  'hosted-test-data-ready' as status,
  current_date as today,
  current_date + 1 as tomorrow,
  (select count(*) from public.stations where id::text like '10000000-%') as stations,
  (select count(*) from public.profiles where auth_user_id in (
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000006',
    '20000000-0000-0000-0000-000000000007',
    '20000000-0000-0000-0000-000000000008'
  )) as profiles,
  (select count(*) from public.daily_limits where date in (current_date, current_date + 1)) as daily_limits,
  (select count(*) from public.fuel_reservations where date in (current_date, current_date + 1)) as reservations;
