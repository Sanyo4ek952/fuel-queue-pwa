set search_path = public, extensions;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  requested_role_meta text := nullif(
    trim(coalesce(meta->>'requested_role', meta->>'role', '')),
    ''
  );
  first_name_value text := nullif(trim(meta->>'first_name'), '');
  last_name_value text := nullif(trim(meta->>'last_name'), '');
  middle_name_value text := nullif(trim(meta->>'middle_name'), '');
  full_name_value text;
  requested_role_value text := case
    when requested_role_meta = 'consumer' then 'consumer'
    when requested_role_meta in ('cashier', 'mayor_assistant') then requested_role_meta
    else 'cashier'
  end;
  requested_station_value uuid;
begin
  full_name_value := nullif(
    trim(concat_ws(' ', last_name_value, first_name_value, middle_name_value)),
    ''
  );

  if requested_role_value = 'cashier'
    and nullif(meta->>'requested_station_id', '') is not null then
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
    requested_role_value,
    requested_role_value = 'consumer',
    case when requested_role_value = 'consumer' then 'approved' else 'pending' end
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

update public.profiles profile
set
  role = 'consumer',
  is_active = true,
  approval_status = 'approved',
  requested_station_id = null,
  approved_by = null,
  approved_at = coalesce(profile.approved_at, now()),
  rejected_by = null,
  rejected_at = null,
  rejection_reason = null,
  deactivated_by = null,
  deactivated_at = null,
  deactivation_reason = null
from auth.users auth_user
where profile.auth_user_id = auth_user.id
  and nullif(
    trim(coalesce(auth_user.raw_user_meta_data->>'requested_role', auth_user.raw_user_meta_data->>'role', '')),
    ''
  ) = 'consumer'
  and (
    profile.role <> 'consumer'
    or profile.is_active is not true
    or profile.approval_status <> 'approved'
  );

grant execute on function public.handle_new_auth_user() to service_role;
