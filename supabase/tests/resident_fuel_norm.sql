begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

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
    '71000000-2000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'resident-norm-mayor@example.local',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '71000000-2000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'resident-norm-consumer@example.local',
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
    '70000000-2000-4000-8000-000000000001',
    '71000000-2000-4000-8000-000000000001',
    'Resident Norm Mayor',
    'mayor',
    true,
    'approved'
  ),
  (
    '70000000-2000-4000-8000-000000000002',
    '71000000-2000-4000-8000-000000000002',
    'Resident Norm Consumer',
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

insert into public.vehicles (id, plate_number, normalized_plate_number)
values ('72000000-2000-4000-8000-000000000001', 'A201AA777', 'A201AA777')
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.profile_vehicles (id, profile_id, vehicle_id, status)
values (
  '74000000-2000-4000-8000-000000000001',
  '70000000-2000-4000-8000-000000000002',
  '72000000-2000-4000-8000-000000000001',
  'ACTIVE'
)
on conflict (profile_id, vehicle_id) do update
set status = excluded.status;

select is(public.get_resident_fuel_norm_liters(), 20::numeric, 'default resident fuel norm is 20 liters');

select set_config('request.jwt.claim.sub', '71000000-2000-4000-8000-000000000001', true);

select is(
  (public.set_resident_fuel_norm_liters(25, '76000000-2000-4000-8000-000000000001')->>'liters')::numeric,
  25::numeric,
  'mayor can set resident fuel norm'
);

select set_config('request.jwt.claim.sub', '71000000-2000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.set_resident_fuel_norm_liters(30, '76000000-2000-4000-8000-000000000002')$$,
  'P0001',
  'FORBIDDEN',
  'consumer cannot set resident fuel norm'
);

select is(
  (
    public.create_consumer_reservation(
      '72000000-2000-4000-8000-000000000001',
      'Resident Driver',
      '+79991234567',
      'AI_95',
      999,
      'EXACT',
      null,
      '76000000-2000-4000-8000-000000000003'
    )->>'requested_liters'
  )::numeric,
  25::numeric,
  'manual consumer reservation liters are replaced by the configured resident norm'
);

select * from finish();
rollback;
