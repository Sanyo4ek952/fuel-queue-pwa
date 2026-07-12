begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_table('public', 'personal_data_consents', 'personal data consent journal exists');
select has_column('public', 'profiles', 'personal_data_consent_version', 'profiles keep latest consent version');

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
  '91000000-1000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'consent-staff@example.local',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{
    "first_name":"Consent",
    "last_name":"Staff",
    "requested_role":"mayor_assistant",
    "position":"Operator",
    "signature_name":"Consent S.",
    "personal_data_consent_accepted":true,
    "personal_data_consent_version":"2026-07-12",
    "personal_data_consent_document_hash":"personal-data-consent-2026-07-12-city-queue-v1",
    "personal_data_consent_accepted_at":"2026-07-12T00:00:00Z",
    "personal_data_consent_source":"email_password",
    "personal_data_consent_registration_role":"mayor_assistant",
    "personal_data_consent_user_agent":"pgtap"
  }'::jsonb,
  now(),
  now()
);

select is(
  (
    select personal_data_consent_version
    from public.profiles
    where auth_user_id = '91000000-1000-4000-8000-000000000001'
  ),
  '2026-07-12',
  'email signup trigger stores latest consent version on profile'
);

select is(
  (
    select count(*)::integer
    from public.personal_data_consents
    where auth_user_id = '91000000-1000-4000-8000-000000000001'
      and source = 'email_password'
  ),
  1,
  'email signup trigger creates consent journal row'
);

select throws_ok(
  $$
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
      '91000000-1000-4000-8000-000000000002',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'consent-missing@example.local',
      extensions.crypt('password123', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"first_name":"Missing","last_name":"Consent","requested_role":"consumer"}'::jsonb,
      now(),
      now()
    )
  $$,
  'PERSONAL_DATA_CONSENT_REQUIRED',
  'email signup with registration metadata is rejected without consent'
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
  '91000000-1000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'consent-yandex@example.local',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"custom:yandex","providers":["custom:yandex"]}'::jsonb,
  '{"given_name":"Yandex","family_name":"Resident"}'::jsonb,
  now(),
  now()
);

select set_config('request.jwt.claim.sub', '91000000-1000-4000-8000-000000000003', true);

select lives_ok(
  $$
    select public.record_personal_data_consent(
      '2026-07-12',
      'personal-data-consent-2026-07-12-city-queue-v1',
      '2026-07-12T00:01:00Z'::timestamp with time zone,
      'yandex_oauth',
      'consumer',
      'pgtap'
    )
  $$,
  'Yandex callback RPC records consent for current user'
);

select is(
  (
    select count(*)::integer
    from public.personal_data_consents
    where auth_user_id = '91000000-1000-4000-8000-000000000003'
      and source = 'yandex_oauth'
  ),
  1,
  'Yandex RPC creates consent journal row'
);

set local role authenticated;

select is(
  (select count(*)::integer from public.personal_data_consents),
  1,
  'RLS exposes only the current user consent row to a consumer'
);

reset role;
select * from finish();
rollback;

