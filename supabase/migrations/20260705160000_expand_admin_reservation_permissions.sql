set search_path = public, extensions;

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
    role = 'city_admin'
      or role = any(required_roles)
      or (role = 'cashier' and 'operator' = any(required_roles)),
    false
  )
  from current_user_role_row
$$;

grant execute on function public.has_role(text[]) to authenticated;
