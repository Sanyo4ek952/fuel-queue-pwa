set search_path = public, extensions;

create or replace function public.get_vehicle_recent_fueling_history(plate_number text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.get_vehicle_fueling_history(plate_number, 3, 0);
$$;

grant execute on function public.get_vehicle_recent_fueling_history(text) to authenticated;
