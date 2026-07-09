set check_function_bodies = off;
set search_path = public;

drop function if exists public.update_reservation_fuel_preference(uuid, text, text, text, uuid);

grant execute on function public.update_reservation_fuel_preference(uuid, text, text, uuid) to authenticated;
