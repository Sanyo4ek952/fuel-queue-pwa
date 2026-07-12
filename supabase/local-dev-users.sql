-- Local development staff accounts and 500 consumer accounts for Fuel Queue PWA.
-- Run only against the local Supabase database:
--   npx supabase db query --local --file supabase/local-dev-users.sql
--
-- Password for every account in this file: password123

do $$
declare
  dev_instance_id uuid := '00000000-0000-0000-0000-000000000000';
  station_ids uuid[] := array[
    '10000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid
  ];
  row_data record;
  n integer;
  auth_user_id_value uuid;
  profile_id_value uuid;
  consumer_vehicle_id_value uuid;
  email_value text;
  full_name_value text;
  first_name_value text;
  phone_value text;
  plate_value text;
  generated_count integer;
  documented_count integer;
begin
  perform set_config('search_path', 'public, extensions', true);

  insert into public.stations (id, name, address, is_active, allocation_order)
  values
    (station_ids[1], 'АТАН АЗС №076 (нижняя)', 'Восточное шоссе, 2', true, 1),
    (station_ids[2], 'АТАН АЗС №077 (верхняя)', 'Феодосийское шоссе, 14', true, 2),
    (station_ids[3], 'ТЭС АЗС №37', 'Феодосийское шоссе, 12А', true, 3)
  on conflict (id) do update
  set
    name = excluded.name,
    address = excluded.address,
    is_active = excluded.is_active,
    allocation_order = excluded.allocation_order,
    updated_at = now();

  for row_data in
    select *
    from (
      values
        (
          '20000000-0000-0000-0000-000000000001'::uuid,
          '30000000-0000-0000-0000-000000000001'::uuid,
          'mayor@example.local',
          'Dev Mayor',
          'Mayor',
          'Dev',
          'mayor',
          'Mayor',
          null::uuid,
          true,
          'approved'
        ),
        (
          '20000000-0000-0000-0000-000000000002'::uuid,
          '30000000-0000-0000-0000-000000000002'::uuid,
          'cashier@example.local',
          'Dev Cashier',
          'Cashier',
          'Dev',
          'cashier',
          'Cashier',
          station_ids[1],
          true,
          'approved'
        ),
        (
          '20000000-0000-0000-0000-000000000003'::uuid,
          '30000000-0000-0000-0000-000000000003'::uuid,
          'station-manager-2@example.local',
          'Dev Station Manager 2',
          'Station Manager 2',
          'Dev',
          'station_manager',
          'Station Manager',
          station_ids[2],
          true,
          'approved'
        ),
        (
          '20000000-0000-0000-0000-000000000004'::uuid,
          '30000000-0000-0000-0000-000000000004'::uuid,
          'station-manager@example.local',
          'Dev Station Manager',
          'Station Manager',
          'Dev',
          'station_manager',
          'Station Manager',
          null::uuid,
          true,
          'approved'
        ),
        (
          '20000000-0000-0000-0000-000000000005'::uuid,
          '30000000-0000-0000-0000-000000000005'::uuid,
          'mayor-assistant@example.local',
          'Dev Mayor Assistant',
          'Mayor Assistant',
          'Dev',
          'mayor_assistant',
          'Mayor Assistant',
          null::uuid,
          true,
          'approved'
        ),
        (
          '20000000-0000-0000-0000-000000000006'::uuid,
          '30000000-0000-0000-0000-000000000006'::uuid,
          'cashier-2@example.local',
          'Dev Cashier 2',
          'Cashier 2',
          'Dev',
          'cashier',
          'Cashier',
          station_ids[2],
          true,
          'approved'
        ),
        (
          '20000000-0000-0000-0000-000000000007'::uuid,
          '30000000-0000-0000-0000-000000000007'::uuid,
          'pending-cashier@example.local',
          'Pending Cashier',
          'Pending',
          'Cashier',
          'cashier',
          'Cashier',
          station_ids[1],
          false,
          'pending'
        ),
        (
          '20000000-0000-0000-0000-000000000008'::uuid,
          '30000000-0000-0000-0000-000000000008'::uuid,
          'rejected-cashier@example.local',
          'Rejected Cashier',
          'Rejected',
          'Cashier',
          'cashier',
          'Cashier',
          station_ids[2],
          false,
          'rejected'
        )
    ) as documented(
      auth_user_id,
      profile_id,
      email,
      full_name,
      first_name,
      last_name,
      profile_role,
      position,
      requested_station_id,
      is_active,
      approval_status
    )
  loop
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
    values (
      row_data.auth_user_id,
      dev_instance_id,
      'authenticated',
      'authenticated',
      row_data.email,
      extensions.crypt('password123', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('requested_role', row_data.profile_role),
      now(),
      now(),
      '',
      '',
      '',
      ''
    )
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
    values (
      row_data.auth_user_id,
      row_data.auth_user_id,
      row_data.auth_user_id::text,
      jsonb_build_object(
        'sub',
        row_data.auth_user_id::text,
        'email',
        row_data.email,
        'email_verified',
        true,
        'phone_verified',
        false
      ),
      'email',
      now(),
      now(),
      now()
    )
    on conflict (provider_id, provider) do update
    set
      user_id = excluded.user_id,
      identity_data = excluded.identity_data,
      updated_at = now();

    insert into public.profiles (
      id,
      auth_user_id,
      full_name,
      email,
      first_name,
      last_name,
      position,
      signature_name,
      auth_provider,
      requested_station_id,
      role,
      is_active,
      approval_status,
      approved_at,
      rejected_at,
      rejection_reason
    )
    values (
      row_data.profile_id,
      row_data.auth_user_id,
      row_data.full_name,
      row_data.email,
      row_data.first_name,
      row_data.last_name,
      row_data.position,
      row_data.full_name,
      'email',
      row_data.requested_station_id,
      row_data.profile_role,
      row_data.is_active,
      row_data.approval_status,
      case when row_data.approval_status = 'approved' then now() else null end,
      case when row_data.approval_status = 'rejected' then now() else null end,
      case when row_data.approval_status = 'rejected' then 'Local seed rejected test user' else null end
    )
    on conflict (auth_user_id) do update
    set
      full_name = excluded.full_name,
      email = excluded.email,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      position = excluded.position,
      signature_name = excluded.signature_name,
      auth_provider = excluded.auth_provider,
      requested_station_id = excluded.requested_station_id,
      role = excluded.role,
      is_active = excluded.is_active,
      approval_status = excluded.approval_status,
      approved_at = excluded.approved_at,
      rejected_at = excluded.rejected_at,
      rejection_reason = excluded.rejection_reason,
      updated_at = now();
  end loop;

  delete from auth.users
  where email like 'local-consumer-%@example.local';

  for n in 1..500 loop
    auth_user_id_value := (
      substr(md5('local-dev-auth-' || n::text), 1, 8) || '-' ||
      substr(md5('local-dev-auth-' || n::text), 9, 4) || '-' ||
      substr(md5('local-dev-auth-' || n::text), 13, 4) || '-' ||
      substr(md5('local-dev-auth-' || n::text), 17, 4) || '-' ||
      substr(md5('local-dev-auth-' || n::text), 21, 12)
    )::uuid;
    profile_id_value := (
      substr(md5('local-dev-profile-' || n::text), 1, 8) || '-' ||
      substr(md5('local-dev-profile-' || n::text), 9, 4) || '-' ||
      substr(md5('local-dev-profile-' || n::text), 13, 4) || '-' ||
      substr(md5('local-dev-profile-' || n::text), 17, 4) || '-' ||
      substr(md5('local-dev-profile-' || n::text), 21, 12)
    )::uuid;
    consumer_vehicle_id_value := (
      substr(md5('local-dev-consumer-vehicle-' || n::text), 1, 8) || '-' ||
      substr(md5('local-dev-consumer-vehicle-' || n::text), 9, 4) || '-' ||
      substr(md5('local-dev-consumer-vehicle-' || n::text), 13, 4) || '-' ||
      substr(md5('local-dev-consumer-vehicle-' || n::text), 17, 4) || '-' ||
      substr(md5('local-dev-consumer-vehicle-' || n::text), 21, 12)
    )::uuid;

    email_value := 'local-consumer-' || lpad(n::text, 4, '0') || '@example.local';
    full_name_value := 'Local Consumer ' || lpad(n::text, 4, '0');
    first_name_value := 'Consumer ' || lpad(n::text, 4, '0');
    phone_value := '+7910' || lpad(n::text, 7, '0');
    plate_value := 'K' || lpad(n::text, 3, '0') || 'MM777';

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
    values (
      auth_user_id_value,
      dev_instance_id,
      'authenticated',
      'authenticated',
      email_value,
      extensions.crypt('password123', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"requested_role":"consumer"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    )
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
    values (
      auth_user_id_value,
      auth_user_id_value,
      auth_user_id_value::text,
      jsonb_build_object(
        'sub',
        auth_user_id_value::text,
        'email',
        email_value,
        'email_verified',
        true,
        'phone_verified',
        false
      ),
      'email',
      now(),
      now(),
      now()
    )
    on conflict (provider_id, provider) do update
    set
      user_id = excluded.user_id,
      identity_data = excluded.identity_data,
      updated_at = now();

    insert into public.profiles (
      id,
      auth_user_id,
      full_name,
      email,
      first_name,
      last_name,
      phone,
      signature_name,
      auth_provider,
      role,
      is_active,
      approval_status,
      approved_at
    )
    values (
      profile_id_value,
      auth_user_id_value,
      full_name_value,
      email_value,
      first_name_value,
      'Local',
      phone_value,
      full_name_value,
      'email',
      'consumer',
      true,
      'approved',
      now()
    )
    on conflict (auth_user_id) do update
    set
      full_name = excluded.full_name,
      email = excluded.email,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      phone = excluded.phone,
      signature_name = excluded.signature_name,
      auth_provider = excluded.auth_provider,
      role = excluded.role,
      is_active = excluded.is_active,
      approval_status = excluded.approval_status,
      approved_at = coalesce(public.profiles.approved_at, excluded.approved_at),
      updated_at = now();

    select id
    into profile_id_value
    from public.profiles
    where auth_user_id = auth_user_id_value;

    if profile_id_value is null then
      raise exception 'Consumer profile was not created for %.', email_value;
    end if;

    insert into public.vehicles (
      id,
      plate_number,
      normalized_plate_number,
      is_blocked,
      block_reason
    )
    values (
      consumer_vehicle_id_value,
      plate_value,
      plate_value,
      false,
      null
    )
    on conflict (normalized_plate_number) do update
    set
      plate_number = excluded.plate_number,
      is_blocked = false,
      block_reason = null,
      updated_at = now();

    insert into public.profile_vehicles (
      profile_id,
      vehicle_id,
      status
    )
    values (
      profile_id_value,
      consumer_vehicle_id_value,
      'ACTIVE'
    )
    on conflict (profile_id, vehicle_id) do update
    set
      status = 'ACTIVE',
      updated_at = now();
  end loop;

  insert into public.user_stations (user_id, station_id)
  select profile_id, station_id
  from (
    select
      p.id as profile_id,
      unnest(case
        when p.role in ('mayor', 'mayor_assistant') then station_ids
        when p.role in ('station_manager', 'cashier') and p.requested_station_id is not null
          then array[p.requested_station_id]
        when p.role = 'station_manager' and p.requested_station_id is null
          then station_ids
        else array[]::uuid[]
      end) as station_id
    from public.profiles p
    join auth.users u on u.id = p.auth_user_id
    where u.email in (
      'mayor@example.local',
      'cashier@example.local',
      'station-manager@example.local',
      'station-manager-2@example.local',
      'mayor-assistant@example.local',
      'cashier-2@example.local',
      'pending-cashier@example.local',
      'rejected-cashier@example.local'
    )
  ) station_rows
  on conflict (user_id, station_id) do nothing;

  select count(*)
  into generated_count
  from auth.users
  where email like 'local-consumer-%@example.local';

  select count(*)
  into documented_count
  from auth.users
  where email in (
    'mayor@example.local',
    'cashier@example.local',
    'station-manager@example.local',
    'station-manager-2@example.local',
    'mayor-assistant@example.local',
    'cashier-2@example.local',
    'pending-cashier@example.local',
    'rejected-cashier@example.local'
  );

  raise notice 'local-dev-users-ready: consumer_auth_users=%, documented_staff_auth_users=%',
    generated_count,
    documented_count;
end $$;
