-- Hosted Supabase test data for Fuel Queue PWA.
-- Run this in Supabase SQL Editor after all migrations are applied.
-- The script is non-destructive for non-seed data: it aborts if current/tomorrow
-- business rows already exist for the test stations outside the fixed seed IDs.

set search_path = public, extensions;

-- Keep hosted test databases compatible with the current app role model even
-- when the latest role migration has not been applied there yet.
alter table public.profiles
  drop constraint if exists profiles_role_check;

update public.profiles
set role = case role
  when 'city_admin' then 'mayor'
  when 'station_admin' then 'station_manager'
  when 'shift_supervisor' then 'station_manager'
  when 'operator' then 'mayor_assistant'
  when 'viewer' then 'cashier'
  else role
end
where role in ('city_admin', 'station_admin', 'shift_supervisor', 'operator', 'viewer');

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('mayor', 'station_manager', 'cashier', 'mayor_assistant'));

create or replace function public.has_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_user_role_row as (
    select public.get_current_user_role() as role
  )
  select coalesce(
    role = 'mayor'
      or role = any(required_roles)
      or (
        role = 'station_manager'
        and required_roles && array[
          'station_manager',
          'station_admin',
          'shift_supervisor',
          'operator',
          'cashier'
        ]
      )
      or (
        role = 'cashier'
        and required_roles && array['cashier']
      )
      or (
        role = 'mayor_assistant'
        and required_roles && array['mayor_assistant', 'operator']
      ),
    false
  )
  from current_user_role_row
$$;

create or replace function public.can_access_station(target_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.get_current_user_role() in ('mayor', 'mayor_assistant'), false)
    or exists (
      select 1
      from public.user_stations us
      where us.user_id = public.get_current_profile_id()
        and us.station_id = target_station_id
    )
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  first_name_value text := nullif(trim(meta->>'first_name'), '');
  last_name_value text := nullif(trim(meta->>'last_name'), '');
  middle_name_value text := nullif(trim(meta->>'middle_name'), '');
  full_name_value text;
  requested_station_value uuid;
begin
  full_name_value := nullif(
    trim(concat_ws(' ', last_name_value, first_name_value, middle_name_value)),
    ''
  );

  if nullif(meta->>'requested_station_id', '') is not null then
    requested_station_value := (meta->>'requested_station_id')::uuid;
  end if;

  insert into public.profiles (
    auth_user_id,
    full_name,
    first_name,
    last_name,
    middle_name,
    position,
    signature_name,
    requested_station_id,
    role,
    is_active,
    approval_status
  )
  values (
    new.id,
    coalesce(full_name_value, new.email, 'Pending user'),
    first_name_value,
    last_name_value,
    middle_name_value,
    nullif(trim(meta->>'position'), ''),
    coalesce(nullif(trim(meta->>'signature_name'), ''), full_name_value, new.email),
    requested_station_value,
    'cashier',
    false,
    'pending'
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

create or replace function public.ensure_can_manage_profile(target_profile_id uuid)
returns public.profiles
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_profile_id uuid;
  actor_role text;
  target_profile public.profiles%rowtype;
begin
  actor_profile_id := public.get_current_profile_id();
  actor_role := public.get_current_user_role();

  if actor_profile_id is null or actor_role not in ('station_manager', 'mayor') then
    raise exception 'FORBIDDEN';
  end if;

  select *
  into target_profile
  from public.profiles
  where id = target_profile_id;

  if target_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if target_profile.id = actor_profile_id then
    raise exception 'CANNOT_MANAGE_SELF';
  end if;

  if actor_role = 'mayor' then
    return target_profile;
  end if;

  if target_profile.role in ('mayor', 'mayor_assistant', 'station_manager') then
    raise exception 'PROFILE_ACCESS_DENIED';
  end if;

  if target_profile.requested_station_id is not null
    and public.can_access_station(target_profile.requested_station_id) then
    return target_profile;
  end if;

  if exists (
    select 1
    from public.user_stations us
    where us.user_id = target_profile.id
      and public.can_access_station(us.station_id)
  ) then
    return target_profile;
  end if;

  raise exception 'PROFILE_ACCESS_DENIED';
end;
$$;

create or replace function public.list_managed_profiles()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select public.get_current_profile_id() as profile_id, public.get_current_user_role() as role
  ),
  visible_profiles as (
    select p.*
    from public.profiles p
    cross join actor a
    where a.profile_id is not null
      and a.role in ('station_manager', 'mayor')
      and p.id <> a.profile_id
      and (
        a.role = 'mayor'
        or (
          p.role = 'cashier'
          and (
            (
              p.requested_station_id is not null
              and public.can_access_station(p.requested_station_id)
            )
            or exists (
              select 1
              from public.user_stations us
              where us.user_id = p.id
                and public.can_access_station(us.station_id)
            )
          )
        )
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'auth_user_id', p.auth_user_id,
        'full_name', p.full_name,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'middle_name', p.middle_name,
        'position', p.position,
        'signature_name', p.signature_name,
        'role', p.role,
        'is_active', p.is_active,
        'approval_status', p.approval_status,
        'requested_station_id', p.requested_station_id,
        'requested_station_name', rs.name,
        'approved_by', p.approved_by,
        'approved_by_name', approver.full_name,
        'approved_at', p.approved_at,
        'rejected_by', p.rejected_by,
        'rejected_by_name', rejector.full_name,
        'rejected_at', p.rejected_at,
        'rejection_reason', p.rejection_reason,
        'deactivated_by', p.deactivated_by,
        'deactivated_by_name', deactivator.full_name,
        'deactivated_at', p.deactivated_at,
        'deactivation_reason', p.deactivation_reason,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'stations', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'name', s.name,
              'address', s.address
            )
            order by s.name
          )
          from public.user_stations us
          join public.stations s on s.id = us.station_id
          where us.user_id = p.id
        ), '[]'::jsonb)
      )
      order by
        case p.approval_status when 'pending' then 0 when 'approved' then 1 else 2 end,
        p.created_at desc
    ),
    '[]'::jsonb
  )
  from visible_profiles p
  left join public.stations rs on rs.id = p.requested_station_id
  left join public.profiles approver on approver.id = p.approved_by
  left join public.profiles rejector on rejector.id = p.rejected_by
  left join public.profiles deactivator on deactivator.id = p.deactivated_by;
