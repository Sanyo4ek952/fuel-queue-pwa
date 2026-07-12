alter table public.profiles
  add column if not exists personal_data_consent_version text,
  add column if not exists personal_data_consented_at timestamp with time zone;

create table if not exists public.personal_data_consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  auth_user_id uuid not null,
  document_version text not null,
  document_hash text not null,
  accepted_at timestamp with time zone not null,
  source text not null,
  registration_role text not null,
  user_agent text,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint personal_data_consents_source_check
    check (source = any (array['email_password'::text, 'yandex_oauth'::text])),
  constraint personal_data_consents_registration_role_check
    check (registration_role = any (array['cashier'::text, 'mayor_assistant'::text, 'consumer'::text]))
);

create unique index if not exists idx_personal_data_consents_active_version
  on public.personal_data_consents (auth_user_id, document_version)
  where revoked_at is null;

create index if not exists idx_personal_data_consents_profile_id
  on public.personal_data_consents (profile_id);

alter table public.personal_data_consents enable row level security;

drop policy if exists personal_data_consents_select_self_or_admin
  on public.personal_data_consents;
create policy personal_data_consents_select_self_or_admin
  on public.personal_data_consents
  for select
  to authenticated
  using (
    auth_user_id = auth.uid()
    or public.has_role(array['mayor', 'mayor_assistant'])
  );

drop policy if exists personal_data_consents_no_direct_insert
  on public.personal_data_consents;
create policy personal_data_consents_no_direct_insert
  on public.personal_data_consents
  for insert
  to authenticated
  with check (false);

create or replace function public.record_personal_data_consent(
  p_document_version text,
  p_document_hash text,
  p_accepted_at timestamp with time zone,
  p_source text,
  p_registration_role text,
  p_user_agent text default null
) returns public.personal_data_consents
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  current_profile public.profiles%rowtype;
  saved_consent public.personal_data_consents%rowtype;
begin
  select *
    into current_profile
  from public.profiles
  where auth_user_id = auth.uid()
  limit 1;

  if current_profile.id is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if coalesce(p_document_version, '') = '' then
    raise exception 'PERSONAL_DATA_CONSENT_VERSION_REQUIRED';
  end if;

  if coalesce(p_document_hash, '') = '' then
    raise exception 'PERSONAL_DATA_CONSENT_HASH_REQUIRED';
  end if;

  if coalesce(p_source, '') <> 'yandex_oauth' then
    raise exception 'INVALID_PERSONAL_DATA_CONSENT_SOURCE';
  end if;

  if coalesce(p_registration_role, '') <> current_profile.role then
    raise exception 'INVALID_PERSONAL_DATA_CONSENT_ROLE';
  end if;

  insert into public.personal_data_consents (
    profile_id,
    auth_user_id,
    document_version,
    document_hash,
    accepted_at,
    source,
    registration_role,
    user_agent
  )
  values (
    current_profile.id,
    current_profile.auth_user_id,
    p_document_version,
    p_document_hash,
    coalesce(p_accepted_at, now()),
    p_source,
    p_registration_role,
    nullif(trim(coalesce(p_user_agent, '')), '')
  )
  on conflict (auth_user_id, document_version)
    where revoked_at is null
  do update
  set document_hash = excluded.document_hash,
      accepted_at = excluded.accepted_at,
      source = excluded.source,
      registration_role = excluded.registration_role,
      user_agent = excluded.user_agent,
      profile_id = excluded.profile_id
  returning * into saved_consent;

  update public.profiles
  set personal_data_consent_version = saved_consent.document_version,
      personal_data_consented_at = saved_consent.accepted_at,
      updated_at = now()
  where id = current_profile.id;

  return saved_consent;
end;
$$;

grant execute on function public.record_personal_data_consent(
  text,
  text,
  timestamp with time zone,
  text,
  text,
  text
) to authenticated;

grant select on table public.personal_data_consents to authenticated;

