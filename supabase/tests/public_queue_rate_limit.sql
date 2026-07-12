begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_table('public', 'public_queue_check_rate_limits', 'public queue check rate limit table exists');
select has_function(
  'public',
  'check_public_queue_position',
  array['text', 'text', 'text'],
  'rate-limited public queue check RPC requires a server-provided IP hash'
);
select function_privs_are(
  'public',
  'check_public_queue_position',
  array['text', 'text'],
  'anon',
  array[]::text[],
  'legacy public queue check RPC is not directly callable by anon'
);
select ok(
  pg_get_functiondef('public.apply_public_queue_rate_limit(text,text,integer,interval,interval)'::regprocedure)
    like '%pg_advisory_xact_lock%',
  'rate limit helper serializes concurrent checks with an advisory transaction lock'
);

delete from public.public_queue_check_rate_limits
where scope_key like 'pgtap-rate-limit-%'
   or scope_key in ('A999AA777', 'A777AA777');

with responses as (
  select public.check_public_queue_position('', '', 'pgtap-rate-limit-ip-' || (attempt_number - attempt_number)) as response
  from generate_series(1, 10) as attempt_number
)
select is(
  count(*) filter (where response ->> 'status' = 'LIMIT_EXCEEDED')::integer,
  0,
  'first 10 requests from one IP hash are allowed'
)
from responses;

select is(
  public.check_public_queue_position('', '', 'pgtap-rate-limit-ip-0') ->> 'error_code',
  'PUBLIC_QUEUE_IP_RATE_LIMITED',
  '11th request from one IP hash is blocked for 30 minutes'
);

update public.public_queue_check_rate_limits
set window_started_at = now() - interval '16 minutes',
    blocked_until = now() - interval '1 second',
    attempt_count = 10
where scope = 'IP_REQUEST'
  and scope_key = 'pgtap-rate-limit-ip-0';

select is(
  public.check_public_queue_position('', '', 'pgtap-rate-limit-ip-0') ->> 'status',
  'INVALID_INPUT',
  'expired IP window resets and allows a new request'
);

delete from public.public_queue_check_rate_limits
where scope_key like 'pgtap-rate-limit-failure-ip-%'
   or scope_key = 'A999AA777';

with responses as (
  select public.check_public_queue_position('A999AA777', '9999', 'pgtap-rate-limit-failure-ip-' || attempt_number) as response
  from generate_series(1, 10) as attempt_number
)
select is(
  count(*) filter (where response ->> 'status' = 'NOT_FOUND')::integer,
  10,
  'ten failed checks for one normalized plate are allowed across different IP hashes'
)
from responses;

select is(
  public.check_public_queue_position('A999AA777', '9999', 'pgtap-rate-limit-failure-ip-11') ->> 'error_code',
  'PUBLIC_QUEUE_PLATE_FAILURE_RATE_LIMITED',
  '11th failed check for one normalized plate is blocked even from another IP hash'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '71000000-1000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'public-rate-limit-mayor@example.local',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
)
on conflict (id) do update
set email = excluded.email,
    updated_at = excluded.updated_at;

update public.profiles
set id = '72000000-1000-4000-8000-000000000001',
    full_name = 'Public Rate Limit Mayor',
    role = 'mayor',
    is_active = true,
    approval_status = 'approved'
where auth_user_id = '71000000-1000-4000-8000-000000000001';

insert into public.profiles (id, auth_user_id, full_name, role, is_active, approval_status)
select
  '72000000-1000-4000-8000-000000000001',
  '71000000-1000-4000-8000-000000000001',
  'Public Rate Limit Mayor',
  'mayor',
  true,
  'approved'
where not exists (
  select 1
  from public.profiles
  where auth_user_id = '71000000-1000-4000-8000-000000000001'
);

insert into public.vehicles (id, plate_number, normalized_plate_number)
values (
  '73000000-1000-4000-8000-000000000001',
  'A777AA777',
  'A777AA777'
)
on conflict (id) do update
set plate_number = excluded.plate_number,
    normalized_plate_number = excluded.normalized_plate_number;

insert into public.drivers (id, full_name, phone)
values (
  '74000000-1000-4000-8000-000000000001',
  'Public Rate Limit Driver',
  '+70000001234'
)
on conflict (id) do update
set full_name = excluded.full_name,
    phone = excluded.phone;

insert into public.fuel_queue_entries (
  id,
  permanent_number,
  vehicle_id,
  driver_id,
  preferred_fuel_type,
  fuel_preference_mode,
  requested_liters,
  status,
  operator_id,
  client_mutation_id,
  sync_status
)
values (
  '75000000-1000-4000-8000-000000000001',
  970001,
  '73000000-1000-4000-8000-000000000001',
  '74000000-1000-4000-8000-000000000001',
  'AI_95',
  'EXACT',
  20,
  'WAITING',
  '72000000-1000-4000-8000-000000000001',
  '76000000-1000-4000-8000-000000000001',
  'SYNCED'
)
on conflict (id) do update
set permanent_number = excluded.permanent_number,
    vehicle_id = excluded.vehicle_id,
    driver_id = excluded.driver_id,
    status = excluded.status;

delete from public.public_queue_check_rate_limits
where scope_key like 'pgtap-rate-limit-success-ip-%'
   or scope_key = 'A777AA777';

with responses as (
  select public.check_public_queue_position('A777AA777', '1234', 'pgtap-rate-limit-success-ip-' || attempt_number) as response
  from generate_series(1, 30) as attempt_number
)
select is(
  count(*) filter (where response ->> 'status' = 'FOUND')::integer,
  30,
  'thirty successful checks for one vehicle are allowed across different IP hashes'
)
from responses;

select is(
  public.check_public_queue_position('A777AA777', '1234', 'pgtap-rate-limit-success-ip-31') ->> 'error_code',
  'PUBLIC_QUEUE_PLATE_SUCCESS_RATE_LIMITED',
  '31st successful check for one vehicle is blocked'
);

select * from finish();
rollback;
