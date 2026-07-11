begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

select has_table('public', 'fuel_queue_entries', 'persistent queue entries exist');
select has_table('public', 'daily_queue_allocations', 'daily allocations exist');
select has_table('public', 'daily_queue_allocation_call_logs', 'allocation call history exists');
select hasnt_table('public', 'fuel_reservations', 'legacy dated reservations table is absent');
select hasnt_table('public', 'queue_entries', 'legacy queue_entries table is absent');
select hasnt_table('public', 'reservation_call_logs', 'legacy reservation call logs table is absent');
select has_column('public', 'fuel_queue_entries', 'permanent_number', 'permanent number is stored');
select hasnt_column('public', 'fuel_queue_entries', 'date', 'persistent entry has no date');
select hasnt_column('public', 'fuel_queue_entries', 'station_id', 'persistent entry has no station');
select has_column('public', 'daily_queue_allocations', 'arrival_at', 'ETA is stored');
select has_column('public', 'daily_queue_allocations', 'allocation_date', 'allocation stores date');
select has_column('public', 'daily_queue_allocations', 'station_id', 'allocation stores station');
select has_column('public', 'daily_queue_allocations', 'assigned_fuel_type', 'allocation stores matched fuel');
select has_column('public', 'daily_queue_allocations', 'station_fuel_position', 'schedule position is stored');
select has_column('public', 'daily_fueling_schedules', 'station_id', 'schedule is station-specific');
select has_function(
  'public', 'create_reservation',
  array['text', 'text', 'text', 'text', 'numeric', 'text', 'text', 'uuid'],
  'create_reservation uses permanent queue arguments'
);
select hasnt_function(
  'public', 'create_reservation',
  array['date', 'uuid', 'text', 'text', 'text', 'text', 'numeric', 'text', 'uuid'],
  'legacy create_reservation(date, station) is absent'
);
select has_function(
  'public', 'create_consumer_reservation',
  array['uuid', 'text', 'text', 'text', 'numeric', 'text', 'text', 'uuid'],
  'consumer reservation creates a permanent queue entry'
);
select has_function(
  'public', 'create_fueling_record_for_allocation',
  array['uuid', 'numeric', 'timestamp with time zone', 'text', 'uuid'],
  'fueling uses a saved allocation'
);
select hasnt_function(
  'public', 'create_fueling_record',
  array['uuid', 'text', 'numeric', 'text', 'date', 'timestamp with time zone', 'text', 'uuid'],
  'legacy fueling without allocation is absent'
);
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
