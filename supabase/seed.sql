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

insert into public.profiles (id, auth_user_id, full_name, role)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Dev Operator', 'operator'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Dev Cashier', 'cashier'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'Dev Shift Supervisor', 'shift_supervisor'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'Dev Station Admin', 'station_admin'),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'Dev City Admin', 'city_admin'),
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', 'Dev Viewer', 'viewer')
on conflict (auth_user_id) do update
set
  full_name = excluded.full_name,
  role = excluded.role,
  is_active = true;

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
