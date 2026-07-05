set check_function_bodies = off;
set search_path = public, extensions;

create or replace function public.normalize_phone(value text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(value, ''), '\D', '', 'g');

  if length(digits) = 11 and left(digits, 1) = '8' then
    return '7' || substring(digits from 2);
  end if;

  if length(digits) = 10 then
    return '7' || digits;
  end if;

  return digits;
end;
$$;

create table public.driver_max_links (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers(id) on delete set null,
  normalized_phone text not null unique,
  max_user_id bigint not null unique,
  max_chat_id bigint,
  is_linked boolean not null default true,
  linked_at timestamptz default now(),
  unlinked_at timestamptz,
  consent_status text not null default 'granted' check (consent_status in ('granted', 'revoked')),
  consent_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_max_links_normalized_phone_not_empty check (normalized_phone <> '')
);

create table public.max_message_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint max_message_templates_title_not_empty check (btrim(title) <> ''),
  constraint max_message_templates_body_not_empty check (btrim(body) <> '')
);

create table public.max_message_batches (
  id uuid primary key default gen_random_uuid(),
  sender_profile_id uuid not null references public.profiles(id),
  template_id uuid references public.max_message_templates(id),
  message_text text not null,
  recipient_count integer not null check (recipient_count between 1 and 10),
  status text not null default 'pending' check (status in ('pending', 'partial', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint max_message_batches_message_text_not_empty check (btrim(message_text) <> '')
);

create table public.max_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.max_message_batches(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  normalized_phone text not null,
  max_user_id bigint not null,
  max_chat_id bigint,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  max_message_id text,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  constraint max_message_deliveries_normalized_phone_not_empty check (normalized_phone <> '')
);

create index idx_driver_max_links_driver_id on public.driver_max_links (driver_id);
create index idx_driver_max_links_status on public.driver_max_links (is_linked, consent_status);
create index idx_max_message_templates_active on public.max_message_templates (is_active, title);
create index idx_max_message_batches_sender on public.max_message_batches (sender_profile_id, created_at desc);
create index idx_max_message_deliveries_batch on public.max_message_deliveries (batch_id);

create trigger set_driver_max_links_updated_at
before update on public.driver_max_links
for each row execute function public.set_updated_at();

create trigger set_max_message_templates_updated_at
before update on public.max_message_templates
for each row execute function public.set_updated_at();

alter table public.driver_max_links enable row level security;
alter table public.max_message_templates enable row level security;
alter table public.max_message_batches enable row level security;
alter table public.max_message_deliveries enable row level security;

create policy max_message_templates_select_active
on public.max_message_templates
for select
to authenticated
using (
  is_active = true
  and public.get_current_profile_id() is not null
);

create policy max_message_batches_select_own
on public.max_message_batches
for select
to authenticated
using (sender_profile_id = public.get_current_profile_id());

create policy max_message_deliveries_select_own_batch
on public.max_message_deliveries
for select
to authenticated
using (
  exists (
    select 1
    from public.max_message_batches b
    where b.id = max_message_deliveries.batch_id
      and b.sender_profile_id = public.get_current_profile_id()
  )
);

create or replace function public.list_max_recipients()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select public.get_current_profile_id() as profile_id
  ),
  normalized_drivers as (
    select
      d.id,
      d.full_name,
      d.phone,
      public.normalize_phone(d.phone) as normalized_phone,
      d.created_at
    from public.drivers d
    cross join actor a
    where a.profile_id is not null
      and public.normalize_phone(d.phone) <> ''
  ),
  grouped_drivers as (
    select
      nd.normalized_phone,
      min(nd.phone) as display_phone,
      string_agg(distinct nd.full_name, ', ' order by nd.full_name) as display_name,
      array_agg(nd.id order by nd.created_at asc) as driver_ids,
      count(*)::integer as driver_count
    from normalized_drivers nd
    group by nd.normalized_phone
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'normalized_phone', gd.normalized_phone,
        'display_phone', gd.display_phone,
        'display_name', gd.display_name,
        'driver_ids', gd.driver_ids,
        'driver_count', gd.driver_count,
        'is_linked', coalesce(l.is_linked, false),
        'consent_status', l.consent_status,
        'linked_at', l.linked_at,
        'max_status', case
          when l.is_linked = true and l.consent_status = 'granted' then 'linked'
          when l.id is not null then 'no_consent'
          else 'unlinked'
        end
      )
      order by gd.display_name, gd.display_phone
    ),
    '[]'::jsonb
  )
  from grouped_drivers gd
  left join public.driver_max_links l on l.normalized_phone = gd.normalized_phone;
$$;

create or replace function public.list_max_message_templates()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'body', t.body
      )
      order by t.title
    ),
    '[]'::jsonb
  )
  from public.max_message_templates t
  where t.is_active = true
    and public.get_current_profile_id() is not null;
$$;

insert into public.max_message_templates (id, title, body, is_active)
values
  (
    '40000000-0000-0000-0000-000000000001',
    'Напоминание о записи',
    'Здравствуйте! Напоминаем, что ваш автомобиль записан на заправку. Пожалуйста, приезжайте в выбранное время и подготовьте госномер для проверки.',
    true
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    'Изменение очереди',
    'Здравствуйте! По вашей записи на заправку есть изменение в очереди. Пожалуйста, уточните актуальный статус у оператора АЗС.',
    true
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    'Уточнение данных',
    'Здравствуйте! Для подтверждения записи на заправку просим уточнить данные автомобиля и водителя у оператора.',
    true
  )
on conflict (id) do update
set title = excluded.title,
    body = excluded.body,
    is_active = excluded.is_active;

revoke execute on function public.normalize_phone(text) from public;
revoke execute on function public.list_max_recipients() from public;
revoke execute on function public.list_max_message_templates() from public;

grant execute on function public.normalize_phone(text) to authenticated, service_role;
grant execute on function public.list_max_recipients() to authenticated;
grant execute on function public.list_max_message_templates() to authenticated;
