set search_path = public, extensions;

alter table public.profiles
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists avatar_url text,
  add column if not exists auth_provider text;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('mayor', 'station_manager', 'cashier', 'mayor_assistant', 'consumer'));

create or replace function public.current_auth_aal()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(auth.jwt()->>'aal', '')
$$;

create or replace function public.has_aal2()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_auth_aal() = 'aal2', false)
$$;

create or replace function public.get_current_profile_role_unrestricted()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where auth_user_id = auth.uid()
    and is_active = true
    and approval_status = 'approved'
  limit 1
$$;

create or replace function public.has_privileged_profile_unrestricted()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.get_current_profile_role_unrestricted()
      in ('mayor', 'station_manager', 'cashier', 'mayor_assistant'),
    false
  )
$$;

create or replace function public.get_current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when role in ('mayor', 'station_manager', 'cashier', 'mayor_assistant')
      and not public.has_aal2()
      then null
    else role
  end
  from public.profiles
  where auth_user_id = auth.uid()
    and is_active = true
    and approval_status = 'approved'
  limit 1
$$;

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
  app_meta jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  provider_value text := nullif(
    trim(coalesce(app_meta->>'provider', meta->>'provider', '')),
    ''
  );
  is_yandex_oauth boolean := provider_value in ('custom:yandex', 'yandex')
    or coalesce(app_meta->'providers', '[]'::jsonb) ? 'custom:yandex'
    or coalesce(app_meta->'providers', '[]'::jsonb) ? 'yandex';
  email_value text := nullif(trim(coalesce(new.email, meta->>'email', meta->>'default_email', '')), '');
  requested_role_meta text := nullif(
    trim(coalesce(meta->>'requested_role', meta->>'role', '')),
    ''
  );
  first_name_value text := nullif(trim(coalesce(meta->>'first_name', meta->>'given_name', '')), '');
  last_name_value text := nullif(trim(coalesce(meta->>'last_name', meta->>'family_name', '')), '');
  middle_name_value text := nullif(trim(meta->>'middle_name'), '');
  full_name_value text;
  avatar_url_value text := nullif(trim(coalesce(meta->>'avatar_url', meta->>'picture', '')), '');
  requested_role_value text := case
    when is_yandex_oauth then 'consumer'
    when requested_role_meta = 'consumer' then 'consumer'
    when requested_role_meta in ('cashier', 'mayor_assistant') then requested_role_meta
    else 'cashier'
  end;
  requested_station_value uuid;