create or replace function public.handle_new_auth_user() returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app_meta jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  provider_value text := nullif(
    trim(coalesce(app_meta->>'provider', meta->>'provider', '')),
    ''
  );
  is_yandex_oauth boolean := provider_value in ('custom:yandex', 'yandex')
    or coalesce(app_meta->'providers', '[]'::jsonb) ? 'custom:yandex'
    or coalesce(app_meta->'providers', '[]'::jsonb) ? 'yandex';
  email_value text := nullif(trim(coalesce(new.email, meta->>'email', meta->>'default_email', '')), '');
  requested_role_meta text := nullif(
    trim(coalesce(meta->>'requested_role', meta->>'role', '')),
    ''
  );
  first_name_value text := nullif(trim(coalesce(meta->>'first_name', meta->>'given_name', '')), '');
  last_name_value text := nullif(trim(coalesce(meta->>'last_name', meta->>'family_name', '')), '');
  middle_name_value text := nullif(trim(meta->>'middle_name'), '');
  full_name_value text;
  avatar_url_value text := nullif(trim(coalesce(meta->>'avatar_url', meta->>'picture', '')), '');
  requested_role_value text := case
    when is_yandex_oauth then 'consumer'
    when requested_role_meta = 'consumer' then 'consumer'
    when requested_role_meta in ('cashier', 'mayor_assistant') then requested_role_meta
    else 'cashier'
  end;
  requested_station_value uuid;
  consent_required boolean := not is_yandex_oauth and (
    requested_role_meta is not null
    or first_name_value is not null
    or last_name_value is not null
    or nullif(trim(meta->>'personal_data_consent_accepted'), '') is not null
  );
  consent_accepted boolean := coalesce((meta->>'personal_data_consent_accepted')::boolean, false);
  consent_version text := nullif(trim(meta->>'personal_data_consent_version'), '');
  consent_document_hash text := nullif(trim(meta->>'personal_data_consent_document_hash'), '');
  consent_source text := nullif(trim(meta->>'personal_data_consent_source'), '');
  consent_registration_role text := nullif(trim(meta->>'personal_data_consent_registration_role'), '');
  consent_user_agent text := nullif(trim(meta->>'personal_data_consent_user_agent'), '');
  consent_accepted_at timestamp with time zone;
  saved_profile public.profiles%rowtype;
begin
  full_name_value := nullif(
    trim(coalesce(
      nullif(trim(concat_ws(' ', last_name_value, first_name_value, middle_name_value)), ''),
      meta->>'full_name',
      meta->>'display_name',
      meta->>'real_name',
      meta->>'name',
      ''
    )),
    ''
  );

  if requested_role_value = 'cashier'
    and nullif(meta->>'requested_station_id', '') is not null then
    requested_station_value := (meta->>'requested_station_id')::uuid;
  end if;

  if consent_required then
    if not consent_accepted then
      raise exception 'PERSONAL_DATA_CONSENT_REQUIRED';
    end if;

    if consent_version is null then
      raise exception 'PERSONAL_DATA_CONSENT_VERSION_REQUIRED';
    end if;

    if consent_document_hash is null then
      raise exception 'PERSONAL_DATA_CONSENT_HASH_REQUIRED';
    end if;

    if consent_source <> 'email_password' then
      raise exception 'INVALID_PERSONAL_DATA_CONSENT_SOURCE';
    end if;

    if consent_registration_role <> requested_role_value then
      raise exception 'INVALID_PERSONAL_DATA_CONSENT_ROLE';
    end if;

    consent_accepted_at := coalesce(
      nullif(trim(meta->>'personal_data_consent_accepted_at'), '')::timestamp with time zone,
      now()
    );
  end if;

  insert into public.profiles (
    auth_user_id,
    email,
    phone,
    avatar_url,
    auth_provider,
    full_name,
    first_name,
    last_name,
    middle_name,
    position,
    signature_name,
    requested_station_id,
    role,
    is_active,
    approval_status,
    personal_data_consent_version,
    personal_data_consented_at
  )
  values (
    new.id,
    email_value,
    nullif(trim(meta->>'phone'), ''),
    avatar_url_value,
    provider_value,
    coalesce(full_name_value, email_value, 'Пользователь Яндекс ID'),
    first_name_value,
    last_name_value,
    middle_name_value,
    case when is_yandex_oauth then null else nullif(trim(meta->>'position'), '') end,
    case
      when is_yandex_oauth then null
      else coalesce(nullif(trim(meta->>'signature_name'), ''), full_name_value, email_value)
    end,
    case when is_yandex_oauth then null else requested_station_value end,
    requested_role_value,
    requested_role_value = 'consumer',
    case when requested_role_value = 'consumer' then 'approved' else 'pending' end,
    consent_version,
    consent_accepted_at
  )
  on conflict (auth_user_id) do nothing
  returning * into saved_profile;

  if saved_profile.id is not null and consent_required then
    insert into public.personal_data_consents (
      profile_id,
      auth_user_id,
      document_version,
      document_hash,
      accepted_at,
      source,
      registration_role,
      user_agent
    )
    values (
      saved_profile.id,
      saved_profile.auth_user_id,
      consent_version,
      consent_document_hash,
      consent_accepted_at,
      consent_source,
      consent_registration_role,
      consent_user_agent
    )
    on conflict (auth_user_id, document_version)
      where revoked_at is null
    do nothing;
  end if;

  return new;
end;
$$;
