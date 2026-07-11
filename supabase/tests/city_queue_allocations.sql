begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select has_table('public', 'fuel_queue_entries', 'persistent queue entries exist');
select has_table('public', 'daily_queue_allocations', 'daily allocations exist');
select has_table('public', 'daily_queue_allocation_call_logs', 'allocation call history exists');
select has_column('public', 'fuel_queue_entries', 'permanent_number', 'permanent number is stored');
select has_column('public', 'daily_queue_allocations', 'arrival_at', 'ETA is stored');
select has_column('public', 'daily_queue_allocations', 'station_fuel_position', 'schedule position is stored');
select has_column('public', 'daily_fueling_schedules', 'station_id', 'schedule is station-specific');
select function_privs_are(
  'public', 'allocate_daily_queue', array['date'], 'authenticated', array[]::text[],
  'allocator is not callable by authenticated clients'
);
select function_privs_are(
  'public', 'finalize_daily_queue', array['date'], 'authenticated', array[]::text[],
  'finalizer is service-role-only'
);
select is(
  public.get_compatible_fuel_types('AI_95', 'EXACT'),
  array['AI_95']::text[],
  'EXACT never substitutes fuel'
);
select is(
  public.get_compatible_fuel_types('AI_95', 'ANY_GASOLINE'),
  array['AI_95', 'AI_92', 'AI_100']::text[],
  'ANY_GASOLINE preserves the preferred brand first'
);
select col_is_unique('public', 'daily_queue_allocations', array['allocation_date', 'queue_entry_id'], 'one allocation per entry and date');

select * from finish();
rollback;
