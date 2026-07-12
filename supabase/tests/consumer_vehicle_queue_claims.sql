begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
    '71000000-1000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'vehicle-owner@example.local',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '71000000-1000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'vehicle-claimant@example.local',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '71000000-1000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'vehicle-late-link@example.local',
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
set id = case auth_user_id
      when '71000000-1000-4000-8000-000000000001' then '70000000-1000-4000-8000-000000000001'::uuid
      when '71000000-1000-4000-8000-000000000002' then '70000000-1000-4000-8000-000000000002'::uuid
      when '71000000-1000-4000-8000-000000000003' then '70000000-1000-4000-8000-000000000003'::uuid
      else id
    end,
    full_name = case auth_user_id
      when '71000000-1000-4000-8000-000000000001' then 'Vehicle Owner'
      when '71000000-1000-4000-8000-000000000002' then 'Vehicle Claimant'
      when '71000000-1000-4000-8000-000000000003' then 'Vehicle Late Link'
      else full_name
    end,
    role = 'consumer',
    is_active = true,
    approval_status = 'approved'
where auth_user_id in (
  '71000000-1000-4000-8000-000000000001',
  '71000000-1000-4000-8000-000000000002',
  '71000000-1000-4000-8000-000000000003'
);

insert into public.profiles (id, auth_user_id, full_name, role, is_active, approval_status)
select *
from (
  values
    ('70000000-1000-4000-8000-000000000001'::uuid, '71000000-1000-4000-8000-000000000001'::uuid, 'Vehicle Owner', 'consumer', true, 'approved'),
    ('70000000-1000-4000-8000-000000000002'::uuid, '71000000-1000-4000-8000-000000000002'::uuid, 'Vehicle Claimant', 'consumer', true, 'approved'),
    ('70000000-1000-4000-8000-000000000003'::uuid, '71000000-1000-4000-8000-000000000003'::uuid, 'Vehicle Late Link', 'consumer', true, 'approved')
) as profile_seed(id, auth_user_id, full_name, role, is_active, approval_status)
where not exists (
  select 1
  from public.profiles p
  where p.auth_user_id = profile_seed.auth_user_id
);

insert into public.vehicles (id, plate_number, normalized_plate_number)
values
  ('72000000-1000-4000-8000-000000000001', 'A701AA777', 'A701AA777'),
  ('72000000-1000-4000-8000-000000000002', 'A702AA777', 'A702AA777'),
  ('72000000-1000-4000-8000-000000000003', 'A703AA777', 'A703AA777')
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values
  ('73000000-1000-4000-8000-000000000001', 'Driver Claim One', '+77000000001'),
  ('73000000-1000-4000-8000-000000000002', 'Driver Claim Two', '+77000000002'),
  ('73000000-1000-4000-8000-000000000003', 'Driver Claim Three', '+77000000003')
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

insert into public.profile_vehicles (id, profile_id, vehicle_id, status, created_at, updated_at)
values (
  '74000000-1000-4000-8000-000000000001',
  '70000000-1000-4000-8000-000000000001',
  '72000000-1000-4000-8000-000000000001',
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
    '75000000-1000-4000-8000-000000000001',
    970001,
    '72000000-1000-4000-8000-000000000001',
    '73000000-1000-4000-8000-000000000001',
    'AI_95',
    'EXACT',
    20,
    'WAITING',
    '70000000-1000-4000-8000-000000000001',
    '76000000-1000-4000-8000-000000000001',
    'SYNCED',
    timestamp with time zone '2026-07-02 09:00:00+03',
    timestamp with time zone '2026-07-02 09:00:00+03'
  ),
  (
    '75000000-1000-4000-8000-000000000002',
    970002,
    '72000000-1000-4000-8000-000000000002',
    '73000000-1000-4000-8000-000000000002',
    'AI_95',
    'EXACT',
    20,
    'WAITING',
    '70000000-1000-4000-8000-000000000001',
    '76000000-1000-4000-8000-000000000002',
    'SYNCED',
    timestamp with time zone '2026-07-02 10:00:00+03',
    timestamp with time zone '2026-07-02 10:00:00+03'
  ),
  (
    '75000000-1000-4000-8000-000000000003',
    970003,
    '72000000-1000-4000-8000-000000000003',
    '73000000-1000-4000-8000-000000000003',
    'AI_95',
    'EXACT',
    20,
    'CANCELLED',
    '70000000-1000-4000-8000-000000000001',
    '76000000-1000-4000-8000-000000000003',
    'SYNCED',
    timestamp with time zone '2026-07-02 11:00:00+03',
    timestamp with time zone '2026-07-02 11:00:00+03'
  )
