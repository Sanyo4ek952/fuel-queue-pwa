insert into public.stations (id, name, address, is_active, allocation_order)
values
  ('10000000-0000-0000-0000-000000000001', 'АТАН АЗС №076 (нижняя)', 'Восточное шоссе, 2', true, 1),
  ('10000000-0000-0000-0000-000000000002', 'АТАН АЗС №077 (верхняя)', 'Феодосийское шоссе, 14', true, 2),
  ('10000000-0000-0000-0000-000000000003', 'ТЭС АЗС №37', 'Феодосийское шоссе, 12А', true, 3)
on conflict (id) do update
set
  name = excluded.name,
  address = excluded.address,
  is_active = excluded.is_active,
  allocation_order = excluded.allocation_order,
  updated_at = now();