$$;

create or replace function public.approve_registration(
  target_profile_id uuid,
  target_role text,
  target_station_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_profile_id uuid;
  actor_role text;
  old_profile public.profiles%rowtype;
  saved_profile public.profiles%rowtype;
  assigned_station_id uuid;
begin
  actor_profile_id := public.get_current_profile_id();
  actor_role := public.get_current_user_role();
  select *
  into old_profile
  from public.ensure_can_manage_profile(target_profile_id);

  if old_profile.approval_status <> 'pending' then
    raise exception 'PROFILE_NOT_PENDING';
  end if;

  if target_role not in ('mayor', 'station_manager', 'cashier', 'mayor_assistant') then
    raise exception 'INVALID_ROLE';
  end if;

  if actor_role = 'station_manager' and target_role <> 'cashier' then
    raise exception 'ROLE_ASSIGNMENT_DENIED';
  end if;

  if target_station_ids is null or cardinality(target_station_ids) = 0 then
    raise exception 'STATIONS_REQUIRED';
  end if;

  foreach assigned_station_id in array target_station_ids loop
    if actor_role <> 'mayor' and not public.can_access_station(assigned_station_id) then
      raise exception 'STATION_ACCESS_DENIED';
    end if;
  end loop;

  update public.profiles
  set role = target_role,
      is_active = true,
      approval_status = 'approved',
      approved_by = actor_profile_id,
      approved_at = now(),
      rejected_by = null,
      rejected_at = null,
      rejection_reason = null,
      deactivated_by = null,
      deactivated_at = null,
      deactivation_reason = null
  where id = target_profile_id
  returning * into saved_profile;

  delete from public.user_stations
  where user_id = target_profile_id;

  foreach assigned_station_id in array target_station_ids loop
    insert into public.user_stations (user_id, station_id)
    values (target_profile_id, assigned_station_id)
    on conflict (user_id, station_id) do nothing;
  end loop;

  perform public.audit_action(
    'APPROVE_REGISTRATION',
    'profile',
    saved_profile.id,
    to_jsonb(old_profile),
    to_jsonb(saved_profile)
  );

  return jsonb_build_object(
    'id', saved_profile.id,
    'approval_status', saved_profile.approval_status,
    'role', saved_profile.role,
    'is_active', saved_profile.is_active,
    'approved_by', saved_profile.approved_by,
    'approved_at', saved_profile.approved_at
  );
end;
$$;

grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.can_access_station(uuid) to authenticated;
grant execute on function public.handle_new_auth_user() to service_role;
grant execute on function public.ensure_can_manage_profile(uuid) to authenticated;
grant execute on function public.list_managed_profiles() to authenticated;
grant execute on function public.approve_registration(uuid, text, uuid[]) to authenticated;

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
  ('40000000-0000-0000-0000-000000000001', 'A111AA777', 'A111AA777', false, null),
  ('40000000-0000-0000-0000-000000000002', 'A222AA777', 'A222AA777', false, null),
  ('40000000-0000-0000-0000-000000000003', 'A333AA777', 'A333AA777', false, null),
  ('40000000-0000-0000-0000-000000000004', 'A444AA777', 'A444AA777', true, 'Seed blocked vehicle'),
  ('40000000-0000-0000-0000-000000000005', 'A555AA777', 'A555AA777', false, null),
  ('40000000-0000-0000-0000-000000000006', 'A666AA777', 'A666AA777', false, null),
  ('40000000-0000-0000-0000-000000000007', 'A777AA777', 'A777AA777', false, null),
  ('40000000-0000-0000-0000-000000000008', 'B111BB777', 'B111BB777', false, null),
  ('40000000-0000-0000-0000-000000000009', 'B222BB777', 'B222BB777', false, null)
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