begin
  full_name_value := nullif(
    trim(coalesce(
      nullif(trim(concat_ws(' ', last_name_value, first_name_value, middle_name_value)), ''),
      meta->>'full_name',
      meta->>'display_name',
      meta->>'real_name',
      meta->>'name',
      ''
    )),
    ''
  );

  if requested_role_value = 'cashier'
    and nullif(meta->>'requested_station_id', '') is not null then
    requested_station_value := (meta->>'requested_station_id')::uuid;
  end if;

  insert into public.profiles (
    auth_user_id,
    email,
    phone,
    avatar_url,
    auth_provider,
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
    email_value,
    nullif(trim(meta->>'phone'), ''),
    avatar_url_value,
    provider_value,
    coalesce(full_name_value, email_value, 'Пользователь Яндекс ID'),
    first_name_value,
    last_name_value,
    middle_name_value,
    case when is_yandex_oauth then null else nullif(trim(meta->>'position'), '') end,
    case
      when is_yandex_oauth then null
      else coalesce(nullif(trim(meta->>'signature_name'), ''), full_name_value, email_value)
    end,
    case when is_yandex_oauth then null else requested_station_value end,
    requested_role_value,
    requested_role_value = 'consumer',
    case when requested_role_value = 'consumer' then 'approved' else 'pending' end
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

create or replace function public.complete_consumer_profile(
  p_first_name text,
  p_last_name text,
  p_middle_name text default null,
  p_phone text default null
)
returns public.profiles
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  current_profile_id uuid;
  saved_profile public.profiles%rowtype;
  normalized_first_name text := nullif(trim(p_first_name), '');
  normalized_last_name text := nullif(trim(p_last_name), '');
  normalized_middle_name text := nullif(trim(coalesce(p_middle_name, '')), '');
  normalized_phone text := nullif(trim(p_phone), '');
begin
  current_profile_id := public.get_current_profile_id();

  if current_profile_id is null or not public.has_role(array['consumer']) then
    raise exception 'FORBIDDEN';
  end if;

  if normalized_first_name is null then
    raise exception 'FIRST_NAME_REQUIRED';
  end if;

  if normalized_last_name is null then
    raise exception 'LAST_NAME_REQUIRED';
  end if;

  if normalized_phone is null then
    raise exception 'PHONE_REQUIRED';
  end if;

  update public.profiles
  set
    first_name = normalized_first_name,
    last_name = normalized_last_name,
    middle_name = normalized_middle_name,
    phone = normalized_phone,
    full_name = trim(concat_ws(' ', normalized_last_name, normalized_first_name, normalized_middle_name))
  where id = current_profile_id
    and role = 'consumer'
  returning * into saved_profile;

  if saved_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return saved_profile;
end;
$$;

drop policy if exists require_staff_aal2_profiles on public.profiles;
create policy require_staff_aal2_profiles
on public.profiles
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

drop policy if exists require_staff_aal2_user_stations on public.user_stations;
create policy require_staff_aal2_user_stations
on public.user_stations
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

drop policy if exists require_staff_aal2_stations on public.stations;
create policy require_staff_aal2_stations
on public.stations
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

drop policy if exists require_staff_aal2_vehicles on public.vehicles;
create policy require_staff_aal2_vehicles
on public.vehicles
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

drop policy if exists require_staff_aal2_drivers on public.drivers;
create policy require_staff_aal2_drivers
on public.drivers
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

drop policy if exists require_staff_aal2_fuel_reservations on public.fuel_reservations;
create policy require_staff_aal2_fuel_reservations
on public.fuel_reservations
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

drop policy if exists require_staff_aal2_queue_entries on public.queue_entries;
create policy require_staff_aal2_queue_entries
on public.queue_entries
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

drop policy if exists require_staff_aal2_fueling_records on public.fueling_records;
create policy require_staff_aal2_fueling_records
on public.fueling_records
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

drop policy if exists require_staff_aal2_manual_overrides on public.manual_overrides;
create policy require_staff_aal2_manual_overrides
on public.manual_overrides
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

drop policy if exists require_staff_aal2_audit_logs on public.audit_logs;
create policy require_staff_aal2_audit_logs
on public.audit_logs
as restrictive
for all
to authenticated
using (not public.has_privileged_profile_unrestricted() or public.has_aal2())
with check (not public.has_privileged_profile_unrestricted() or public.has_aal2());

do $$
declare
  table_name text;
  protected_tables text[] := array[
    'profiles',
    'user_stations',
    'stations',
    'vehicles',
    'drivers',
    'daily_limits',
    'daily_fuel_type_limits',
    'fuel_reservations',
    'queue_entries',
    'fueling_records',
    'refusal_records',
    'manual_overrides',
    'audit_logs',
    'personal_vehicle_liter_limits',
    'preferential_queues',
    'preferential_queue_entries',
    'reservation_call_logs',
    'app_settings',
    'profile_vehicles',
    'daily_fueling_schedules'
  ];
begin
  foreach table_name in array protected_tables loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists %I on public.%I', 'require_staff_aal2_' || table_name, table_name);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using (not public.has_privileged_profile_unrestricted() or public.has_aal2()) with check (not public.has_privileged_profile_unrestricted() or public.has_aal2())',
        'require_staff_aal2_' || table_name,
        table_name
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.current_auth_aal() to authenticated;
grant execute on function public.has_aal2() to authenticated;
grant execute on function public.get_current_profile_role_unrestricted() to authenticated;
grant execute on function public.has_privileged_profile_unrestricted() to authenticated;
grant execute on function public.get_current_user_role() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.can_access_station(uuid) to authenticated;
grant execute on function public.handle_new_auth_user() to service_role;
grant execute on function public.complete_consumer_profile(text, text, text, text) to authenticated;
