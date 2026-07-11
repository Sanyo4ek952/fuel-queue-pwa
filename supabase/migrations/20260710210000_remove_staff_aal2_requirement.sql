set search_path = public, extensions;

create or replace function public.get_current_user_role()
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
      execute format(
        'drop policy if exists %I on public.%I',
        'require_staff_aal2_' || table_name,
        table_name
      );
    end if;
  end loop;
end;
$$;

grant execute on function public.get_current_user_role() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;
grant execute on function public.can_access_station(uuid) to authenticated;
