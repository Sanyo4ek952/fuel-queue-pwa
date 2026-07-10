set search_path = public, extensions;

grant usage on schema public to anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.stations to authenticated;
grant select on public.user_stations to authenticated;
