set search_path = public, extensions;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists middle_name text,
  add column if not exists position text,
  add column if not exists signature_name text,
  add column if not exists requested_station_id uuid references public.stations(id),
  add column if not exists approval_status text not null default 'approved',
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles(id),
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists deactivated_by uuid references public.profiles(id),
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivation_reason text;

alter table public.profiles
  drop constraint if exists profiles_approval_status_check;

alter table public.profiles
  add constraint profiles_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));

update public.profiles
set
  approval_status = coalesce(approval_status, 'approved'),
  approved_at = coalesce(approved_at, created_at),
  first_name = coalesce(first_name, split_part(full_name, ' ', 1)),
  signature_name = coalesce(signature_name, full_name)
where approval_status = 'approved';

create index if not exists idx_profiles_approval_status on public.profiles (approval_status);
create index if not exists idx_profiles_requested_station on public.profiles (requested_station_id);

create or replace function public.get_current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.profiles
  where auth_user_id = auth.uid()
    and is_active = true
    and approval_status = 'approved'
  limit 1
$$;

drop policy if exists profiles_select_self_or_admin on public.profiles;

create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (
  auth_user_id = auth.uid()
  or public.has_role(array['city_admin'])
  or (
    public.has_role(array['station_admin'])
    and (
      (
        requested_station_id is not null
        and public.can_access_station(requested_station_id)
      )
      or exists (
        select 1
        from public.user_stations us
        where us.user_id = profiles.id
          and public.can_access_station(us.station_id)
      )
    )
  )
);

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
    'viewer',
    false,
    'pending'
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

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

  if actor_profile_id is null or actor_role not in ('station_admin', 'city_admin') then
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

  if actor_role = 'city_admin' then
    return target_profile;
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
      and a.role in ('station_admin', 'city_admin')
      and p.id <> a.profile_id
      and (
        a.role = 'city_admin'
        or (
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

  if target_role not in ('operator', 'cashier', 'shift_supervisor', 'station_admin', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;

  if actor_role = 'station_admin' and target_role in ('station_admin', 'city_admin') then
    raise exception 'ROLE_ASSIGNMENT_DENIED';
  end if;

  if target_station_ids is null or cardinality(target_station_ids) = 0 then
    raise exception 'STATIONS_REQUIRED';
  end if;

  foreach assigned_station_id in array target_station_ids loop
    if not public.can_access_station(assigned_station_id) then
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

create or replace function public.reject_registration(
  target_profile_id uuid,
  reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_profile_id uuid;
  old_profile public.profiles%rowtype;
  saved_profile public.profiles%rowtype;
begin
  actor_profile_id := public.get_current_profile_id();
  select *
  into old_profile
  from public.ensure_can_manage_profile(target_profile_id);

  if old_profile.approval_status <> 'pending' then
    raise exception 'PROFILE_NOT_PENDING';
  end if;

  if coalesce(trim(reason), '') = '' then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;

  update public.profiles
  set is_active = false,
      approval_status = 'rejected',
      rejected_by = actor_profile_id,
      rejected_at = now(),
      rejection_reason = trim(reason)
  where id = target_profile_id
  returning * into saved_profile;

  perform public.audit_action(
    'REJECT_REGISTRATION',
    'profile',
    saved_profile.id,
    to_jsonb(old_profile),
    to_jsonb(saved_profile)
  );

  return jsonb_build_object(
    'id', saved_profile.id,
    'approval_status', saved_profile.approval_status,
    'is_active', saved_profile.is_active,
    'rejected_by', saved_profile.rejected_by,
    'rejected_at', saved_profile.rejected_at,
    'rejection_reason', saved_profile.rejection_reason
  );
end;
$$;

create or replace function public.deactivate_profile(
  target_profile_id uuid,
  reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor_profile_id uuid;
  old_profile public.profiles%rowtype;
  saved_profile public.profiles%rowtype;
begin
  actor_profile_id := public.get_current_profile_id();
  select *
  into old_profile
  from public.ensure_can_manage_profile(target_profile_id);

  if old_profile.approval_status <> 'approved' then
    raise exception 'PROFILE_NOT_APPROVED';
  end if;

  if coalesce(trim(reason), '') = '' then
    raise exception 'DEACTIVATION_REASON_REQUIRED';
  end if;

  update public.profiles
  set is_active = false,
      deactivated_by = actor_profile_id,
      deactivated_at = now(),
      deactivation_reason = trim(reason)
  where id = target_profile_id
  returning * into saved_profile;

  perform public.audit_action(
    'DEACTIVATE_PROFILE',
    'profile',
    saved_profile.id,
    to_jsonb(old_profile),
    to_jsonb(saved_profile)
  );

  return jsonb_build_object(
    'id', saved_profile.id,
    'approval_status', saved_profile.approval_status,
    'is_active', saved_profile.is_active,
    'deactivated_by', saved_profile.deactivated_by,
    'deactivated_at', saved_profile.deactivated_at,
    'deactivation_reason', saved_profile.deactivation_reason
  );
end;
$$;

revoke execute on function public.handle_new_auth_user() from public;
revoke execute on function public.ensure_can_manage_profile(uuid) from public;
revoke execute on function public.list_managed_profiles() from public;
revoke execute on function public.approve_registration(uuid, text, uuid[]) from public;
revoke execute on function public.reject_registration(uuid, text) from public;
revoke execute on function public.deactivate_profile(uuid, text) from public;

grant execute on function public.handle_new_auth_user() to service_role;
grant execute on function public.ensure_can_manage_profile(uuid) to authenticated;
grant execute on function public.list_managed_profiles() to authenticated;
grant execute on function public.approve_registration(uuid, text, uuid[]) to authenticated;
grant execute on function public.reject_registration(uuid, text) to authenticated;
grant execute on function public.deactivate_profile(uuid, text) to authenticated;