on conflict (id) do update
set status = excluded.status,
    operator_id = excluded.operator_id,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

select set_config('request.jwt.claim.sub', '71000000-1000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.create_consumer_vehicle('A701AA777', '76000000-1000-4000-8000-000000000011')$$,
  'P0001',
  'VEHICLE_ALREADY_ASSIGNED',
  'a new consumer cannot claim a vehicle assigned to another consumer while it is waiting in queue'
);

select throws_ok(
  $$select public.unlink_my_vehicle('74000000-1000-4000-8000-000000000001', '76000000-1000-4000-8000-000000000016')$$,
  'P0001',
  'CONSUMER_VEHICLE_NOT_FOUND',
  'a consumer cannot unlink another consumer vehicle'
);

select set_config('request.jwt.claim.sub', '71000000-1000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.create_consumer_vehicle('A701AA777', '76000000-1000-4000-8000-000000000012')$$,
  'the consumer who linked the vehicle before queue creation can keep using it'
);

select throws_ok(
  $$select public.unlink_my_vehicle('74000000-1000-4000-8000-000000000001', '76000000-1000-4000-8000-000000000017')$$,
  'P0001',
  'VEHICLE_IN_ACTIVE_QUEUE',
  'a consumer cannot unlink a vehicle while it is waiting in queue'
);

update public.fuel_queue_entries
set status = 'FUELED'
where id = '75000000-1000-4000-8000-000000000001';

select lives_ok(
  $$select public.unlink_my_vehicle('74000000-1000-4000-8000-000000000001', '76000000-1000-4000-8000-000000000018')$$,
  'a consumer can unlink a vehicle after it leaves the active queue'
);

select is(
  jsonb_array_length(public.list_my_vehicles()),
  0,
  'an unlinked vehicle is hidden from my vehicle list'
);

select set_config('request.jwt.claim.sub', '71000000-1000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.create_consumer_vehicle('A701AA777', '76000000-1000-4000-8000-000000000013')$$,
  'P0001',
  'VEHICLE_ALREADY_ASSIGNED',
  'a new consumer cannot claim a vehicle already assigned to another consumer after it leaves the active queue'
);

select lives_ok(
  $$select public.create_consumer_vehicle('A703AA777', '76000000-1000-4000-8000-000000000014')$$,
  'a new consumer can add the vehicle after a cancelled queue entry'
);

insert into public.profile_vehicles (id, profile_id, vehicle_id, status, created_at, updated_at)
values (
  '74000000-1000-4000-8000-000000000002',
  '70000000-1000-4000-8000-000000000003',
  '72000000-1000-4000-8000-000000000002',
  'ACTIVE',
  timestamp with time zone '2026-07-03 09:00:00+03',
  timestamp with time zone '2026-07-03 09:00:00+03'
)
on conflict (profile_id, vehicle_id) do update
set status = excluded.status,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

select set_config('request.jwt.claim.sub', '71000000-1000-4000-8000-000000000003', true);

select is(
  public.get_my_queue_status(),
  null,
  'a profile linked after queue creation cannot see that active queue entry'
);

select throws_ok(
  $$select public.cancel_my_reservation('75000000-1000-4000-8000-000000000002', '76000000-1000-4000-8000-000000000015')$$,
  'P0001',
  'FORBIDDEN',
  'a profile linked after queue creation cannot cancel that active queue entry'
);

select * from finish();
rollback;
