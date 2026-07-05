insert into public.stations (id, name, address)
values
  ('10000000-0000-0000-0000-000000000001', 'АЗС №1', 'Основная АЗС №1'),
  ('10000000-0000-0000-0000-000000000002', 'АЗС №2', 'Основная АЗС №2'),
  ('10000000-0000-0000-0000-000000000003', 'АЗС №3', 'Основная АЗС №3')
on conflict (id) do update
set
  name = excluded.name,
  address = excluded.address,
  is_active = true;

do $$
declare
  dev_instance_id uuid := '00000000-0000-0000-0000-000000000000';
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'auth'
      and table_name = 'users'
  ) then
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
        '20000000-0000-0000-0000-000000000001',
        dev_instance_id,
        'authenticated',
        'authenticated',
        'operator@example.local',
        extensions.crypt('password123', extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '20000000-0000-0000-0000-000000000002',
        dev_instance_id,
        'authenticated',
        'authenticated',
        'cashier@example.local',
        extensions.crypt('password123', extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '20000000-0000-0000-0000-000000000003',
        dev_instance_id,
        'authenticated',
        'authenticated',
        'shift@example.local',
        extensions.crypt('password123', extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '20000000-0000-0000-0000-000000000004',
        dev_instance_id,
        'authenticated',
        'authenticated',
        'station-admin@example.local',
        extensions.crypt('password123', extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '20000000-0000-0000-0000-000000000005',
        dev_instance_id,
        'authenticated',
        'authenticated',
        'city-admin@example.local',
        extensions.crypt('password123', extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      ),
      (
        '20000000-0000-0000-0000-000000000006',
        dev_instance_id,
        'authenticated',
        'authenticated',
        'viewer@example.local',
        extensions.crypt('password123', extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      )
    on conflict (id) do nothing;
  end if;
end $$;

insert into public.profiles (
  id,
  auth_user_id,
  full_name,
  first_name,
  last_name,
  position,
  signature_name,
  role,
  is_active,
  approval_status,
  approved_at
)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Dev Operator', 'Operator', 'Dev', 'Operator', 'Dev Operator', 'operator', true, 'approved', now()),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Dev Cashier', 'Cashier', 'Dev', 'Cashier', 'Dev Cashier', 'cashier', true, 'approved', now()),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'Dev Shift Supervisor', 'Shift Supervisor', 'Dev', 'Shift Supervisor', 'Dev Shift Supervisor', 'shift_supervisor', true, 'approved', now()),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'Dev Station Admin', 'Station Admin', 'Dev', 'Station Admin', 'Dev Station Admin', 'station_admin', true, 'approved', now()),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'Dev City Admin', 'City Admin', 'Dev', 'City Admin', 'Dev City Admin', 'city_admin', true, 'approved', now()),
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', 'Dev Viewer', 'Viewer', 'Dev', 'Viewer', 'Dev Viewer', 'viewer', true, 'approved', now())
on conflict (auth_user_id) do update
set
  full_name = excluded.full_name,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  position = excluded.position,
  signature_name = excluded.signature_name,
  role = excluded.role,
  is_active = excluded.is_active,
  approval_status = excluded.approval_status,
  approved_at = coalesce(public.profiles.approved_at, excluded.approved_at);

insert into public.user_stations (user_id, station_id)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001')
on conflict (user_id, station_id) do nothing;
